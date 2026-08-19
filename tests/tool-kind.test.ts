import assert from "node:assert/strict";
import test from "node:test";
import { classifyTool, toolDetailFromArgs } from "../lib/tool-kind";

test("web research tools are classified as browser instead of generic read", () => {
  assert.equal(classifyTool("web_search"), "browser");
  assert.equal(classifyTool("WebSearch"), "browser");
  assert.equal(classifyTool("web_reader"), "browser");
  assert.equal(classifyTool("WebFetch"), "browser");
  assert.equal(classifyTool("x_search"), "browser");
  assert.equal(classifyTool("grep"), "read");
  assert.equal(classifyTool("semSearch"), "read");
  assert.equal(classifyTool("mcp"), "mcp");
});

test("tool details prefer the query or URL the user should see", () => {
  assert.equal(
    toolDetailFromArgs({ query: "how to create a github organization" }),
    "how to create a github organization",
  );
  assert.equal(toolDetailFromArgs({ url: "https://docs.github.com" }), "https://docs.github.com");
  assert.equal(toolDetailFromArgs({ command: "ls" }), "ls");
});
