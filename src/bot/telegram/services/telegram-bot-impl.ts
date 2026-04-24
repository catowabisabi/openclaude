import { Client, Telegram } from "telegram";
import type { Message, Update, CallbackQuery } from "telegram";
import type { TelegramBot, TelegramSettings } from "../types.js";
import { MessageOrchestrator } from "../services/orchestrator.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createRateLimitMiddleware } from "../middleware/rate-limit.js";
import { createSecurityMiddleware } from "../middleware/security.js";
import { parseTelegramSettings } from "../config/telegram-settings.js";

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
  private isRunning = false;

  constructor(token: string, options?: Partial<TelegramBotOptions>) {
    this.client = new Telegram(token);
    this.settings = parseTelegramSettings({
      botToken: token,
      approvedDirectory: options?.settings?.approvedDirectory ?? "/tmp",
      ...options?.settings,
    });
    this.orchestrator = new MessageOrchestrator(this.client as any, this.settings);

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

  private async handleUpdate(update: Update): Promise<void> {
    const message = (update as any).message as Message | undefined;
    if (!message?.messageThreadId && message?.chat?.id && message?.from?.id) {
      const chatId = message.chat.id;
      const userId = message.from.id;
      const text = message.text;

      if (text === "/start") {
        await this.client.sendMessage(chatId, {
          text: "Claude Code Telegram Bot ready.",
        });
        return;
      }

      if (text === "/interrupt") {
        await this.orchestrator.handleInterrupt(userId);
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
