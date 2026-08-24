import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");

test("setup API and wizard exist for first-run onboarding", () => {
  const api = readFileSync(path.join(root, "app/api/setup/route.ts"), "utf8");
  const wizard = readFileSync(path.join(root, "components/setup-wizard.tsx"), "utf8");
  const helper = readFileSync(path.join(root, "lib/setup.ts"), "utf8");
  assert.match(api, /action === "bootstrap"/);
  assert.match(api, /markSetupComplete/);
  assert.match(wizard, /Set up this instance/);
  assert.match(wizard, /embedded/);
  assert.match(helper, /setup_complete/);
  assert.match(helper, /markSetupIncomplete/);
  assert.match(api, /markSetupIncomplete/);
});
