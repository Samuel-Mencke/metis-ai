import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRepositoryIndex, findSymbol, searchRepository } from "../lib/repo-index.mjs";

test("repository index persists symbols and supports targeted search", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metis-repo-index-"));
  await writeFile(path.join(root, "sample.ts"), "export function importantTask() { return 1; }\nimport x from './other';\n");
  await writeFile(path.join(root, "other.ts"), "export const helper = true;\n");
  const first = await buildRepositoryIndex(root);
  assert.equal(first.files.length, 2);
  const search = await searchRepository(root, "importantTask", { limit: 5 });
  assert.equal(search.results[0]?.path, "sample.ts");
  const symbol = await findSymbol(root, "helper");
  assert.equal(symbol.results[0]?.path, "other.ts");
  const cache = await readFile(path.join(root, "data", "repo-index.json"), "utf8");
  assert.match(cache, /importantTask/);
});
