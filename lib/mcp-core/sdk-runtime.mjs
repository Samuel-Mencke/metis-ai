import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function resolveSdkRoot() {
  const candidates = [
    process.env.MCP_SDK_ROOT?.trim(),
    path.join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk"),
    path.join(
      process.cwd(),
      "node_modules",
      ".pnpm",
      "node_modules",
      "@modelcontextprotocol",
      "sdk",
    ),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, "dist", "esm", "client", "index.js"));
      return candidate;
    } catch {
      // Try the next package-manager layout.
    }
  }

  throw new Error(
    "Could not locate @modelcontextprotocol/sdk. Set MCP_SDK_ROOT to its package directory.",
  );
}

export async function loadMcpSdk() {
  const root = await resolveSdkRoot();
  const load = (relativePath) =>
    import(/* webpackIgnore: true */ pathToFileURL(path.join(root, "dist", "esm", relativePath)).href);

  const [client, clientStdio, clientHttp, server, serverStdio, serverHttp, types] =
    await Promise.all([
      load("client/index.js"),
      load("client/stdio.js"),
      load("client/streamableHttp.js"),
      load("server/index.js"),
      load("server/stdio.js"),
      load("server/streamableHttp.js"),
      load("types.js"),
    ]);

  return {
    Client: client.Client,
    StdioClientTransport: clientStdio.StdioClientTransport,
    StreamableHTTPClientTransport: clientHttp.StreamableHTTPClientTransport,
    Server: server.Server,
    StdioServerTransport: serverStdio.StdioServerTransport,
    StreamableHTTPServerTransport: serverHttp.StreamableHTTPServerTransport,
    CallToolRequestSchema: types.CallToolRequestSchema,
    ListToolsRequestSchema: types.ListToolsRequestSchema,
    isInitializeRequest: types.isInitializeRequest,
  };
}
