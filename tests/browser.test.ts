import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("browser metadata does not wait the default Playwright locator timeout for favicons", () => {
  const source = readFileSync(path.join(root, "lib", "server-browser.ts"), "utf8");
  assert.match(source, /document\.querySelector\('link\[rel~="icon"\]/);
  assert.doesNotMatch(source, /locator\('link\[rel~="icon"\]/);
  assert.match(source, /timeout: 15_000/);
});

test("browser engine fetch aborts instead of waiting forever", () => {
  const source = readFileSync(path.join(root, "lib", "shared-browser-client.ts"), "utf8");
  assert.match(source, /AbortSignal\.timeout\(90_000\)/);
});
