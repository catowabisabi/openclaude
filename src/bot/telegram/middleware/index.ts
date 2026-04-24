export * from "./auth.js";
export * from "./rate-limit.js";
export * from "./security.js";

import type { AuthContext } from "./auth.js";
import type { NextHandler } from "../types.js";

export type { AuthMiddleware, AuthContext };
export type { RateLimitMiddleware };
export type { SecurityMiddleware };

export function composeMiddleware(
  middlewares: Array<(ctx: AuthContext, next: NextHandler) => Promise<Response | void>>,
  handler: NextHandler
): NextHandler {
  return async () => {
    let index = 0;
    const dispatch = async (i: number): Promise<Response | void> => {
      if (i >= middlewares.length) {
        return handler();
      }
      const mw = middlewares[i];
      return mw({ userId: 0 }, () => dispatch(i + 1));
    };
    return dispatch(0);
  };
}