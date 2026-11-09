import { registerHooks } from "node:module";
// Test the real server modules directly; the production Vite plugin still
// rejects this marker in every browser build.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "virtual:hawk-shop/server-only")
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
