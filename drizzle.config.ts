import path from "node:path";
import { defineConfig } from "drizzle-kit";

const dataDir = path.resolve(process.env.DATA_DIR || "./data");

export default defineConfig({
  dialect: "sqlite",
  schema: "./app/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_PATH || path.join(dataDir, "hawk-shop.db"),
  },
  strict: true,
  verbose: true,
});
