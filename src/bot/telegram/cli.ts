import { parseArgs } from "util";
import { createTelegramBot } from "./services/telegram-bot-impl.js";
import { WebhookServer } from "./api/webhook-server.js";

interface CliOptions {
  telegram: boolean;
  token?: string;
  grpcHost?: string;
  grpcPort?: number;
  webhookPort?: number;
  webhookSecret?: string;
  config?: string;
}

export async function runTelegramCli(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      telegram: { type: "boolean", default: false },
      token: { type: "string" },
      "grpc-host": { type: "string", default: "localhost" },
      "grpc-port": { type: "string", default: "50051" },
      "webhook-port": { type: "string" },
      "webhook-secret": { type: "string" },
      config: { type: "string" },
    },
    allowPositionals: true,
  });

  const options: CliOptions = {
    telegram: values.telegram ?? false,
    token: values.token,
    grpcHost: values["grpc-host"],
    grpcPort: parseInt(values["grpc-port"] ?? "50051", 10),
    webhookPort: values["webhook-port"] ? parseInt(values["webhook-port"], 10) : undefined,
    webhookSecret: values["webhook-secret"],
    config: values.config,
  };

  if (!options.telegram) return;

  const token = options.token ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN not set");
  }

  const webhookServer = options.webhookPort && options.webhookSecret
    ? new WebhookServer(options.webhookPort, options.webhookSecret)
    : null;

  const bot = createTelegramBot({
    botToken: token,
    grpcHost: options.grpcHost,
    grpcPort: options.grpcPort,
  });

  if (webhookServer) {
    await webhookServer.start();
  }

  await bot.start();
  console.log("Telegram bot running. Press Ctrl+C to stop.");

  const shutdown = async () => {
    if (webhookServer) {
      await webhookServer.stop();
    }
    await bot.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
