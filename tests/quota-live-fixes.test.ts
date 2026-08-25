import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const planUsage = readFileSync(new URL("../lib/plan-usage.ts", import.meta.url), "utf8");
const appShell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");

test("Cursor quota reads a dashboard session, not only the editor state database", () => {
  // crsr_ API keys authenticate api.cursor.com but expose no plan usage, so a
  // CLI or browser session is the only credential usage-summary accepts.
  assert.match(planUsage, /readCursorSessionTokens/);
  assert.match(planUsage, /\.config\/cursor\/auth\.json/);
  assert.match(planUsage, /cursorAuth\/accessToken/);
});

test("Antigravity quota refreshes its own OAuth token before giving up", () => {
  assert.match(planUsage, /oauth2\.googleapis\.com\/token/);
  assert.match(planUsage, /ANTIGRAVITY_OAUTH_CLIENT_ID/);
  assert.match(planUsage, /antigravityTokenExpired/);
  // Antigravity tokens are not issued to the Gemini CLI OAuth client.
  assert.equal(planUsage.includes("GEMINI_CLI_OAUTH_CLIENT_ID"), false);
});

test("host-level plan credentials stay with the machine owner", () => {
  assert.match(planUsage, /function mayUseHostCredentials/);
  assert.match(planUsage, /isHostAdmin\(ownerId\)/);
  assert.match(planUsage, /mayUseHostCredentials\(ownerId\) \? readCursorSessionTokens\(\) : \[\]/);
});

test("context reading survives a provider switch and plan usage refreshes with it", () => {
  // Stored runs carry no connection id, so demanding one hid the measurement
  // as soon as the picker re-added the connection segment to the model key.
  assert.match(appShell, /run\.connectionId && selection\.connectionId && run\.connectionId !== selection\.connectionId/);
  assert.match(appShell, /const latestUsage = selectedRunUsage \|\| measuredRuns\[0\]/);
  assert.match(appShell, /usageSelectionKey/);
  assert.match(appShell, /void refreshPlanUsage\(true\)/);
});

test("quota warnings fire from official remaining-percent thresholds", () => {
  const gauges = readFileSync(new URL("../components/quota-gauges.tsx", import.meta.url), "utf8");
  assert.match(gauges, /lowQuotaAlerts/);
  assert.match(gauges, /toast\.warning/);
  assert.match(gauges, /metis-quota-alert/);
});
