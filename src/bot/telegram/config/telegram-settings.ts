import { z } from "zod";
import { resolve } from "path";

const RateLimitSchema = z.object({
  tokens: z.number().default(100),
  refillPerSecond: z.number().default(10),
});

const FeaturesSchema = z.object({
  voiceMessages: z.boolean().default(true),
  fileUploads: z.boolean().default(true),
  imageUploads: z.boolean().default(true),
  quickActions: z.boolean().default(true),
});

export const TelegramSettingsSchema = z.object({
  botToken: z.string().min(1),
  botUsername: z.string().optional(),
  approvedDirectory: z.string().transform((s) => resolve(s)),
  allowedUsers: z.array(z.number()).optional(),
  agenticMode: z.boolean().default(true),
  enableProjectThreads: z.boolean().default(false),
  projectThreadsMode: z.enum(["private", "group"]).default("private"),
  projectThreadsChatId: z.number().optional(),
  enableWebhook: z.boolean().default(false),
  webhookSecret: z.string().optional(),
  webhookPort: z.number().default(50052),
  rateLimit: RateLimitSchema.default(),
  features: FeaturesSchema.default(),
});

export type TelegramSettings = z.infer<typeof TelegramSettingsSchema>;

export function parseTelegramSettings(raw: unknown): TelegramSettings {
  return TelegramSettingsSchema.parse(raw);
}