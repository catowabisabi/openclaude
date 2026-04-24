import type { NextHandler } from "../types.js";

export interface AuthContext {
  userId: number;
  username?: string;
  isAllowed: boolean;
}

export type AuthMiddleware = (
  ctx: AuthContext,
  next: NextHandler
) => Promise<Response | void>;

export function createAuthMiddleware(allowedUsers?: number[]): AuthMiddleware {
  return async (ctx, next) => {
    if (allowedUsers && allowedUsers.length > 0) {
      if (!allowedUsers.includes(ctx.userId)) {
        return new Response("Unauthorized", { status: 403 });
      }
    }
    return next();
  };
}
