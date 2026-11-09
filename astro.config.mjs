import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

// Existing integration modules read runtime environment variables. Keep .env
// usable locally without embedding those values in the browser bundle.
for (const [name, value] of Object.entries(
  loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "")
)) {
  process.env[name] ??= value;
}

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    react(),
    {
      name: "hawk-shop-startup",
      hooks: {
        "astro:build:done": ({ dir }) => {
          const entry = new URL("../server/entry.mjs", dir);
          writeFileSync(
            entry,
            'import "./startup.mjs";\n' + readFileSync(entry, "utf8")
          );
        },
      },
    },
  ],
  session: false,
  security: {
    checkOrigin: true,
    allowedDomains: process.env.APP_URL
      ? [
          {
            hostname: new URL(process.env.APP_URL).hostname,
            protocol: new URL(process.env.APP_URL).protocol.replace(":", ""),
          },
        ]
      : [],
  },
  server: {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 3000),
  },
  vite: {
    ssr: { external: ["better-sqlite3"] },
    plugins: [
      tailwindcss(),
      {
        name: "hawk-shop-worker-entry",
        buildStart() {
          if (this.environment.config.consumer === "server")
            this.emitFile({
              type: "chunk",
              id: fileURLToPath(
                new URL("./src/server/startup.ts", import.meta.url)
              ),
              fileName: "startup.mjs",
            });
        },
      },
      {
        name: "hawk-shop-server-only",
        resolveId(id, _importer, options) {
          if (id !== "virtual:hawk-shop/server-only") return;
          if (!options?.ssr)
            throw new Error(
              `A server-only Hawk Shop module was imported by browser code: ${_importer}`
            );
          return "\0hawk-shop/server-only";
        },
        load(id) {
          if (id === "\0hawk-shop/server-only") return "export {};";
        },
      },
    ],
  },
});
