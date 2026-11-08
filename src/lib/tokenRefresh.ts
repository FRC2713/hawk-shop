import { refreshAccessToken as refreshOnshapeToken } from "./onshapeApi/auth";
import {
  clearOnshapeTokens,
  getOnshapeTokens,
  setOnshapeTokens,
} from "./onshapeAuth";
import {
  getOnshapeTokensFromRequest,
  hasUsableSession,
} from "./onshapeAuthRequest";

type CadSession = Awaited<ReturnType<typeof getOnshapeTokens>>;
type TokenResponse = Awaited<ReturnType<typeof refreshOnshapeToken>>;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
// Keep the completed exchange briefly for requests already carrying the old
// cookie. Every waiter writes the same rotated tokens to its own cookie jar.
const exchanges = new Map<string, Promise<TokenResponse>>();

export function needsRefresh(expiresAt: number | null): boolean {
  return !expiresAt || Date.now() >= expiresAt - REFRESH_BUFFER_MS;
}

export async function getOnshapeTokenWithoutRefresh(): Promise<string | null> {
  const session = await getOnshapeTokens();
  return hasUsableSession(session) ? session.accessToken : null;
}

async function refreshSession(session: CadSession): Promise<string | null> {
  const { accessToken, refreshToken, expiresAt } = session;
  if (!accessToken || !refreshToken) return null;
  if (!needsRefresh(expiresAt)) return accessToken;
  const clientId = process.env.ONSHAPE_CLIENT_ID;
  const clientSecret = process.env.ONSHAPE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    let exchange = exchanges.get(refreshToken);
    if (!exchange) {
      exchange = refreshOnshapeToken(refreshToken, clientId, clientSecret);
      exchanges.set(refreshToken, exchange);
      const retained = exchange;
      void exchange.then(
        () => {
          setTimeout(() => {
            if (exchanges.get(refreshToken) === retained)
              exchanges.delete(refreshToken);
          }, 10000).unref();
        },
        () => {
          if (exchanges.get(refreshToken) === retained)
            exchanges.delete(refreshToken);
        }
      );
    }
    const tokens = await exchange;
    await setOnshapeTokens(
      tokens.access_token,
      tokens.refresh_token,
      Date.now() + tokens.expires_in * 1000
    );
    return tokens.access_token;
  } catch {
    await clearOnshapeTokens();
    return null;
  }
}

export async function refreshOnshapeTokenIfNeeded(): Promise<string | null> {
  return refreshSession(await getOnshapeTokens());
}

export async function refreshOnshapeTokenIfNeededFromRequest(
  request: Request
): Promise<string | null> {
  return refreshSession(getOnshapeTokensFromRequest(request));
}

export const getValidOnshapeToken = refreshOnshapeTokenIfNeeded;
export const getValidOnshapeTokenFromRequest =
  refreshOnshapeTokenIfNeededFromRequest;
