import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    // Picks up the `~/*` -> `./app/*` alias from tsconfig.json.
    tsconfigPaths: true,
  },
  ssr: {
    // better-sqlite3 is a native addon — it has to be required at runtime
    // rather than bundled into the server build.
    external: ["better-sqlite3"],
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      // The app was laid out as `app/` under Next, and `~/*` already points
      // there. Keeping it as the src directory means every existing import in
      // the tree stays valid; only the routing layer moves.
      srcDirectory: "app",
    }),
    viteReact(),
    nitro(),
  ],
});
