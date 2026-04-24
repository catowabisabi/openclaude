import { Client } from "gramjs";
import type { TelegramSettings } from "./types.js";
import type { TelegramBot as TelegramBotInterface } from "./types.js";
import { parseTelegramSettings } from "./config/telegram-settings.js";
import { getDatabase } from "./storage/database.js";

export interface CreateTelegramBotOptions {
  settings: unknown;
  grpcPort?: number;
  grpcHost?: string;
}

export async function createTelegramBot(
  options: CreateTelegramBotOptions
): Promise<TelegramBotInterface> {
  const settings = parseTelegramSettings(options.settings);

  const bot = new Client();
  await bot.start({
    apiId: parseInt(process.env.TELEGRAM_APP_ID ?? "0"),
    apiHash: process.env.TELEGRAM_APP_HASH ?? "",
    token: settings.botToken,
  });

  const db = getDatabase();

  return {
    bot,
    settings,
    db,
    async start() {
      console.log(`Telegram bot started (token: ${settings.botUsername ?? "unknown"})`);
    },
    async stop() {
      await bot.stop();
      db.close();
    },
  };
}

export interface TelegramBot {
  bot: Client;
  settings: TelegramSettings;
  db: ReturnType<typeof getDatabase>;
  start(): Promise<void>;
  stop(): Promise<void>;
}