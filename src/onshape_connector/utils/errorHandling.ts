import type { ActionResponse } from "./types";

/**
 * Extract error message and details from unknown error type
 */
export function extractErrorDetails(
  error: unknown,
  defaultMessage: string
): { message: string; status?: number } {
  let errorMessage = defaultMessage;
  let errorStatus: number | undefined;

  if (error && typeof error === "object") {
    if ("message" in error) {
      errorMessage = String(error.message);
    }
    if ("status" in error) {
      errorStatus = Number(error.status);
    }

    // Check response object for status and detailed error message
    if (
      "response" in error &&
      error.response &&
      typeof error.response === "object"
    ) {
      if ("status" in error.response) {
        errorStatus = Number(error.response.status);
      }

      try {
        if ("data" in error.response && error.response.data) {
          const data = error.response.data;
          if (typeof data === "object" && data !== null) {
            if ("error" in data) {
              errorMessage = String(data.error);
            } else if ("message" in data) {
              errorMessage = String(data.message);
            }
          }
        }
      } catch (e) {
        // Ignore parsing errors
      }
    }

    // Check nested error object
    if ("error" in error && error.error && typeof error.error === "object") {
      if ("message" in error.error) {
        errorMessage = String(error.error.message);
      }
      if ("status" in error.error) {
        errorStatus = Number(error.error.status);
      }
    }
  }

  return { message: errorMessage, status: errorStatus };
}

/**
 * Create an error response from an unknown error
 */
export function createErrorResponse(
  error: unknown,
  defaultMessage: string,
  cookie?: string
): ActionResponse {
  const { message, status } = extractErrorDetails(error, defaultMessage);

  const response: ActionResponse = {
    success: false,
    error: status ? `${message} (Status: ${status})` : message,
  };

  if (cookie) {
    response.headers = {
      "Set-Cookie": cookie,
    };
  }

  return response;
}
