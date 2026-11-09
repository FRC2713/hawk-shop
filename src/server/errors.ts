import "virtual:hawk-shop/server-only";
import { randomBytes } from "node:crypto";

/** Keep the identifier and original stack in one log entry. Never log requests. */
export function logServerError(scope: string, error: unknown): string {
  const errorId = randomBytes(6).toString("hex");
  console.error(`[${scope}] errorId=${errorId}`, error);
  return errorId;
}
