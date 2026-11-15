import "virtual:hawk-shop/server-only";

/**
 * The Onshape gateway: the one path server code takes to reach Onshape.
 *
 * A caller describes a read or a write. The gateway decides caching,
 * single-flight, the usage tally, the 402 mapping and the daily budget guard,
 * so a new Onshape feature cannot forget any of them. Onshape's allocation is
 * yearly (see docs/ONSHAPE.md#allocation-and-billing): a miss is permanent
 * spend, staleness is cheap.
 *
 * - **Durable cache** (`onshape_api_cache`) survives `docker compose up`.
 *   Expired rows stay readable so the budget guard can serve them stale.
 * - **Single-flight** in process: concurrent identical reads share one call.
 * - **Tally**: a successful upstream response is a `call`, an answer from the
 *   cache or a shared in-flight request is a `hit`. Failed responses (4xx/5xx)
 *   are neither cached nor counted, because Onshape does not charge them.
 *
 * The adapter is the seam: the real one is the signed HTTP transport
 * (`onshapeFetch`), tests substitute an in-memory one with `useOnshapeAdapter`.
 * The transport, not the gateway, records the remaining-calls header, so an
 * in-memory adapter records nothing. Cache rows are read and written through
 * `./cache`; the gateway owns only the read policy.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import {
  assertOnshapeAllocation,
  isOnshapeConfigured,
  OnshapeConfigurationError,
  OnshapeDailyBudgetError,
  onshapeFetch,
  onshapeOrigin,
} from "./auth";
import {
  onshapeCallsToday,
  onshapeInflight as inflight,
  readOnshapeCache,
  recordOnshapeUsage,
  writeOnshapeCache,
} from "./cache";

/** Fixed usage labels, one per feature, as they appear in `/api/onshape/usage`. */
export type OnshapeUsageLabel =
  | "parts"
  | "version"
  | "thumbnail"
  | "metadata-read"
  | "metadata-write"
  | "webhook-register"
  | "webhook-list"
  | "webhook-delete";

/** One Onshape request. `path` is under `/api` (for example `/v12/parts/...`),
 * or an absolute Onshape URL such as a thumbnail href. */
export type OnshapeRequest = {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON-serialized as the request body. */
  body?: unknown;
  headers?: Record<string, string>;
};

/** Sends one prepared request to Onshape and returns its final response. */
export type OnshapeAdapter = (request: Request) => Promise<Response>;

/** What a binary read (`responseType: "binary"`) resolves to. */
export type OnshapeBinary = { bytes: Uint8Array; contentType: string | null };

/** A non-OK Onshape response other than 402. Never cached, never counted. */
export class OnshapeRequestError extends Error {
  constructor(
    readonly status: number,
    /** Onshape's own reason, when its answer carried one. */
    readonly detail: string
  ) {
    super(`Onshape API error ${status}${detail ? `: ${detail}` : ""}`);
  }
}

const signedTransport: OnshapeAdapter = (request) => onshapeFetch(request);

const globalForGateway = globalThis as unknown as {
  __onshapeAdapter?: OnshapeAdapter;
};

/** Substitute the adapter (tests). Returns a function that restores the previous one. */
export function useOnshapeAdapter(adapter: OnshapeAdapter): () => void {
  const previous = globalForGateway.__onshapeAdapter;
  globalForGateway.__onshapeAdapter = adapter;
  return () => {
    globalForGateway.__onshapeAdapter = previous;
  };
}

function adapter(): OnshapeAdapter {
  return globalForGateway.__onshapeAdapter ?? signedTransport;
}

/**
 * Today's spending ceiling from `ONSHAPE_DAILY_CALL_LIMIT`. Unset, empty,
 * non-positive or non-integer means no limit, so existing installs behave as
 * before until an operator opts in.
 */
export function onshapeDailyCallLimit(): number | null {
  const raw = process.env.ONSHAPE_DAILY_CALL_LIMIT?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const limit = Number(raw);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : null;
}

/** The configured limit, today's (UTC) tallied calls, and whether the guard is active. */
export function onshapeBudgetStatus(): {
  limit: number | null;
  today: number;
  reached: boolean;
} {
  const limit = onshapeDailyCallLimit();
  const today = onshapeCallsToday();
  return { limit, today, reached: limit !== null && today >= limit };
}

/** Operations already admitted past the guard (see `onshapeOperation`). */
const admitted = new AsyncLocalStorage<true>();

function budgetReached(): boolean {
  return !admitted.getStore() && onshapeBudgetStatus().reached;
}

/**
 * Run a multi-step operation (a part-number write with its discovery and
 * verification reads) under one budget check. The guard is checked once, at
 * the start; steps inside are not interrupted when the ceiling is crossed
 * part-way, so a half-finished write never leaves Onshape and a card disagreeing.
 */
export async function onshapeOperation<T>(run: () => Promise<T>): Promise<T> {
  if (budgetReached()) throw new OnshapeDailyBudgetError();
  return admitted.run(true, run);
}

function buildRequest(description: OnshapeRequest): Request {
  const url = new URL(
    description.path.startsWith("https://")
      ? description.path
      : `${onshapeOrigin()}/api${description.path}`
  );
  for (const [name, value] of Object.entries(description.query ?? {}))
    if (value !== undefined) url.searchParams.set(name, String(value));
  const headers = new Headers(description.headers);
  const hasBody = description.body !== undefined;
  if (hasBody && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  return new Request(url, {
    method: description.method ?? "GET",
    headers,
    body: hasBody ? JSON.stringify(description.body) : undefined,
  });
}

async function failureDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    try {
      const body = JSON.parse(text) as { message?: unknown };
      if (typeof body.message === "string") return body.message;
    } catch {
      // Not JSON; fall through to the raw text.
    }
    return text.slice(0, 200);
  } catch {
    return "";
  }
}

/**
 * Send one request and tally it. A successful response is counted as soon as it
 * arrives, before its body is read: Onshape charged for it even if the body
 * then turns out to be malformed or the stream breaks.
 */
async function send(
  label: OnshapeUsageLabel,
  description: OnshapeRequest,
  responseType: "json" | "binary" | "none"
): Promise<unknown> {
  if (!isOnshapeConfigured()) throw new OnshapeConfigurationError();
  const response = await adapter()(buildRequest(description));
  if (!response.ok) {
    assertOnshapeAllocation(response);
    throw new OnshapeRequestError(
      response.status,
      await failureDetail(response)
    );
  }
  recordOnshapeUsage(label, "call");
  if (responseType === "none") {
    // Release the unused body without letting its stream fail the caller.
    void response.body?.cancel().catch(() => {});
    return null;
  }
  if (responseType === "binary")
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type"),
    } satisfies OnshapeBinary;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Where a read's answer came from: `upstream` when this read paid for an
 * Onshape call, `cache` for a stored answer (fresh, or expired and served
 * under the daily ceiling), `shared` when it rode along on another read's call.
 */
export type OnshapeReadSource = "upstream" | "cache" | "shared";

type ReadOptions = {
  label: OnshapeUsageLabel;
  request: OnshapeRequest;
  /**
   * Told where a successful answer came from, before it is returned. Only the
   * read that made the Onshape call hears `upstream`. Must not throw.
   */
  onSource?: (source: OnshapeReadSource) => void;
} & (
  | {
      /** Durable cache entry; `ttlMs: null` never expires. */
      cache: { key: string; ttlMs: number | null };
      dedupKey?: never;
      singleFlight?: never;
    }
  | {
      cache?: never;
      /** Single-flight key for an uncached read. */
      dedupKey: string;
      singleFlight?: never;
    }
  | {
      cache?: never;
      dedupKey?: never;
      /**
       * Opt out of sharing: this read always makes its own call, for a step
       * that must see Onshape's current answer (a write's discovery and
       * verification reads).
       */
      singleFlight: false;
    }
);

/**
 * Read from Onshape. With `cache`, a stored answer is returned without a call;
 * without it, `dedupKey` still shares one call among concurrent identical reads,
 * and `singleFlight: false` shares nothing.
 * Either way the call is tallied under `label` and checked against the daily
 * ceiling: once reached, a cached read returns its stored answer even if
 * expired, and a read with nothing stored throws `OnshapeDailyBudgetError`.
 */
export function onshapeRead<T>(
  options: ReadOptions & { responseType?: "json" }
): Promise<T>;
export function onshapeRead(
  options: ReadOptions & { responseType: "binary" }
): Promise<OnshapeBinary>;
export async function onshapeRead(
  options: ReadOptions & { responseType?: "json" | "binary" }
): Promise<unknown> {
  const { label, cache, request, responseType = "json", onSource } = options;
  const key = cache?.key ?? options.dedupKey;

  const cached = cache
    ? readOnshapeCache(cache.key)
    : ({ hit: false } as const);
  if (cached.hit && !cached.expired) {
    recordOnshapeUsage(label, "hit");
    onSource?.("cache");
    return cached.value;
  }

  const pending = key === undefined ? undefined : inflight.get(key);
  if (pending) {
    // Someone else is already paying for this exact request: ride along. The
    // hit is recorded only once it succeeds; failed reads are never counted.
    const value = await pending;
    recordOnshapeUsage(label, "hit");
    onSource?.("shared");
    return value;
  }

  if (budgetReached()) {
    if (cached.hit) {
      recordOnshapeUsage(label, "hit");
      onSource?.("cache");
      return cached.value;
    }
    throw new OnshapeDailyBudgetError();
  }

  if (key === undefined) {
    const value = await send(label, request, responseType);
    onSource?.("upstream");
    return value;
  }

  let flight!: Promise<unknown>;
  flight = (async () => {
    const value = await send(label, request, responseType);
    if (cache && inflight.get(key) === flight)
      writeOnshapeCache(cache.key, value, cache.ttlMs);
    return value;
  })();
  inflight.set(key, flight);
  try {
    const value = await flight;
    onSource?.("upstream");
    return value;
  } finally {
    if (inflight.get(key) === flight) inflight.delete(key);
  }
}

/**
 * Write to Onshape. Never cached or deduplicated; tallied as a call on success
 * and refused with `OnshapeDailyBudgetError` once the daily ceiling is reached
 * (unless inside an `onshapeOperation` that was admitted before it).
 * `responseType: "none"` discards the body, so a malformed or broken one
 * cannot hide that Onshape accepted the write; it resolves to null.
 */
export async function onshapeWrite<T>({
  label,
  request,
  responseType = "json",
}: {
  label: OnshapeUsageLabel;
  request: OnshapeRequest;
  responseType?: "json" | "none";
}): Promise<T> {
  if (budgetReached()) throw new OnshapeDailyBudgetError();
  return (await send(label, { method: "POST", ...request }, responseType)) as T;
}
