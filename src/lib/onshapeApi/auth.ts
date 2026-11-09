import "virtual:hawk-shop/server-only";
import { createHmac, randomBytes } from "node:crypto";
import { recordOnshapeRemaining } from "./remaining";

export class OnshapeConfigurationError extends Error {
  constructor() {
    super(
      "Onshape API access is not configured. Set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY on the server."
    );
  }
}

/** Onshape answered 402: the API allocation behind this call is used up. */
export class OnshapeAllocationExhaustedError extends Error {
  constructor() {
    super("Onshape API allocation used up.");
  }
}

export function onshapeOrigin(): string {
  const url = new URL(
    process.env.ONSHAPE_BASE_URL || "https://cad.onshape.com"
  );
  if (!isOnshapeUrl(url) || url.pathname !== "/" || url.search || url.hash)
    throw new Error("ONSHAPE_BASE_URL must be an HTTPS Onshape origin.");
  return url.origin;
}

export function isOnshapeUrl(value: string | URL): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      (url.hostname === "onshape.com" || url.hostname.endsWith(".onshape.com"))
    );
  } catch {
    return false;
  }
}

export function isOnshapeConfigured(): boolean {
  return Boolean(
    process.env.ONSHAPE_ACCESS_KEY?.trim() &&
    process.env.ONSHAPE_SECRET_KEY?.trim()
  );
}

/** Sign the exact method, content type, encoded path and query on the wire.
 * Contract: https://onshape-public.github.io/docs/auth/apikeys/ */
export function signedOnshapeHeaders(
  request: Request,
  accessKey: string,
  secretKey: string,
  nonce = randomBytes(20).toString("hex"),
  date = new Date().toUTCString()
): Headers {
  if (!isOnshapeUrl(request.url))
    throw new Error(
      "Refusing to send Onshape credentials outside HTTPS Onshape hosts."
    );
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.delete("Cookie");
  headers.delete("Proxy-Authorization");
  headers.set(
    "Content-Type",
    headers.get("Content-Type") || "application/json"
  );
  headers.set("Accept", headers.get("Accept") || "application/json");
  headers.set("On-Nonce", nonce);
  headers.set("Date", date);
  const canonical = [
    request.method,
    nonce,
    date,
    headers.get("Content-Type"),
    url.pathname,
    url.search.slice(1),
    "",
  ]
    .join("\n")
    .toLowerCase();
  const signature = createHmac("sha256", secretKey)
    .update(canonical)
    .digest("base64");
  headers.set("Authorization", `On ${accessKey}:HmacSHA256:${signature}`);
  return headers;
}

/** The sole HTTP transport for generated clients, hand-written calls and images.
 * Never auto-follow a redirect with an old signature. Re-sign a bounded Onshape
 * 307/308 redirect and reject every other destination or redirect policy. */
export async function onshapeFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const accessKey = process.env.ONSHAPE_ACCESS_KEY?.trim();
  const secretKey = process.env.ONSHAPE_SECRET_KEY?.trim();
  if (!accessKey || !secretKey) throw new OnshapeConfigurationError();
  const original = new Request(input, init);
  const bytes = original.body
    ? new Uint8Array(await original.arrayBuffer())
    : undefined;
  let url = original.url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const request = new Request(url, {
      method: original.method,
      headers: original.headers,
      body: bytes,
      signal: original.signal,
      redirect: "manual",
    });
    const headers = signedOnshapeHeaders(request, accessKey, secretKey);
    const response = await globalThis.fetch(
      new Request(request, { headers, redirect: "manual" })
    );
    // Every response, errors included, may carry Onshape's remaining count.
    recordOnshapeRemaining(url, response);
    if (response.status < 300 || response.status >= 400) return response;
    if (![307, 308].includes(response.status))
      throw new Error("Onshape returned an unsupported redirect.");
    const location = response.headers.get("location");
    if (!location || redirects === 5)
      throw new Error("Onshape redirect limit exceeded or location missing.");
    const next = new URL(location, url);
    if (!isOnshapeUrl(next))
      throw new Error("Onshape redirected outside an allowed HTTPS host.");
    await response.body?.cancel();
    url = next.href;
  }
  throw new Error("Onshape redirect limit exceeded.");
}

export async function onshapeApiRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = endpoint.startsWith("https://")
    ? endpoint
    : `${onshapeOrigin()}/api${endpoint}`;
  return onshapeFetch(url, options);
}
