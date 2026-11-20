import Database from "better-sqlite3";
import path from "node:path";

const [flag, subject] = process.argv.slice(2);
if (!(
  (flag === "--all" && subject === undefined) ||
  (flag === "--subject" &&
    subject &&
    /^slack:T[A-Z0-9]+:[UW][A-Z0-9]+$/.test(subject))
))
  throw new Error(
    "Usage: npm run oauth:revoke -- --subject slack:<team>:<user> | --all"
  );
const sqlite = new Database(
  process.env.DATABASE_PATH ||
    path.join(process.env.DATA_DIR || "./data", "hawk-shop.db"),
  { fileMustExist: true }
);
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");
try {
  const now = new Date().toISOString();
  const count = sqlite
    .transaction(() => {
      const grants = sqlite
        .prepare(
          "SELECT id,subject,client_id FROM oauth_grants WHERE (? IS NULL OR subject=?) AND revoked_at IS NULL AND expires_at>?"
        )
        .all(
          flag === "--all" ? null : subject,
          flag === "--all" ? null : subject,
          now
        );
      for (const grant of grants) {
        sqlite
          .prepare("UPDATE oauth_grants SET revoked_at=? WHERE id=?")
          .run(now, grant.id);
        sqlite
          .prepare("DELETE FROM oauth_tokens WHERE grant_id=?")
          .run(grant.id);
        sqlite
          .prepare(
            "INSERT INTO oauth_audit (at,event,subject,client_id,grant_id) VALUES (?,?,?,?,?)"
          )
          .run(
            now,
            "grant_revoked_by_operator",
            grant.subject,
            grant.client_id,
            grant.id
          );
      }
      return grants.length;
    })
    .immediate();
  console.log(`Revoked ${count} MCP connection${count === 1 ? "" : "s"}.`);
} finally {
  sqlite.close();
}
