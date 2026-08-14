import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Server,
  StdioServerTransport,
  dispatchGatewayTool,
  tools,
} from "../packages/mcp-gateway/index.mjs";

const context = {
  chatId: process.env.MCP_CHAT_ID || undefined,
  userId: process.env.MCP_USER_ID || undefined,
  jobId: process.env.MCP_JOB_ID || undefined,
  incognito: process.env.MCP_INCOGNITO === "1",
  automation: process.env.MCP_AUTOMATION === "1",
  modeId: process.env.MCP_MODE_ID || undefined,
  modePolicy: process.env.MCP_MODE_POLICY || undefined,
  compressionEnabled: process.env.MCP_COMPRESSION_ENABLED === "1",
  compressionMode: process.env.MCP_COMPRESSION_MODE || "stacked",
  compressionToolResults: process.env.MCP_COMPRESSION_TOOL_RESULTS !== "0",
};

const server = new Server(
  { name: `${process.env.APP_NAME?.trim() || "Metis AI"} internal MCP`, version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions:
      `This is the built-in MCP server for ${process.env.APP_NAME?.trim() || "Metis AI"}. It exposes the configured local gateway tool catalog.`,
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = await dispatchGatewayTool(
    request.params.name,
    request.params.arguments || {},
    { context: { ...context, transport: "internal" } },
  );
  return result;
});

const transport = new StdioServerTransport();
await server.connect(transport);
