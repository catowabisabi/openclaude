import { escapeHtml } from "./html.js";

export interface FormattedMessage {
  text: string;
  parseMode: "HTML";
  replyMarkup?: unknown;
}

const MAX_MESSAGE_LENGTH = 4000;

export class ResponseFormatter {
  private maxMessageLength = MAX_MESSAGE_LENGTH;

  formatClaudeResponse(text: string): FormattedMessage[] {
    text = this.cleanText(text);

    const messages = this.splitMessage(text);
    return messages.length > 0
      ? messages
      : [{ text: "<i>(No content to display)</i>", parseMode: "HTML" }];
  }

  formatErrorMessage(error: string, errorType = "Error"): FormattedMessage {
    const icons: Record<string, string> = {
      Error: "❌",
      Warning: "⚠️",
      Info: "ℹ️",
      Security: "🛡️",
      "Rate Limit": "⏱️",
    };
    const icon = icons[errorType] ?? "❌";

    return {
      text: `${icon} <b>${escapeHtml(errorType)}</b>\n\n${escapeHtml(error)}`,
      parseMode: "HTML",
    };
  }

  formatSuccessMessage(message: string, title = "Success"): FormattedMessage {
    return {
      text: `✅ <b>${escapeHtml(title)}</b>\n\n${escapeHtml(message)}`,
      parseMode: "HTML",
    };
  }

  formatInfoMessage(message: string, title = "Info"): FormattedMessage {
    return {
      text: `ℹ️ <b>${escapeHtml(title)}</b>\n\n${escapeHtml(message)}`,
      parseMode: "HTML",
    };
  }

  formatCodeOutput(
    output: string,
    language = "",
    title = "Output"
  ): FormattedMessage[] {
    const maxCodeBlockLength = 15000;

    if (!output.trim()) {
      return [
        {
          text: `📄 <b>${escapeHtml(title)}</b>\n\n<i>(empty output)</i>`,
          parseMode: "HTML",
        },
      ];
    }

    let escapedOutput = escapeHtml(output);

    if (escapedOutput.length > maxCodeBlockLength) {
      escapedOutput =
        escapedOutput.slice(0, maxCodeBlockLength - 100) +
        "\n... (output truncated)";
    }

    const langAttr = language
      ? ` class="language-${escapeHtml(language)}"`
      : "";

    const codeBlock =
      `<pre><code${langAttr}>${escapedOutput}</code></pre>`;

    const text = `📄 <b>${escapeHtml(title)}</b>\n\n${codeBlock}`;

    return this.splitMessage(text);
  }

  formatFileList(files: string[], directory = ""): FormattedMessage {
    const safeDir = escapeHtml(directory);

    if (!files.length) {
      return {
        text: `📂 <b>${safeDir}</b>\n\n<i>(empty directory)</i>`,
        parseMode: "HTML",
      };
    }

    const fileLines: string[] = [];
    for (const file of files.slice(0, 50)) {
      const safeFile = escapeHtml(file);
      if (file.endsWith("/")) {
        fileLines.push(`📁 ${safeFile}`);
      } else {
        fileLines.push(`📄 ${safeFile}`);
      }
    }

    let fileText = fileLines.join("\n");
    if (files.length > 50) {
      fileText += `\n\n<i>... and ${files.length - 50} more items</i>`;
    }

    return {
      text: `📂 <b>${safeDir}</b>\n\n${fileText}`,
      parseMode: "HTML",
    };
  }

  formatProgressMessage(
    message: string,
    percentage?: number
  ): FormattedMessage {
    const safeMsg = escapeHtml(message);

    if (percentage !== undefined) {
      const filled = Math.floor(percentage / 10);
      const empty = 10 - filled;
      const bar = "▓".repeat(filled) + "░".repeat(empty);
      return {
        text: `🔄 <b>${safeMsg}</b>\n\n${bar} ${percentage.toFixed(0)}%`,
        parseMode: "HTML",
      };
    }

    return {
      text: `🔄 <b>${safeMsg}</b>`,
      parseMode: "HTML",
    };
  }

  private cleanText(text: string): string {
    text = text.replace(/\n{3,}/g, "\n\n");
    return text.trim();
  }

  private splitMessage(text: string): FormattedMessage[] {
    if (!text || !text.trim()) return [];
    if (text.length <= this.maxMessageLength) {
      return [{ text, parseMode: "HTML" }];
    }

    const messages: FormattedMessage[] = [];
    const lines = text.split("\n");
    let currentLines: string[] = [];
    let currentLength = 0;
    let inCodeBlock = false;

    for (const line of lines) {
      const lineLength = line.length + 1;

      if (line.includes("<pre>") || line.includes("<pre><code")) {
        inCodeBlock = true;
      }
      if (line.includes("</pre>")) {
        inCodeBlock = false;
      }

      if (lineLength > this.maxMessageLength) {
        const chunks: string[] = [];
        for (
          let i = 0;
          i < line.length;
          i += this.maxMessageLength - 100
        ) {
          chunks.push(
            line.slice(i, i + this.maxMessageLength - 100)
          );
        }

        for (const chunk of chunks) {
          const chunkLength = chunk.length + 1;

          if (
            currentLength + chunkLength > this.maxMessageLength &&
            currentLines.length > 0
          ) {
            if (inCodeBlock) {
              currentLines.push("</code></pre>");
            }
            messages.push({
              text: currentLines.join("\n"),
              parseMode: "HTML",
            });
            currentLines = [];
            currentLength = 0;
            if (inCodeBlock) {
              currentLines.push("<pre><code>");
              currentLength = 12;
            }
          }

          currentLines.push(chunk);
          currentLength += chunkLength;
        }
        continue;
      }

      if (
        currentLength + lineLength > this.maxMessageLength &&
        currentLines.length > 0
      ) {
        if (inCodeBlock) {
          currentLines.push("</code></pre>");
        }
        messages.push({
          text: currentLines.join("\n"),
          parseMode: "HTML",
        });
        currentLines = [];
        currentLength = 0;
        if (inCodeBlock) {
          currentLines.push("<pre><code>");
          currentLength = 12;
        }
      }

      currentLines.push(line);
      currentLength += lineLength;
    }

    if (currentLines.length > 0) {
      messages.push({ text: currentLines.join("\n"), parseMode: "HTML" });
    }

    return messages;
  }
}