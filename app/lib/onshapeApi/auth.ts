/**
 * Onshape OAuth 2.0 Authentication Utilities
 * Documentation: https://onshape-public.github.io/docs/auth/
 */

const ONSHAPE_AUTHORIZATION_URL = "https://oauth.onshape.com/oauth/authorize";
const ONSHAPE_TOKEN_URL = "https://oauth.onshape.com/oauth/token";

export interface OnshapeTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface OnshapeAuthState {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
}

/**
 * Generate authorization URL for Onshape OAuth flow
 *
 * Note: Onshape may derive scopes from your app registration in their developer portal.
 * If you get "invalid_scope" errors, try omitting the scope parameter entirely
 * or check what scopes are configured in your Onshape app registration.
 */
export function getAuthorizationUrl(
  redirectUri: string,
  clientId: string,
  state?: string
): string {
  console.log("[AUTH URL] Generating authorization URL");
  console.log("[AUTH URL] redirectUri:", redirectUri);
  console.log(
    "[AUTH URL] clientId:",
    clientId ? `${clientId.substring(0, 8)}...` : "(missing)"
  );
  console.log(
    "[AUTH URL] state:",
    state ? `${state.substring(0, 16)}...` : "(missing)"
  );

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
  });

  // Onshape scopes are configured in the app registration.
  // Only include scope parameter if explicitly set in environment variable.
  // If omitted, Onshape will use the scopes from your app registration.
  const scope = process.env.ONSHAPE_SCOPE;
  if (scope) {
    params.append("scope", scope);
    console.log("[AUTH URL] scope:", scope);
  } else {
    console.log("[AUTH URL] scope: (using app registration defaults)");
  }

  if (state) {
    params.append("state", state);
  }

  const authUrl = `${ONSHAPE_AUTHORIZATION_URL}?${params.toString()}`;
  console.log("[AUTH URL] Generated authorization URL:", authUrl);
  return authUrl;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string
): Promise<OnshapeTokenResponse> {
  console.log("[TOKEN EXCHANGE] Exchanging code for token");
  console.log("[TOKEN EXCHANGE] redirectUri:", redirectUri);
  console.log(
    "[TOKEN EXCHANGE] clientId:",
    clientId ? `${clientId.substring(0, 8)}...` : "(missing)"
  );
  console.log(
    "[TOKEN EXCHANGE] code:",
    code ? `${code.substring(0, 16)}...` : "(missing)"
  );
  console.log("[TOKEN EXCHANGE] Token URL:", ONSHAPE_TOKEN_URL);

  const response = await fetch(ONSHAPE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }).toString(),
  });

  console.log("[TOKEN EXCHANGE] Response status:", response.status);
  console.log("[TOKEN EXCHANGE] Response ok:", response.ok);

  if (!response.ok) {
    const error = await response.text();
    console.error("[TOKEN EXCHANGE] Token exchange failed:", error);
    throw new Error(`Token exchange failed: ${error}`);
  }

  const tokenResponse = await response.json();
  console.log("[TOKEN EXCHANGE] Token exchange successful");
  return tokenResponse;
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<OnshapeTokenResponse> {
  const response = await fetch(ONSHAPE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  return await response.json();
}

/**
 * Make authenticated request to Onshape API
 */
export async function onshapeApiRequest(
  accessToken: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  // Onshape API base URL
  const baseUrl = endpoint.startsWith("http")
    ? ""
    : "https://cad.onshape.com/api";
  const url = endpoint.startsWith("http") ? endpoint : `${baseUrl}${endpoint}`;

  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
  });
}
