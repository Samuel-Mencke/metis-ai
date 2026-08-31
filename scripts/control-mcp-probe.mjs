#!/usr/bin/env node
const url = process.env.CONTROL_MCP_URL;
const token = process.env.CONTROL_MCP_BEARER_TOKEN;
if (!url || !token) {
  console.error("Set CONTROL_MCP_URL and CONTROL_MCP_BEARER_TOKEN");
  process.exit(2);
}

let id = 0;
async function rpc(method, params = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  const payload = JSON.parse(text);
  if (payload.error) throw new Error(JSON.stringify(payload.error));
  return payload.result;
}

const initialized = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "metis-control-probe", version: "1.0.0" },
});
const listed = await rpc("tools/list");
const required = ["control_start", "control_status", "control_inbox", "control_read_artifact", "control_remote"];
const names = new Set((listed.tools || []).map((tool) => tool.name));
const missing = required.filter((name) => !names.has(name));
if (missing.length) throw new Error(`Missing tools: ${missing.join(", ")}`);
console.log(JSON.stringify({ ok: true, server: initialized.serverInfo, protocolVersion: initialized.protocolVersion, tools: [...names] }, null, 2));
