#!/usr/bin/env node
/**
 * EZ-010 translation review list.
 *   npm run i18n:review   lists every BM line still marked // TODO(review), with the English text.
 *   npm run i18n:check    same, but exits 1 when any marker is left (CI gate for main).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../src/i18n/dictionaries/", import.meta.url).pathname;
const strict = process.argv.includes("--check");

/** Maps "a.b.c" -> { value, line } by tracking `key: {` nesting. Values are kept as written. */
function index(file) {
  const out = new Map();
  const stack = [];
  const lines = readFileSync(file, "utf8").split("\n");
  let pending = null;
  lines.forEach((text, i) => {
    const open = text.match(/^\s*([A-Za-z_]\w*):\s*\{\s*$/);
    if (open) return void stack.push(open[1]);
    if (/^\s*\}[,;]?\s*(\/\/.*)?$/.test(text) && stack.length) return void stack.pop();
    const kv = text.match(/^\s*([A-Za-z_]\w*):\s*(.*)$/);
    if (kv && !/^\s*(export|import)/.test(text)) {
      pending = { key: [...stack, kv[1]].join("."), start: i, value: kv[2] };
    } else if (pending) {
      pending.value += " " + text.trim();
    }
    if (pending && /[",]\s*(\/\/.*)?$/.test(text)) {
      out.set(pending.key, { value: pending.value, start: pending.start + 1, end: i + 1, marked: /TODO\(review\)/.test(pending.value) });
      pending = null;
    }
  });
  return out;
}

const clean = (v) => v.replace(/\s*\/\/.*$/, "").replace(/,\s*$/, "").trim();
let total = 0;
for (const name of readdirSync(join(root, "ms")).filter((f) => f.endsWith(".ts")).sort()) {
  const ms = index(join(root, "ms", name));
  const en = index(join(root, "en", name));
  const marked = [...ms].filter(([, v]) => v.marked);
  if (!marked.length) continue;
  console.log(`\n${name.replace(".ts", "")} — ${marked.length} to review`);
  for (const [key, v] of marked) {
    total++;
    console.log(`  ${key}  (ms/${name}:${v.start})\n    EN: ${clean(en.get(key)?.value ?? "?")}\n    BM: ${clean(v.value)}`);
  }
}
console.log(`\n${total} BM string(s) waiting for review.`);
if (strict && total > 0) {
  console.error("i18n:check failed: approve the BM wording and remove the TODO(review) markers before merging to main.");
  process.exit(1);
}
