import "virtual:hawk-shop/server-only";
import { workflowErrorResponse } from "~/server/kanbanApi/workflowResponses";
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
export function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {}
) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
export function errorResponse(error: unknown) {
  return error instanceof ApiError
    ? json(
        { error: error.code, error_description: error.message },
        error.status
      )
    : workflowErrorResponse("MCP OAUTH", error);
}
export async function readBody(
  request: Request,
  maximum = 262144
): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader)
    throw new ApiError(400, "invalid_request", "A request body is required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new ApiError(413, "invalid_request", "Request body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError(400, "invalid_request", "Use valid UTF-8 JSON");
  }
}
