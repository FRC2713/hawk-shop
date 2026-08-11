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
    readonly path: string
  ) {
    super(message);
    this.name = "ApiError";
  }
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
    // The session lapsed while the page stayed open. `requireAuth` on the
    // handlers deliberately does not refresh, so nothing renews the token until
    // a request travels through `/auth/onshape` — and a client-rendered app can
    // sit on one screen indefinitely, turning every query into an error with no
    // way back. Bounce through the auth route, which refreshes when it can and
    // otherwise starts a real sign-in.
    redirectToSignIn();
    // Still throw: the redirect is a navigation, not an unwind, and the caller
    // must not treat this as a successful response in the meantime.
  }

  if (!response.ok) {
    throw new ApiError(
      await readErrorMessage(
        response,
        fallbackError ?? `Request to ${path} failed`
      ),
      response.status,
      path
    );
  }

  return (await response.json()) as T;
}

/**
 * Send the browser into the OAuth gate, remembering where we were.
 *
 * Guarded because several queries fail together: the first 401 of a batch
 * should start exactly one navigation.
 */
let signInRedirectStarted = false;

function redirectToSignIn(): void {
  if (typeof window === "undefined" || signInRedirectStarted) return;
  signInRedirectStarted = true;

  const returnTo = window.location.pathname + window.location.search;
  window.location.href = `/auth/onshape?redirect=${encodeURIComponent(returnTo)}`;
}

/**
 * Pull the handler's `{ error }` string out of a failed response, falling back
 * to `fallback` when the body is missing, empty, or not the expected shape.
 */
async function readErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const body = await response.json();
    if (body && typeof body.error === "string" && body.error) {
      return body.error;
    }
  } catch {
    // Non-JSON or empty body — the fallback is the best we have.
  }
  return fallback;
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
