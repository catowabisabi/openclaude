import { spawn } from "child_process";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { createRequire } from "module";
import type { TelegramSettings } from "../config/telegram-settings.js";

const require = createRequire(import.meta.url);

export interface ProcessedVoice {
  prompt: string;
  transcription: string;
  duration: number;
}

export class VoiceHandler {
  private settings: TelegramSettings;

  constructor(settings: TelegramSettings) {
    this.settings = settings;
  }

  async processVoiceMessage(
    voiceFileId: string,
    duration: number,
    fileSize: number,
    downloadFn: (fileId: string) => Promise<Buffer>
  ): Promise<ProcessedVoice> {
    const maxBytes = (this.settings.voice?.maxFileSizeMb ?? 20) * 1024 * 1024;
    if (fileSize > maxBytes) {
      throw new Error(
        `Voice message too large (${(fileSize / 1024 / 1024).toFixed(1)}MB). Max allowed: ${this.settings.voice?.maxFileSizeMb ?? 20}MB.`
      );
    }

    const voiceBytes = await downloadFn(voiceFileId);
    if (voiceBytes.length > maxBytes) {
      throw new Error(
        `Voice message too large (${(voiceBytes.length / 1024 / 1024).toFixed(1)}MB). Max allowed: ${this.settings.voice?.maxFileSizeMb ?? 20}MB.`
      );
    }

    const provider = this.settings.voice?.provider ?? "mistral";
    let transcription: string;

    if (provider === "local") {
      transcription = await this.transcribeLocal(voiceBytes);
    } else if (provider === "openai") {
      transcription = await this.transcribeOpenAI(voiceBytes);
    } else {
      transcription = await this.transcribeMistral(voiceBytes);
    }

    const prompt = `Voice message transcription:\n\n${transcription}`;
    return {
      prompt,
      transcription,
      duration,
    };
  }

  private async transcribeMistral(voiceBytes: Buffer): Promise<string> {
    const apiKey = this.settings.voice?.mistralApiKey ?? process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      throw new Error("Mistral API key not configured. Set MISTRAL_API_KEY or voice.mistralApiKey.");
    }

    let Mistral: any;
    try {
      ({ Mistral } = require("@mistralai/mistralai"));
    } catch {
      throw new Error("Optional package '@mistralai/mistralai' not installed. Run: bun add @mistralai/mistralai");
    }

    const client = new Mistral({ apiKey });
    const response = await client.audio.transcriptions.create({
      model: this.settings.voice?.model ?? "mistral-voxtral-7b",
      file: {
        name: "voice.ogg",
        type: "audio/ogg;codecs=opus",
        content: voiceBytes,
      },
    });

    const text = (response.text ?? "").trim();
    if (!text) {
      throw new Error("Mistral transcription returned an empty response.");
    }
    return text;
  }

  private async transcribeOpenAI(voiceBytes: Buffer): Promise<string> {
    const apiKey = this.settings.voice?.openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key not configured. Set OPENAI_API_KEY or voice.openaiApiKey.");
    }

    let OpenAI: any;
    try {
      ({ OpenAI } = require("openai"));
    } catch {
      throw new Error("Optional package 'openai' not installed. Run: bun add openai");
    }

    const client = new OpenAI({ apiKey });
    const response = await client.audio.transcriptions.create({
      model: "whisper-1",
      file: {
        name: "voice.ogg",
        content: voiceBytes,
        contentType: "audio/ogg",
      },
    });

    const text = (response.text ?? "").trim();
    if (!text) {
      throw new Error("OpenAI transcription returned an empty response.");
    }
    return text;
  }

  private async transcribeLocal(voiceBytes: Buffer): Promise<string> {
    const binary = this.settings.voice?.whisperCppBinaryPath ?? process.env.WHISPER_CPP_BINARY_PATH;
    const modelPath = this.settings.voice?.whisperCppModelPath ?? process.env.WHISPER_CPP_MODEL_PATH;

    if (!binary || !existsSync(binary)) {
      throw new Error(`whisper.cpp binary not found at ${binary}`);
    }
    if (!modelPath || !existsSync(modelPath)) {
      throw new Error(`whisper.cpp model not found at ${modelPath}`);
    }

    const tmpDir = mkdtempSync(join(tmpdir(), "claude-voice-"));
    const inputPath = join(tmpDir, "voice.ogg");
    const outputPath = join(tmpDir, "output.txt");

    try {
      writeFileSync(inputPath, voiceBytes);

      const proc = spawn(binary, [
        "-m", modelPath,
        "-f", inputPath,
        "-of", outputPath.replace(".txt", ""),
      ]);

      const exitCode = await this.waitForProcess(proc, 120000);
      if (exitCode !== 0) {
        throw new Error(`whisper.cpp exited with code ${exitCode}`);
      }

      const text = existsSync(outputPath) ? readFileSync(outputPath, "utf-8").trim() : "";
      if (!text) {
        throw new Error("whisper.cpp transcription returned an empty response.");
      }
      return text;
    } finally {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  }

  private waitForProcess(proc: ReturnType<typeof spawn>, timeoutMs: number): Promise<number> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        proc.kill();
        resolve(-1);
      }, timeoutMs);
      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve(code ?? -1);
      });
    });
  }
}
