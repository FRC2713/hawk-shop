/**
 * Build a redirect response whose headers stay mutable.
 *
 * `Response.redirect()` is specified to produce immutable headers, and the auth
 * routes depend on the server runtime appending their `Set-Cookie` headers to
 * whatever they return. The runtime does cope with an immutable response by
 * rebuilding it, but constructing a plain Response keeps the cookie merge on
 * the straightforward path instead of a fallback.
 */
export function redirectResponse(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { Location: location },
  });
}
