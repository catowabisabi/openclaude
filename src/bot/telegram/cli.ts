import { parseArgs } from "util";
import { createTelegramBot } from "./services/telegram-bot-impl.js";

interface CliOptions {
  telegram: boolean;
  token?: string;
  grpcHost?: string;
  grpcPort?: number;
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
      config: { type: "string" },
    },
    allowPositionals: true,
  });

  const options: CliOptions = {
    telegram: values.telegram ?? false,
    token: values.token,
    grpcHost: values["grpc-host"],
    grpcPort: parseInt(values["grpc-port"] ?? "50051", 10),
    config: values.config,
  };

  if (!options.telegram) return;

  const token = options.token ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN not set");
  }

  const bot = createTelegramBot({
    botToken: token,
    grpcHost: options.grpcHost,
    grpcPort: options.grpcPort,
  });

  await bot.start();
  console.log("Telegram bot running. Press Ctrl+C to stop.");

  process.on("SIGINT", async () => {
    await bot.stop();
    process.exit(0);
  });
}
