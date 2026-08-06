export async function callRemoteGatewayTool(
  name: string,
  args: Record<string, unknown>,
) {
  // The shared gateway core is intentionally kept as an ESM runtime module.
  // @ts-expect-error The runtime module has no generated TypeScript declarations.
  const { dispatchGatewayTool } = await import("../packages/mcp-gateway/index.mjs");
  const result = (await dispatchGatewayTool(name, args)) as {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  if (result.isError) {
    throw new Error(
      result.content?.map((item) => item.text).filter(Boolean).join("\n") ||
        "Interne MCP-Aktion fehlgeschlagen",
    );
  }
  const text = result.content?.map((item) => item.text || "").join("\n") || "";
  try {
    const structured = JSON.parse(text) as { stdout?: string; stderr?: string; exit_code?: number };
    if (typeof structured.stdout === "string") {
      return [
        structured.stdout,
        structured.stderr ? `\n${structured.stderr}` : "",
        typeof structured.exit_code === "number" && structured.exit_code !== 0
          ? `\n[exit code: ${structured.exit_code}]`
          : "",
      ].join("");
    }
  } catch {
    // Some child tools return plain text instead of the gateway's structured result.
  }
  return text;
}
