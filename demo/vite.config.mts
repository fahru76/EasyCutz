import { copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/postcss";
import { defineConfig, type Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const shim = (name: string) => resolve(here, "src/shims", name);

/** data.ts imports "./stripe": the demo has no payments, so swap in a stub. */
function stubStripe(): Plugin {
  const real = resolve(repo, "src/lib/server/stripe.ts");
  return {
    name: "easycutz-demo-stub-stripe",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !/stripe/.test(source)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved?.id === real ? shim("stripe.ts") : null;
    },
  };
}

/** GitHub Pages serves 404.html for unknown paths: make it the app so deep links work. */
function spaFallback(): Plugin {
  return {
    name: "easycutz-demo-spa-404",
    apply: "build",
    closeBundle() {
      const out = resolve(here, "../dist-demo");
      copyFileSync(resolve(out, "index.html"), resolve(out, "404.html"));
    },
  };
}

export default defineConfig({
  root: here,
  base: process.env.DEMO_BASE ?? "/",
  plugins: [stubStripe(), spaFallback()],
  resolve: {
    alias: [
      { find: /^@\/lib\/supabase\/(browser|admin|server)$/, replacement: resolve(here, "src/fake/supabase.ts") },
      { find: /^server-only$/, replacement: shim("empty.ts") },
      { find: /^next\/navigation$/, replacement: shim("next-navigation.ts") },
      { find: /^next\/link$/, replacement: shim("next-link.tsx") },
      { find: /^next\/headers$/, replacement: shim("next-headers.ts") },
      { find: /^next\/server$/, replacement: shim("next-server.ts") },
      { find: /^@\//, replacement: `${resolve(repo, "src")}/` },
    ],
  },
  css: { postcss: { plugins: [tailwind({ base: repo })] } },
  oxc: { jsx: { runtime: "automatic", importSource: "react" } },
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  worker: { format: "es" },
  server: { fs: { allow: [repo] } },
  build: {
    rolldownOptions: {
      onwarn(warning, warn) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return; // "use client" is meaningless in a SPA
        warn(warning);
      },
    },
    outDir: resolve(here, "../dist-demo"), emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 4000 },
});
