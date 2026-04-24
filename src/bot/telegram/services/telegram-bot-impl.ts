import { Client, Telegram } from "telegram";
import type { Message, Update, CallbackQuery, Voice } from "telegram";
import type { TelegramBot, TelegramSettings } from "../types.js";
import { MessageOrchestrator } from "../services/orchestrator.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createRateLimitMiddleware } from "../middleware/rate-limit.js";
import { createSecurityMiddleware } from "../middleware/security.js";
import { parseTelegramSettings } from "../config/telegram-settings.js";
import { VoiceHandler } from "../services/voice-handler.js";

export interface TelegramBotOptions {
  botToken: string;
  settings?: Partial<TelegramSettings>;
  grpcHost?: string;
  grpcPort?: number;
}

export class TelegramBotImpl implements TelegramBot {
  public client: Telegram;
  public settings: TelegramSettings;
  private orchestrator: MessageOrchestrator;
  private authMw: ReturnType<typeof createAuthMiddleware>;
  private rateLimitMw: ReturnType<typeof createRateLimitMiddleware>;
  private securityMw: ReturnType<typeof createSecurityMiddleware>;
  private voiceHandler: VoiceHandler;
  private isRunning = false;

  constructor(token: string, options?: Partial<TelegramBotOptions>) {
    this.client = new Telegram(token);
    this.settings = parseTelegramSettings({
      botToken: token,
      approvedDirectory: options?.settings?.approvedDirectory ?? "/tmp",
      ...options?.settings,
    });
    this.orchestrator = new MessageOrchestrator(this.client as any, this.settings);
    this.voiceHandler = new VoiceHandler(this.settings);

    this.authMw = createAuthMiddleware(this.settings.allowedUsers);
    this.rateLimitMw = createRateLimitMiddleware(
      this.settings.rateLimit.tokens,
      this.settings.rateLimit.refillPerSecond
    );
    this.securityMw = createSecurityMiddleware(this.settings.approvedDirectory);

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.client.on("update", async (update: Update) => {
      if (!this.isRunning) return;

      try {
        await this.handleUpdate(update);
      } catch (err) {
        console.error("Update error:", err);
      }
    });
  }

  private async handleCommand(chatId: number, userId: number, command: string, args: string): Promise<void> {
    switch (command) {
      case "/start":
        await this.client.sendMessage(chatId, {
          text: "Claude Code Telegram Bot ready.\n\nCommands:\n/new - Start a new conversation\n/status - Check current session status\n/verbose [0|1|2] - Set verbosity level\n/repo [name] - List or switch workspace",
        });
        break;

      case "/new":
        this.orchestrator.clearSession(userId);
        await this.client.sendMessage(chatId, {
          text: "Starting a new conversation.",
        });
        break;

      case "/status": {
        const active = this.orchestrator.getActiveRequest(userId);
        if (active) {
          await this.client.sendMessage(chatId, { text: "Processing a request..." });
        } else {
          await this.client.sendMessage(chatId, { text: "Idle. Ready for your next request." });
        }
        break;
      }

      case "/verbose": {
        const level = parseInt(args, 10);
        if (isNaN(level) || level < 0 || level > 2) {
          await this.client.sendMessage(chatId, {
            text: "Usage: /verbose 0|1|2\n\n0 = quiet, 1 = normal, 2 = detailed",
          });
        } else {
          this.orchestrator.setVerboseLevel(userId, level);
          await this.client.sendMessage(chatId, { text: `Verbosity set to ${level}` });
        }
        break;
      }

      case "/repo":
        if (args) {
          this.orchestrator.switchWorkspace(userId, args);
          await this.client.sendMessage(chatId, { text: `Switched to workspace: ${args}` });
        } else {
          const workspaces = this.orchestrator.listWorkspaces();
          const text = workspaces.length > 0
            ? `Available workspaces:\n${workspaces.map(w => `• ${w}`).join("\n")}`
            : "No workspaces configured.";
          await this.client.sendMessage(chatId, { text });
        }
        break;

      default:
        await this.client.sendMessage(chatId, { text: "Unknown command." });
    }
  }

  private async handleUpdate(update: Update): Promise<void> {
    const message = (update as any).message as Message | undefined;
    if (!message?.messageThreadId && message?.chat?.id && message?.from?.id) {
      const chatId = message.chat.id;
      const userId = message.from.id;
      const text = message.text;
      const voice = message.voice as Voice | undefined;

      if (voice && this.settings.features?.voiceMessages === true) {
        const fileSize = voice.file_size ?? 0;
        const duration = voice.duration ?? 0;
        const caption = text ?? undefined;
        try {
          const result = await this.voiceHandler.processVoiceMessage(
            voice.file_id,
            duration,
            fileSize,
            async (fileId: string) => {
              const file = await this.client.getFile(fileId);
              return Buffer.from(await file.download());
            }
          );
          await this.orchestrator.handleMessage(chatId, userId, result.prompt);
        } catch (err) {
          await this.client.sendMessage(chatId, {
            text: `Voice transcription failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }

      if (text === "/interrupt") {
        await this.orchestrator.handleInterrupt(userId);
        return;
      }

      if (text && text.startsWith("/")) {
        const parts = text.split(" ");
        const command = parts[0];
        const args = parts.slice(1).join(" ");
        await this.handleCommand(chatId, userId, command, args);
        return;
      }

      if (text) {
        await this.orchestrator.handleMessage(chatId, userId, text);
      }
    }

    const callbackQuery = (update as any).callback_query as CallbackQuery | undefined;
    if (callbackQuery?.message?.chat?.id && callbackQuery?.from?.id && callbackQuery?.data) {
      const chatId = callbackQuery.message.chat.id;
      const userId = callbackQuery.from.id;
      const data = callbackQuery.data;
      const parts = data.split(":");
      if (parts.length === 2) {
        const action = parts[0];
        const promptId = parts[1];
        if (action === "approve" || action === "deny") {
          await this.orchestrator.handleApprovalResponse(chatId, userId, promptId, action === "approve");
          await this.client.answerCallbackQuery(callbackQuery.id);
        }
      }
    }
  }

  async start(): Promise<void> {
    this.isRunning = true;
    await this.client.start();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    await this.client.stop();
  }
}

export function createTelegramBot(options: TelegramBotOptions): TelegramBotImpl {
  return new TelegramBotImpl(options.botToken, options);
}
