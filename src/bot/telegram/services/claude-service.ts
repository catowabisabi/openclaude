import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { loadSync } from "@grpc/proto-loader";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { StreamUpdate } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(__dirname, "../../../../proto/openclaude.proto");

export interface AgentRequest {
  sessionId: string;
  prompt: string;
  workingDirectory: string;
  userId: number;
  interruptSignal?: AbortSignal;
}

export interface AgentStreamCallbacks {
  onUpdate: (update: StreamUpdate) => void;
  onComplete: (content: string, toolsUsed: string[], cost: number) => void;
  onError: (error: Error) => void;
}

export class ClaudeService {
  private client: grpc.Client;
  private metadata: grpc.Metadata;

  constructor(host: string = "localhost", port: number = 50051) {
    const packageDef = loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const proto = grpc.loadPackageDefinition(packageDef) as any;
    this.client = new proto.openclaude.v1.AgentService(
      `${host}:${port}`,
      grpc.credentials.createInsecure()
    );

    this.metadata = new grpc.Metadata();
  }

  runAgent(
    request: AgentRequest,
    callbacks: AgentStreamCallbacks
  ): grpc.ClientDuplexStream<any> {
    const stream = this.client.Chat(this.metadata, (err: Error | null, res: any) => {
      if (err) {
        callbacks.onError(err);
      }
    });

    stream.on("data", (msg: any) => {
      if (msg.text_chunk) {
        callbacks.onUpdate({
          type: "text",
          content: msg.text_chunk.text,
        });
      } else if (msg.tool_start) {
        callbacks.onUpdate({
          type: "tool_start",
          toolName: msg.tool_start.tool_name,
          toolInput: msg.tool_start.arguments_json,
          toolUseId: msg.tool_start.tool_use_id,
        });
      } else if (msg.tool_result) {
        callbacks.onUpdate({
          type: "tool_end",
          toolName: msg.tool_result.tool_name,
          toolResult: msg.tool_result.output,
          toolUseId: msg.tool_result.tool_use_id,
        });
      } else if (msg.action_required) {
        callbacks.onUpdate({
          type: "approval_required",
          promptId: msg.action_required.prompt_id,
          question: msg.action_required.question,
        });
      } else if (msg.done) {
        callbacks.onComplete(
          msg.done.full_text,
          [],
          0
        );
      } else if (msg.error) {
        callbacks.onError(new Error(msg.error.message));
      }
    });

    stream.on("error", (err: Error) => {
      callbacks.onError(err);
    });

    stream.write({
      request: {
        message: request.prompt,
        working_directory: request.workingDirectory,
        session_id: request.sessionId,
        model: "",
      },
    });

    if (request.interruptSignal) {
      request.interruptSignal.addEventListener("abort", () => {
        stream.write({ cancel: { reason: "User cancelled" } });
        stream.end();
      });
    }

    return stream;
  }

  interruptAgent(sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.interruptAgent(
        { sessionId },
        this.metadata,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  close(): void {
    this.client.close();
  }
}

let _instance: ClaudeService | null = null;

export function getClaudeService(host?: string, port?: number): ClaudeService {
  if (!_instance) {
    _instance = new ClaudeService(host, port);
  }
  return _instance;
}

export function resetClaudeService(): void {
  if (_instance) {
    _instance.close();
    _instance = null;
  }
}
