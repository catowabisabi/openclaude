import { createHmac } from "crypto";

/**
 * Verify GitHub webhook HMAC-SHA256 signature.
 * GitHub signs the payload with HMAC-SHA256 using the secret key.
 * The signature is passed in the X-Hub-Signature-256 header as sha256=...
 */
export function verifyGitHubSignature(
  payload: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;

  const expected = `sha256=${createHmac("sha256", secret)
    .update(payload)
    .digest("hex")}`;

  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verify generic Bearer token auth.
 * The token is passed in the Authorization header as "Bearer <token>".
 */
export function verifyBearerToken(
  authorization: string | undefined,
  secret: string,
): boolean {
  if (!authorization) return false;

  const [scheme, token] = authorization.split(" ", 2);
  if (scheme !== "Bearer") return false;
  if (!token) return false;

  // Constant-time comparison to prevent timing attacks
  if (token.length !== secret.length) return false;

  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return mismatch === 0;
}