import { resolve } from "path";
import type { AuthContext, NextHandler } from "../types.js";

export type SecurityMiddleware = (
  ctx: AuthContext,
  next: NextHandler
) => Promise<Response | void>;

const DANGEROUS_PATTERNS = [
  /\.\./,           // path traversal
  /;/,              // command separator
  /&&/,             // command chaining
  /\$\(/,           // command substitution
  /\|/,             // pipe
  />/,              // redirect
  /</,              // redirect input
];

const SECRET_FILES = [
  ".env",
  ".ssh",
  "id_rsa",
  ".pem",
  ".p12",
  ".pfx",
  "cookies",
  "credentials",
];

const DISABLE_SECURITY_PATTERNS = process.env.DISABLE_SECURITY_PATTERNS === "true";
const DISABLE_TOOL_VALIDATION = process.env.DISABLE_TOOL_VALIDATION === "true";
const APPROVED_DIRECTORY = process.env.APPROVED_DIRECTORY ?? "";

export function createSecurityMiddleware(
  approvedDir: string = APPROVED_DIRECTORY,
  disablePatterns: boolean = DISABLE_SECURITY_PATTERNS
): SecurityMiddleware {
  return async (ctx, next) => {
    if (disablePatterns) {
      return next();
    }

    return next();
  };
}

export function validateInput(input: string): boolean {
  if (DISABLE_SECURITY_PATTERNS) return true;

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(input)) {
      return false;
    }
  }
  return true;
}

export function validateFilePath(filePath: string, workingDir: string): boolean {
  if (DISABLE_SECURITY_PATTERNS) return true;

  const fullPath = resolve(workingDir, filePath);
  if (!fullPath.startsWith(workingDir)) {
    return false;
  }

  for (const secret of SECRET_FILES) {
    if (fullPath.includes(secret)) {
      return false;
    }
  }
  return true;
}

export function validateToolName(toolName: string): boolean {
  if (DISABLE_TOOL_VALIDATION) return true;

  const allowedTools = [
    "bash",
    "read",
    "write",
    "edit",
    "glob",
    "grep",
    "lsp",
    "websearch",
    "webfetch",
  ];
  return allowedTools.includes(toolName);
}
