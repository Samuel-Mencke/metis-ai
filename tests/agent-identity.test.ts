import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { metisAgentIdentity } from "../lib/agent-identity";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("identity prompt names Metis AI and the harness", () => {
  const identity = metisAgentIdentity();
  assert.match(identity, /^You are Metis AI\./);
  assert.match(identity, /application harness/);
  assert.match(identity, /not a generic Cursor assistant/);
  assert.match(identity, /remote-client connection are your own runtime/);
  assert.match(identity, /metis-ai-e2e/);
});

test("cursor and provider runners inject the shared identity prompt first", () => {
  const worker = readFileSync(path.join(root, "lib", "worker-runner.ts"), "utf8");
  const provider = readFileSync(path.join(root, "lib", "providers", "runner.ts"), "utf8");
  const modes = readFileSync(path.join(root, "lib", "modes.ts"), "utf8");
  assert.match(worker, /import \{ metisAgentIdentity \} from "@\/lib\/agent-identity"/);
  assert.match(worker, /const prompt = \[\s*metisAgentIdentity\(\),/);
  assert.match(provider, /import \{ metisAgentIdentity \} from "@\/lib\/agent-identity"/);
  assert.match(provider, /return \[\s*metisAgentIdentity\(\),/);
  assert.match(modes, /You are Metis AI, running in the Metis AI harness/);
  assert.doesNotMatch(provider, /You are a provider inside a private AI chat application/);
});
