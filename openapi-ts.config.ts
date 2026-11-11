import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "https://cad.onshape.com/api/openapi",
  output: {
    path: "src/lib/onshapeApi/generated",
    format: "prettier",
  },
  plugins: [
    "@hey-api/client-fetch",
    "@hey-api/typescript",
    "@hey-api/sdk",
    {
      name: "@tanstack/react-query",
    },
  ],
});
