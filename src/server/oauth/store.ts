import "virtual:hawk-shop/server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db as database } from "~/server/db/client";
const db = () => database.$client;
const iso = (time: number) => new Date(time).toISOString();
import {
  ACCESS_TTL,
  CODE_TTL,
  GRANT_TTL,
  PENDING_TTL,
  UNUSED_CLIENT_TTL,
  type OAuthScope,
} from "./settings.js";

// SQL for MCP OAuth. Every secret is stored as a SHA-256 hash.

export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
/** A 256-bit random secret with a readable prefix. */
export const newSecret = (prefix: string): string =>
  prefix + randomBytes(32).toString("base64url");

export type Client = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
};
type ClientRow = {
  client_id: string;
  client_name: string;
  redirect_uris: string;
};
const toClient = (row: ClientRow): Client => ({
  clientId: row.client_id,
  clientName: row.client_name,
  redirectUris: JSON.parse(row.redirect_uris) as string[],
});

export function insertClient(
  clientName: string,
  redirectUris: string[],
  now: number
): Client {
  const clientId = newSecret("hsc_");
  db()
    .prepare(
      "INSERT INTO oauth_clients (client_id,client_name,redirect_uris,created_at) VALUES (?,?,?,?)"
    )
    .run(clientId, clientName, JSON.stringify(redirectUris), iso(now));
  return { clientId, clientName, redirectUris };
}

export function findClient(clientId: string): Client | undefined {
  const row = db()
    .prepare<[string], ClientRow>(
      "SELECT client_id,client_name,redirect_uris FROM oauth_clients WHERE client_id=?"
    )
    .get(clientId);
  return row ? toClient(row) : undefined;
}

export type Pending = {
  clientId: string;
  subject: string;
  redirectUri: string;
  codeChallenge: string;
  scope: OAuthScope[];
  state: string | null;
};
type PendingRow = {
  client_id: string;
  subject: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  state: string | null;
};
const toPending = (row: PendingRow): Pending => ({
  clientId: row.client_id,
  subject: row.subject,
  redirectUri: row.redirect_uri,
  codeChallenge: row.code_challenge,
  scope: row.scope.split(" ") as OAuthScope[],
  state: row.state,
});

/** Returns the request id the consent form posts back. */
export function insertPending(pending: Pending, now: number): string {
  const id = newSecret("");
  db()
    .prepare(
      "INSERT INTO oauth_pending (id_hash,client_id,subject,redirect_uri,code_challenge,scope,state,expires_at) VALUES (?,?,?,?,?,?,?,?)"
    )
    .run(
      sha256(id),
      pending.clientId,
      pending.subject,
      pending.redirectUri,
      pending.codeChallenge,
      pending.scope.join(" "),
      pending.state,
      iso(now + PENDING_TTL)
    );
  return id;
}

/** Removes and returns a live request, only for the person who opened it. */
export function takePending(
  id: string,
  subject: string,
  now: number
): Pending | undefined {
  return db()
    .transaction(() => {
      const row = db()
        .prepare<[string, string, string], PendingRow>(
          "SELECT client_id,subject,redirect_uri,code_challenge,scope,state FROM oauth_pending WHERE id_hash=? AND subject=? AND expires_at>?"
        )
        .get(sha256(id), subject, iso(now));
      if (row)
        db()
          .prepare("DELETE FROM oauth_pending WHERE id_hash=?")
          .run(sha256(id));
      return row ? toPending(row) : undefined;
    })
    .immediate();
}

/** Creates the grant and its one-use code. Returns the code. */
export function approvePending(pending: Pending, now: number): string {
  const code = newSecret("hsk_ac_");
  db()
    .transaction(() => {
      const grant = db()
        .prepare(
          "INSERT INTO oauth_grants (client_id,subject,redirect_uri,scope,created_at,expires_at) VALUES (?,?,?,?,?,?)"
        )
        .run(
          pending.clientId,
          pending.subject,
          pending.redirectUri,
          pending.scope.join(" "),
          iso(now),
          iso(now + GRANT_TTL)
        );
      const grantId = Number(grant.lastInsertRowid);
      db()
        .prepare(
          "UPDATE oauth_clients SET first_granted_at=? WHERE client_id=? AND first_granted_at IS NULL"
        )
        .run(iso(now), pending.clientId);
      db()
        .prepare(
          "INSERT INTO oauth_codes (code_hash,grant_id,redirect_uri,code_challenge,expires_at) VALUES (?,?,?,?,?)"
        )
        .run(
          sha256(code),
          grantId,
          pending.redirectUri,
          pending.codeChallenge,
          iso(now + CODE_TTL)
        );
      audit("grant_created", now, {
        subject: pending.subject,
        clientId: pending.clientId,
        grantId,
        detail: pending.scope.join(" "),
      });
    })
    .immediate();
  return code;
}

export type Tokens = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};
export type TokenFailure = {
  error: "invalid_grant" | "invalid_target" | "invalid_scope";
  description: string;
};
type GrantRow = {
  id: number;
  client_id: string;
  subject: string;
  scope: string;
  expires_at: string;
  revoked_at: string | null;
};
const grantLive = (grant: GrantRow, now: number) =>
  grant.revoked_at === null && grant.expires_at > iso(now);

function issueTokens(grant: GrantRow, now: number): Tokens {
  const access = newSecret("hsk_at_");
  const refresh = newSecret("hsk_rt_");
  const accessExpires = Math.min(
    now + ACCESS_TTL,
    Date.parse(grant.expires_at)
  );
  const insert = db().prepare(
    "INSERT INTO oauth_tokens (token_hash,grant_id,kind,expires_at) VALUES (?,?,?,?)"
  );
  insert.run(sha256(access), grant.id, "access", iso(accessExpires));
  insert.run(sha256(refresh), grant.id, "refresh", grant.expires_at);
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.max(1, Math.floor((accessExpires - now) / 1000)),
    refresh_token: refresh,
    scope: grant.scope,
  };
}

function revokeGrantRow(
  grantId: number,
  now: number,
  event: string,
  fields: AuditFields = {}
): void {
  const changed = db()
    .prepare(
      "UPDATE oauth_grants SET revoked_at=? WHERE id=? AND revoked_at IS NULL"
    )
    .run(iso(now), grantId).changes;
  db().prepare("DELETE FROM oauth_tokens WHERE grant_id=?").run(grantId);
  if (changed) audit(event, now, { ...fields, grantId });
}

const grantById = (id: number) =>
  db()
    .prepare<[number], GrantRow>(
      "SELECT id,client_id,subject,scope,expires_at,revoked_at FROM oauth_grants WHERE id=?"
    )
    .get(id);

function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(
    createHash("sha256").update(verifier).digest("base64url")
  );
  const expected = Buffer.from(challenge);
  return (
    computed.length === expected.length && timingSafeEqual(computed, expected)
  );
}

export function exchangeCode(
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    verifier: string;
  },
  now: number
): Tokens | TokenFailure {
  return db()
    .transaction((): Tokens | TokenFailure => {
      const row = db()
        .prepare<
          [string],
          {
            grant_id: number;
            redirect_uri: string;
            code_challenge: string;
            expires_at: string;
            used_at: string | null;
          }
        >(
          "SELECT grant_id,redirect_uri,code_challenge,expires_at,used_at FROM oauth_codes WHERE code_hash=?"
        )
        .get(sha256(input.code));
      const invalid: TokenFailure = {
        error: "invalid_grant",
        description: "The authorization code is invalid or expired.",
      };
      if (!row) return invalid;
      const grant = grantById(row.grant_id);
      if (!grant) return invalid;
      if (row.used_at !== null) {
        // RFC 6749 §4.1.2: a replayed code revokes what it issued.
        revokeGrantRow(grant.id, now, "code_replayed", {
          subject: grant.subject,
          clientId: grant.client_id,
        });
        return invalid;
      }
      db()
        .prepare("UPDATE oauth_codes SET used_at=? WHERE code_hash=?")
        .run(iso(now), sha256(input.code));
      if (
        row.expires_at <= iso(now) ||
        !grantLive(grant, now) ||
        grant.client_id !== input.clientId ||
        row.redirect_uri !== input.redirectUri
      )
        return invalid;
      if (!pkceMatches(input.verifier, row.code_challenge))
        return {
          error: "invalid_grant",
          description: "The PKCE code verifier does not match.",
        };
      audit("tokens_issued", now, {
        subject: grant.subject,
        clientId: grant.client_id,
        grantId: grant.id,
      });
      return issueTokens(grant, now);
    })
    .immediate();
}

export function refreshTokens(
  input: { refreshToken: string; clientId: string; scope: OAuthScope[] | null },
  now: number
): Tokens | TokenFailure {
  return db()
    .transaction((): Tokens | TokenFailure => {
      const invalid: TokenFailure = {
        error: "invalid_grant",
        description: "The refresh token is invalid or expired.",
      };
      const row = db()
        .prepare<
          [string],
          { grant_id: number; expires_at: string; used_at: string | null }
        >(
          "SELECT grant_id,expires_at,used_at FROM oauth_tokens WHERE token_hash=? AND kind='refresh'"
        )
        .get(sha256(input.refreshToken));
      if (!row) return invalid;
      const grant = grantById(row.grant_id);
      if (!grant || grant.client_id !== input.clientId) return invalid;
      if (row.used_at !== null) {
        // A rotated refresh token came back: assume it leaked.
        revokeGrantRow(grant.id, now, "refresh_replayed", {
          subject: grant.subject,
          clientId: grant.client_id,
        });
        return invalid;
      }
      if (row.expires_at <= iso(now) || !grantLive(grant, now)) return invalid;
      if (
        input.scope &&
        input.scope.some((s) => !grant.scope.split(" ").includes(s))
      )
        return {
          error: "invalid_scope",
          description: "A refresh cannot add access the grant does not have.",
        };
      db()
        .prepare("UPDATE oauth_tokens SET used_at=? WHERE token_hash=?")
        .run(iso(now), sha256(input.refreshToken));
      audit("tokens_refreshed", now, {
        subject: grant.subject,
        clientId: grant.client_id,
        grantId: grant.id,
      });
      return issueTokens(grant, now);
    })
    .immediate();
}

/** RFC 7009. Unknown tokens and other clients' tokens are ignored silently. */
export function revokeToken(token: string, clientId: string, now: number) {
  db()
    .transaction(() => {
      const row = db()
        .prepare<[string], { grant_id: number; kind: string }>(
          "SELECT grant_id,kind FROM oauth_tokens WHERE token_hash=?"
        )
        .get(sha256(token));
      if (!row) return;
      const grant = grantById(row.grant_id);
      if (!grant || grant.client_id !== clientId) return;
      if (row.kind === "refresh")
        revokeGrantRow(grant.id, now, "grant_revoked_by_client", {
          subject: grant.subject,
          clientId,
        });
      else
        db()
          .prepare("DELETE FROM oauth_tokens WHERE token_hash=?")
          .run(sha256(token));
    })
    .immediate();
}

export type OAuthPrincipal = {
  subject: string;
  scope: OAuthScope[];
  clientId: string;
  grantId: number;
};

export function principalForAccessToken(
  token: string,
  now: number
): OAuthPrincipal | undefined {
  const row = db()
    .prepare<
      [string, string, string],
      {
        id: number;
        client_id: string;
        subject: string;
        scope: string;
        last_used_at: string | null;
      }
    >(
      `SELECT g.id,g.client_id,g.subject,g.scope,g.last_used_at
       FROM oauth_tokens t JOIN oauth_grants g ON g.id=t.grant_id
       WHERE t.token_hash=? AND t.kind='access' AND t.expires_at>?
         AND g.revoked_at IS NULL AND g.expires_at>?`
    )
    .get(sha256(token), iso(now), iso(now));
  if (!row) return undefined;
  // Last-used is for the connections page; a minute of precision is plenty.
  if (row.last_used_at === null || now - Date.parse(row.last_used_at) > 60_000)
    db()
      .prepare("UPDATE oauth_grants SET last_used_at=? WHERE id=?")
      .run(iso(now), row.id);
  return {
    subject: row.subject,
    scope: row.scope.split(" ") as OAuthScope[],
    clientId: row.client_id,
    grantId: row.id,
  };
}

export type Connection = {
  grantId: number;
  clientName: string;
  redirectUri: string;
  scope: OAuthScope[];
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
};

export function listConnections(subject: string, now: number): Connection[] {
  return db()
    .prepare<
      [string, string],
      {
        id: number;
        client_name: string;
        redirect_uri: string;
        scope: string;
        created_at: string;
        expires_at: string;
        last_used_at: string | null;
      }
    >(
      `SELECT g.id,c.client_name,g.redirect_uri,g.scope,g.created_at,g.expires_at,g.last_used_at
       FROM oauth_grants g JOIN oauth_clients c ON c.client_id=g.client_id
       WHERE g.subject=? AND g.revoked_at IS NULL AND g.expires_at>?
       ORDER BY g.created_at DESC`
    )
    .all(subject, iso(now))
    .map((row) => ({
      grantId: row.id,
      clientName: row.client_name,
      redirectUri: row.redirect_uri,
      scope: row.scope.split(" ") as OAuthScope[],
      createdAt: Date.parse(row.created_at),
      expiresAt: Date.parse(row.expires_at),
      lastUsedAt:
        row.last_used_at === null ? null : Date.parse(row.last_used_at),
    }));
}

/** A member disconnects one of their own clients. */
export function disconnect(
  grantId: number,
  subject: string,
  now: number
): boolean {
  return db()
    .transaction(() => {
      const grant = grantById(grantId);
      if (!grant || grant.subject !== subject || !grantLive(grant, now))
        return false;
      revokeGrantRow(grant.id, now, "grant_revoked_by_member", {
        subject,
        clientId: grant.client_id,
      });
      return true;
    })
    .immediate();
}

/** Operator revocation. Returns how many live grants were revoked. */
export function revokeGrants(subject: string | null, now: number): number {
  return db()
    .transaction(() => {
      const ids = db()
        .prepare<
          [string | null, string | null, string],
          { id: number; subject: string; client_id: string }
        >(
          "SELECT id,subject,client_id FROM oauth_grants WHERE (? IS NULL OR subject=?) AND revoked_at IS NULL AND expires_at>?"
        )
        .all(subject, subject, iso(now));
      for (const grant of ids)
        revokeGrantRow(grant.id, now, "grant_revoked_by_operator", {
          subject: grant.subject,
          clientId: grant.client_id,
        });
      return ids.length;
    })
    .immediate();
}

type AuditFields = {
  subject?: string;
  clientId?: string;
  grantId?: number;
  detail?: string;
};
export function audit(event: string, now: number, fields: AuditFields = {}) {
  db()
    .prepare(
      "INSERT INTO oauth_audit (at,event,subject,client_id,grant_id,detail) VALUES (?,?,?,?,?,?)"
    )
    .run(
      iso(now),
      event,
      fields.subject ?? null,
      fields.clientId ?? null,
      fields.grantId ?? null,
      fields.detail ?? null
    );
}

/** Token bucket for the public endpoints. Returns false when empty. */
export function takeRateToken(
  bucket: string,
  capacity: number,
  refillMs: number,
  now: number
): boolean {
  return db()
    .transaction(() => {
      const row = db()
        .prepare<[string], { tokens: number; updated_at: string }>(
          "SELECT tokens,updated_at FROM oauth_rate_limits WHERE bucket=?"
        )
        .get(bucket);
      const tokens = row
        ? Math.min(
            capacity,
            row.tokens +
              Math.max(0, now - Date.parse(row.updated_at)) / refillMs
          )
        : capacity;
      if (tokens < 1) return false;
      db()
        .prepare(
          "INSERT INTO oauth_rate_limits VALUES (?,?,?) ON CONFLICT(bucket) DO UPDATE SET tokens=excluded.tokens,updated_at=excluded.updated_at"
        )
        .run(bucket, tokens - 1, iso(now));
      return true;
    })
    .immediate();
}

/** Drops expired rows, old grants, and clients that never got a grant.
 * Audit rows stay. */
export function sweep(now: number): void {
  db()
    .transaction(() => {
      db()
        .prepare("DELETE FROM oauth_pending WHERE expires_at<=?")
        .run(iso(now));
      db()
        .prepare("DELETE FROM oauth_tokens WHERE expires_at<=?")
        .run(iso(now));
      // Keep used codes until their grant goes, so a late replay still revokes.
      db()
        .prepare(
          "DELETE FROM oauth_grants WHERE expires_at<=? OR revoked_at<=?"
        )
        .run(iso(now - GRANT_TTL), iso(now - GRANT_TTL));
      db()
        .prepare(
          "DELETE FROM oauth_clients WHERE first_granted_at IS NULL AND created_at<=?"
        )
        .run(iso(now - UNUSED_CLIENT_TTL));
      db()
        .prepare("DELETE FROM oauth_rate_limits WHERE updated_at<=?")
        .run(iso(now - UNUSED_CLIENT_TTL));
    })
    .immediate();
}
