import type { Client } from "telegram";
import type {
  AuthContext,
  TelegramSettings,
  ActiveRequest,
  Session,
  StreamUpdate,
} from "../types.js";
import { getClaudeService } from "../services/claude-service.js";
import { validateInput, validateFilePath, validateToolName } from "../middleware/security.js";

export class MessageOrchestrator {
  private client: Client;
  private settings: TelegramSettings;
  private activeRequests: Map<number, ActiveRequest> = new Map();
  private sessions: Map<string, Session> = new Map();

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
            this.handleStreamUpdate(chatId, update);
          },
          onComplete: async (content, toolsUsed, cost) => {
            await this.sendMessage(chatId, content);
            this.activeRequests.delete(userId);
          },
          onError: async (error: Error) => {
            await this.sendMessage(chatId, `Error: ${error.message}`);
            this.activeRequests.delete(userId);
          },
        }
      );
    } catch (err) {
      await this.sendMessage(chatId, `Failed to start: ${err}`);
      this.activeRequests.delete(userId);
    }
  }

  async handleInterrupt(userId: number): Promise<void> {
    const active = this.activeRequests.get(userId);
    if (!active) return;

    active.interruptEvent?.abort();
    this.activeRequests.delete(userId);

    const claude = getClaudeService();
    if (active.sessionId) {
      await claude.interruptAgent(active.sessionId);
    }
  }

  private handleStreamUpdate(chatId: number, update: StreamUpdate): void {
    switch (update.type) {
      case "text":
        if (update.content) {
          this.sendMessage(chatId, update.content);
        }
        break;
      case "approval_required":
        if (update.question) {
          this.sendMessage(chatId, `Approval needed: ${update.question}`);
        }
        break;
      case "tool_start":
        this.sendMessage(chatId, `Using tool: ${update.toolName}`);
        break;
    }
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    await this.client.sendMessage(chatId, { text });
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
}
