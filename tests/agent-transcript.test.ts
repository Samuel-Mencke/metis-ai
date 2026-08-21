import assert from "node:assert/strict";
import test from "node:test";
import {
  looksLikeTranscriptDump,
  parseAgentTranscript,
  stripTranscriptDump,
  transcriptFromToolPart,
} from "../lib/agent-transcript";

const sample = {
  status: "success",
  value: {
    conversationSteps: [
      { thinkingMessage: { text: "Reading worker.ts" } },
      { assistantMessage: { text: "I'll start with the queue parser." } },
      {
        toolCall: {
          toolCallId: "call-1",
          readToolCall: {
            args: { path: "/home/samuel/metis-ai/worker.ts" },
            result: { success: { content: "export const concurrency = 8;\n".repeat(200) } },
          },
        },
      },
      { assistantMessage: { text: "Default concurrency is now unlimited." } },
    ],
  },
};

test("parseAgentTranscript keeps chat text and unwraps Cursor tool calls", () => {
  const transcript = parseAgentTranscript(sample);
  assert.equal(transcript.messages.length, 2);
  assert.equal(transcript.messages[0]?.text, "I'll start with the queue parser.");
  assert.equal(transcript.messages[1]?.text, "Default concurrency is now unlimited.");
  assert.equal(transcript.thinking, "Reading worker.ts");
  assert.equal(transcript.tools.length, 1);
  assert.equal(transcript.tools[0]?.name, "read");
  assert.equal(transcript.tools[0]?.kind, "read");
  assert.equal(transcript.tools[0]?.path, "/home/samuel/metis-ai/worker.ts");
  assert.equal(transcript.parts.map((part) => part.type).join(","), "thinking,message,tool,message");
  assert.equal(transcript.tools[0]?.result, undefined);
});

test("looksLikeTranscriptDump detects labeled conversation dumps", () => {
  const dump = [
    "thinkingMessage: Beginning implementation",
    "assistantMessage: I'll implement unlimited concurrency",
    "readToolCall: /home/samuel/metis-ai/worker.ts",
    "import { spawn } from \"node:child_process\";",
  ].join("\n");
  assert.equal(looksLikeTranscriptDump(dump), true);
  assert.equal(looksLikeTranscriptDump(JSON.stringify(sample)), true);
  assert.equal(looksLikeTranscriptDump("Default concurrency is now unlimited."), false);
  assert.equal(stripTranscriptDump(`Done.\n\n${dump}`), "Done.");
  assert.equal(stripTranscriptDump(dump), "");
  const indented = [
    "status: success",
    "value:",
    "  conversationSteps:",
    "    0:",
    "      thinkingMessage:",
    "        text: Reading worker.ts",
    "      readToolCall:",
    "        path: /home/samuel/metis-ai/worker.ts",
  ].join("\n");
  assert.equal(looksLikeTranscriptDump(indented), true);
  assert.equal(looksLikeTranscriptDump(JSON.stringify(JSON.stringify(sample))), true);
});

test("parseAgentTranscript unwraps getMcpToolsToolCall names", () => {
  const transcript = parseAgentTranscript({
    status: "success",
    value: {
      conversationSteps: [
        { assistantMessage: { text: "Checking MCP tools." } },
        {
          toolCall: {
            toolCallId: "call-mcp",
            getMcpToolsToolCall: { args: { server: "gateway", toolName: "read_file" } },
          },
        },
      ],
    },
  });
  assert.equal(transcript.messages[0]?.text, "Checking MCP tools.");
  assert.equal(transcript.tools[0]?.name, "getMcpTools");
  assert.equal(transcript.tools[0]?.kind, "mcp");
});

test("transcriptFromToolPart prefers parsed result over a raw dump fallback", () => {
  const transcript = transcriptFromToolPart({
    result: JSON.stringify(sample),
    subagent: { thinking: "stale", messages: [{ role: "assistant", text: JSON.stringify(sample) }] },
  });
  assert.equal(transcript.messages.some((message) => message.text.includes("unlimited")), true);
  assert.equal(transcript.messages.some((message) => looksLikeTranscriptDump(message.text)), false);
});
