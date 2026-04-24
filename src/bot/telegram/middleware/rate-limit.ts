import type { AuthContext, NextHandler } from "../types.js";

interface RateLimitState {
  tokens: number;
  lastRefill: number;
}

export type RateLimitMiddleware = (
  ctx: AuthContext,
  next: NextHandler
) => Promise<Response | void>;

export function createRateLimitMiddleware(
  tokens: number = 100,
  refillPerSecond: number = 10
): RateLimitMiddleware {
  const states = new Map<number, RateLimitState>();

  return async (ctx, next) => {
    const now = Date.now();
    let state = states.get(ctx.userId);

    if (!state) {
      state = { tokens, lastRefill: now };
      states.set(ctx.userId, state);
    }

    const elapsed = (now - state.lastRefill) / 1000;
    state.tokens = Math.min(tokens, state.tokens + elapsed * refillPerSecond);
    state.lastRefill = now;

    if (state.tokens < 1) {
      return new Response("Too Many Requests", { status: 429 });
    }

    state.tokens -= 1;
    return next();
  };
}
