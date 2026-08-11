import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  client: "@hey-api/client-fetch",
  input: "https://cad.onshape.com/api/openapi",
  output: {
    path: "app/lib/onshapeApi/generated",
    format: "prettier",
  },
  plugins: [
    "@hey-api/typescript",
    "@hey-api/sdk",
    {
      name: "@tanstack/react-query",
    },
  ],
});
