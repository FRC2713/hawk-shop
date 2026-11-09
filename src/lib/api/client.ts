/**
 * The single fetch wrapper every `/api/*` call in the browser goes through.
 *
 * Every handler under `app/routes/api/` answers with JSON and reports failure
 * as `{ error: string }` alongside a non-2xx status, so the unwrapping is the
 * same everywhere and belongs in one place.
 *
 * The one deliberate exception is `/api/mfg/parts/actions`, which returns
 * `{ success: false, error }` with a 400 and means it as data rather than as a
 * transport failure — see `partActions.ts`.
 */

/**
 * A non-2xx response from an `/api/*` route.
 *
 * `message` is the handler's own `error` string when it sent one, so throwing
 * this straight into a toast produces the server's wording rather than a
 * generic "request failed".
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly errorId?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getErrorId(error: unknown): string | undefined {
  return error &&
    typeof error === "object" &&
    "errorId" in error &&
    typeof error.errorId === "string"
    ? error.errorId
    : undefined;
}

/** Render failures have no server response; keep their references distinct. */
export function identifyClientError(error: Error): Error & { errorId: string } {
  return Object.assign(error, {
    errorId: getErrorId(error) ?? `client-${crypto.randomUUID().slice(0, 8)}`,
  });
}

type ApiRequest = Omit<RequestInit, "body"> & {
  /** Serialized into the body with a JSON content-type. */
  json?: unknown;
  /** Passed through untouched — for `FormData` uploads. */
  body?: BodyInit | null;
  /** Used when the response carries no `error` string of its own. */
  fallbackError?: string;
};

/**
 * Call an `/api/*` route and return its parsed JSON body.
 *
 * @throws {ApiError} on any non-2xx response.
 */
export async function apiFetch<T>(
  path: string,
  { json, fallbackError, headers, ...init }: ApiRequest = {}
): Promise<T> {
  const response = await fetch(
    path,
    json === undefined
      ? { ...init, headers }
      : {
          ...init,
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(json),
        }
  );

  if (response.status === 401) {
    // Suite membership expired while this workflow was open.
    redirectToSignIn();
    // Still throw: the redirect is a navigation, not an unwind, and the caller
    // must not treat this as a successful response in the meantime.
  }

  if (!response.ok) {
    const failure = await readError(
      response,
      fallbackError ?? `Request to ${path} failed`
    );
    throw new ApiError(failure.message, response.status, path, failure.errorId);
  }

  return (await response.json()) as T;
}

/**
 * Send the browser to Hawk Suite sign-in, remembering where we were.
 *
 * Guarded because several queries fail together: the first 401 of a batch
 * should start exactly one navigation.
 */
let signInRedirectStarted = false;

export function redirectToSignIn(): void {
  if (typeof window === "undefined" || signInRedirectStarted) return;
  signInRedirectStarted = true;

  const returnTo = window.location.pathname + window.location.search;
  if (
    window.self !== window.top &&
    window.location.pathname === "/onshape_connector"
  ) {
    window.location.reload();
    return;
  }
  window.location.href = `/signin?redirect=${encodeURIComponent(returnTo)}`;
}

/**
 * Pull the handler's `{ error }` string out of a failed response, falling back
 * to `fallback` when the body is missing, empty, or not the expected shape.
 */
async function readError(
  response: Response,
  fallback: string
): Promise<{ message: string; errorId?: string }> {
  const headerId = response.headers.get("X-Error-ID") ?? undefined;
  try {
    const body = await response.json();
    if (body && typeof body.error === "string" && body.error) {
      return {
        message: body.error,
        errorId: typeof body.errorId === "string" ? body.errorId : headerId,
      };
    }
  } catch {
    // Non-JSON or empty body — the fallback is the best we have.
  }
  return { message: fallback, errorId: headerId };
}

/** Build a query string, dropping keys whose value is undefined. */
export function searchParams(
  params: Record<string, string | number | boolean | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  return search.toString();
}
