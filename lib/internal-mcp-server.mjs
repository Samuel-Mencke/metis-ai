import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Server,
  StdioServerTransport,
  dispatchGatewayTool,
  tools,
} from "./mcp-core/gateway-core.mjs";

const context = {
  chatId: process.env.MCP_CHAT_ID || undefined,
  userId: process.env.MCP_USER_ID || undefined,
  jobId: process.env.MCP_JOB_ID || undefined,
};

const server = new Server(
  { name: "ai-chat-internal-mcp", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "This is the built-in MCP server for ai-chat. It exposes the complete local gateway tool catalog, including filesystem, shell, web, registry, workflow, Docker, systemd, and optional remote-device tools.",
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = await dispatchGatewayTool(
    request.params.name,
    request.params.arguments || {},
    { context },
  );
  return result;
});

const transport = new StdioServerTransport();
await server.connect(transport);
