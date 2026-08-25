// Type declarations for tests importing gateway-core.mjs.
// Only the surface used by tests is declared.
export type GatewayTool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    required?: string[];
    [key: string]: unknown;
  };
  annotations?: Record<string, unknown>;
};

export type GatewayToolResult = {
  content: Array<{ type: string; text: string }>;
};

export declare const tools: GatewayTool[];

export declare function visibleToolsForContext(...args: unknown[]): unknown;

export declare function dispatchGatewayTool(
  name: string,
  args: Record<string, unknown>,
  options?: { context?: Record<string, unknown>; auditCall?: boolean },
): Promise<GatewayToolResult>;
