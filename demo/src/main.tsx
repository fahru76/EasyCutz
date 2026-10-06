import "./env-polyfill";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/jetbrains-mono";
import "./demo.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installApi } from "./api";
import { App } from "./App";
import { startDatabase } from "./db/client";
import { addSampleActivity } from "./sample-activity";

const root = createRoot(document.getElementById("root")!);

async function boot() {
  installApi();
  await startDatabase();
  try {
    await addSampleActivity();
  } catch (err) {
    console.warn("[demo] sample activity skipped", err);
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById("boot");
  if (el) el.textContent = `The demo couldn't start in this browser: ${err instanceof Error ? err.message : String(err)}`;
});
