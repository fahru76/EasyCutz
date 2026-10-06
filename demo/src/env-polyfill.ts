// App code reads process.env lazily; give it the demo's public origin (incl. the Pages base path).
const base = import.meta.env.BASE_URL.replace(/\/+$/, "");
const g = globalThis as unknown as { process?: { env: Record<string, string | undefined> } };
g.process = {
  env: {
    NODE_ENV: import.meta.env.PROD ? "production" : "development",
    NEXT_PUBLIC_SITE_URL: `${location.origin}${base}`,
  },
};
