import assert from "node:assert/strict";
import test from "node:test";
import { isMermaidSource, wrapBareMermaid } from "../lib/mermaid";

test("mermaid fences and flowchart sources are detected", () => {
  assert.equal(isMermaidSource("mermaid", "flowchart TD\n  a-->b"), true);
  assert.equal(isMermaidSource("flowchart", "flowchart TD\n  a-->b"), true);
  assert.equal(isMermaidSource(undefined, "flowchart TD\n  a-->b"), true);
  assert.equal(isMermaidSource("js", "const x = 1"), false);
});

test("bare flowchart blocks are wrapped as mermaid fences", () => {
  const wrapped = wrapBareMermaid("Intro\n\nflowchart TD\n  installer[Installer] --> app[App]\n\nDone");
  assert.match(wrapped, /```mermaid\nflowchart TD\n  installer\[Installer\] --> app\[App\]\n```/);
});
