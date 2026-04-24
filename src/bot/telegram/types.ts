export type ChatType = "private" | "group" | "supergroup" | "channel";

export interface StreamUpdate {
  type: "text" | "tool_start" | "tool_end" | "tool_error" | "done" | "approval_required";
  content?: string;
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
  toolUseId?: string;
  promptId?: string;
  question?: string;
}

export interface ClaudeResponse {
  content: string;
  sessionId: string;
  toolsUsed: string[];
  cost: number;
}

export interface BotCommand {
  command: string;
  description: string;
}

export type NextHandler = () => Promise<Response | void>;