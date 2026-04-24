import type { Client, TelegramClient } from "telegram";
import type {
  TelegramSettings,
  ActiveRequest,
  Session,
  StreamUpdate,
} from "../types.js";
import { getClaudeService, type ClaudeService } from "../services/claude-service.js";
import { validateInput } from "../middleware/security.js";

interface PendingApproval {
  promptId: string;
  question: string;
  resolve: (approved: boolean) => void;
  createdAt: Date;
}

interface ApprovalHandlers {
  onApprovalRequest: (chatId: number, promptId: string, question: string) => Promise<void>;
}

export class MessageOrchestrator {
  private client: Client;
  private settings: TelegramSettings;
  private activeRequests: Map<number, ActiveRequest> = new Map();
  private sessions: Map<string, Session> = new Map();
  private pendingApprovals: Map<string, PendingApproval> = new Map();
  private streamByUser: Map<number, ReturnType<ClaudeService["runAgent"]>> = new Map();
  private verboseLevels: Map<number, number> = new Map();
  private workspaces: string[] = [];

  constructor(client: Client, settings: TelegramSettings) {
    this.client = client;
    this.settings = settings;
  }

  async handleMessage(
    chatId: number,
    userId: number,
    text: string
  ): Promise<void> {
    if (!validateInput(text)) {
      await this.sendMessage(chatId, "Invalid characters detected.");
      return;
    }

    const session = this.getOrCreateSession(userId);
    const active = this.activeRequests.get(userId);

    if (active) {
      await this.sendMessage(chatId, "Processing... Please wait.");
      return;
    }

    const controller = new AbortController();
    this.activeRequests.set(userId, {
      userId,
      sessionId: session.sessionId,
      interruptEvent: controller.signal,
    });

    try {
      const claude = getClaudeService();
      const stream = claude.runAgent(
        {
          sessionId: session.sessionId,
          prompt: text,
          workingDirectory: session.workingDirectory,
          userId,
          interruptSignal: controller.signal,
        },
        {
          onUpdate: (update: StreamUpdate) => {
            this.handleStreamUpdate(chatId, userId, update);
          },
          onComplete: async (content, toolsUsed, cost) => {
            await this.sendMessage(chatId, content);
            this.streamByUser.delete(userId);
            this.activeRequests.delete(userId);
          },
          onError: async (error: Error) => {
            await this.sendMessage(chatId, `Error: ${error.message}`);
            this.streamByUser.delete(userId);
            this.activeRequests.delete(userId);
          },
        }
      );
      this.streamByUser.set(userId, stream);
    } catch (err) {
      await this.sendMessage(chatId, `Failed to start: ${err}`);
      this.activeRequests.delete(userId);
    }
  }

  async handleApprovalResponse(
    chatId: number,
    userId: number,
    promptId: string,
    approved: boolean
  ): Promise<void> {
    const pending = this.pendingApprovals.get(promptId);
    if (pending) {
      pending.resolve(approved);
      this.pendingApprovals.delete(promptId);
    }
  }

  async handleInterrupt(userId: number): Promise<void> {
    const active = this.activeRequests.get(userId);
    if (!active) return;

    active.interruptEvent?.abort();
    const stream = this.streamByUser.get(userId);
    if (stream) {
      stream.cancel();
    }
    this.streamByUser.delete(userId);
    this.activeRequests.delete(userId);
  }

  private handleStreamUpdate(chatId: number, userId: number, update: StreamUpdate): void {
    switch (update.type) {
      case "text":
        if (update.content) {
          this.sendMessage(chatId, update.content);
        }
        break;
      case "approval_required":
        if (update.promptId && update.question) {
          const promptId = update.promptId;
          const question = update.question;
          const promise = new Promise<boolean>((resolve) => {
            this.pendingApprovals.set(promptId, {
              promptId,
              question,
              resolve,
              createdAt: new Date(),
            });
          });

          promise.then((approved) => {
            const stream = this.streamByUser.get(userId);
            if (stream) {
              stream.write({
                input: {
                  prompt_id: promptId,
                  reply: approved ? "yes" : "no",
                },
              });
            }
          });

          this.sendApprovalRequest(chatId, promptId, question);
        }
        break;
      case "tool_start":
        if (update.toolName) {
          this.sendMessage(chatId, `Using tool: ${update.toolName}`);
        }
        break;
    }
  }

  private async sendApprovalRequest(chatId: number, promptId: string, question: string): Promise<void> {
    const client = this.client as TelegramClient;
    await client.sendMessage(chatId, {
      text: `Approval needed: ${question}`,
      replyMarkup: {
        inlineKeyboard: [[
          { text: "✅ Approve", callbackData: `approve:${promptId}` },
          { text: "❌ Deny", callbackData: `deny:${promptId}` },
        ]],
      },
    });
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    const client = this.client as TelegramClient;
    await client.sendMessage(chatId, { text });
  }

  private getOrCreateSession(userId: number): Session {
    const key = String(userId);
    const existing = this.sessions.get(key);
    if (existing && !existing.isExpired) {
      return existing;
    }

    const session: Session = {
      sessionId: crypto.randomUUID(),
      userId,
      workingDirectory: this.settings.approvedDirectory,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      isExpired: false,
    };
    this.sessions.set(key, session);
    return session;
  }

  getActiveRequest(userId: number): ActiveRequest | undefined {
    return this.activeRequests.get(userId);
  }

  clearSession(userId: number): void {
    const key = String(userId);
    const session = this.sessions.get(key);
    if (session) {
      session.isExpired = true;
      this.sessions.delete(key);
    }
  }

  setVerboseLevel(userId: number, level: number): void {
    this.verboseLevels.set(userId, level);
  }

  getVerboseLevel(userId: number): number {
    return this.verboseLevels.get(userId) ?? 1;
  }

  switchWorkspace(userId: number, workspace: string): void {
    const key = String(userId);
    const session = this.sessions.get(key);
    if (session) {
      session.workingDirectory = workspace;
    }
  }

  listWorkspaces(): string[] {
    return this.workspaces;
  }

  addWorkspace(workspace: string): void {
    if (!this.workspaces.includes(workspace)) {
      this.workspaces.push(workspace);
    }
  }
}
