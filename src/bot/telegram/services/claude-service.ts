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
    this.client = new proto.openclaude.AgentService(
      `${host}:${port}`,
      grpc.credentials.createInsecure()
    );

    this.metadata = new grpc.Metadata();
  }

  runAgent(
    request: AgentRequest,
    callbacks: AgentStreamCallbacks
  ): grpc.ClientWritableStream<any> {
    const stream = this.client.runAgent(
      {
        sessionId: request.sessionId,
        prompt: request.prompt,
        workingDirectory: request.workingDirectory,
        userId: String(request.userId),
      },
      this.metadata,
      (err: Error | null, res: any) => {
        if (err) {
          callbacks.onError(err);
        } else {
          callbacks.onComplete(
            res.content ?? "",
            res.toolsUsed ?? [],
            res.costUsd ?? 0
          );
        }
      }
    );

    stream.on("data", (res: any) => {
      const update: StreamUpdate = { type: "text", content: res.content };
      if (res.toolName) {
        update.type = res.toolName === "__end__" ? "tool_end" : "tool_start";
        update.toolName = res.toolName !== "__end__" ? res.toolName : undefined;
      }
      if (res.approvalRequired) {
        update.type = "approval_required";
        update.promptId = res.promptId;
        update.question = res.question;
      }
      callbacks.onUpdate(update);
    });

    stream.on("error", (err: Error) => {
      callbacks.onError(err);
    });

    if (request.interruptSignal) {
      request.interruptSignal.addEventListener("abort", () => {
        stream.write({ interrupt: true });
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