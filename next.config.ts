import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with a self-contained server.js, so the runtime image
  // does not need the full node_modules tree.
  output: "standalone",

  // better-sqlite3 is a native addon — it has to be required at runtime rather
  // than bundled into the server build.
  serverExternalPackages: ["better-sqlite3"],

  images: {
    // Every image the app renders is served from this origin: uploaded files via
    // /api/files/* and Onshape thumbnails via /api/onshape/thumbnail, which
    // redirects into /api/files/*. No remote patterns are needed.
    remotePatterns: [],
  },
};

export default nextConfig;
