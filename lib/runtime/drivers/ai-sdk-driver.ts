import crypto from "node:crypto";
import { streamText, tool, jsonSchema } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { BaseDriver, type DriverExecutionContext, type DriverExecutionResult } from "./base-driver";
import { getMetisSystemPrompt } from "@/lib/agent-branding";
import { METIS_MCP_TOOLS, handleMcpToolCall } from "../mcp-gateway";

export class AiSdkDriver extends BaseDriver {
  key = "ai-sdk";
  displayName = "Unified AI SDK Provider";

  private getModel(context: DriverExecutionContext, providerKey: string) {
    switch (providerKey) {
      case "openai": {
        const openai = createOpenAI({
          apiKey: context.secret,
          baseURL: context.baseUrl || "https://api.openai.com/v1",
        });
        return openai(context.modelId || "gpt-5");
      }
      case "anthropic": {
        const anthropic = createAnthropic({
          apiKey: context.secret,
          baseURL: context.baseUrl || "https://api.anthropic.com/v1",
        });
        return anthropic(context.modelId || "claude-sonnet-4-6");
      }
      case "google": {
        const google = createGoogle({
          apiKey: context.secret,
          baseURL: context.baseUrl || "https://generativelanguage.googleapis.com/v1beta",
        });
        return google(context.modelId || "gemini-2.5-flash");
      }
      case "xai": {
        const xai = createXai({
          apiKey: context.secret,
          baseURL: context.baseUrl || "https://api.x.ai/v1",
        });
        return xai(context.modelId || "grok-4");
      }
      case "openrouter": {
        const openrouter = createOpenRouter({
          apiKey: context.secret,
          baseURL: context.baseUrl || "https://openrouter.ai/api/v1",
        });
        return openrouter(context.modelId || "openai/gpt-5");
      }
      case "ollama":
      case "compatible":
      default: {
        const compatible = createOpenAICompatible({
          name: "compatible",
          apiKey: context.secret || "dummy",
          baseURL: context.baseUrl || "http://127.0.0.1:11434/v1",
        });
        return compatible(context.modelId || "llama3.2");
      }
    }
  }

  async execute(context: DriverExecutionContext): Promise<DriverExecutionResult> {
    const providerKey = context.modelId.includes("/")
      ? "openrouter"
      : context.modelId.startsWith("gpt")
        ? "openai"
        : context.modelId.startsWith("claude")
          ? "anthropic"
          : context.modelId.startsWith("gemini")
            ? "google"
            : context.modelId.startsWith("grok")
              ? "xai"
              : "compatible";

    const model = this.getModel(context, providerKey);
    const systemPrompt = context.systemPrompt || getMetisSystemPrompt({ cwd: context.cwd });

    this.emit(context.sessionId, {
      type: "turn.started",
      turnId: context.turnId,
      timestamp: Date.now(),
    });

    const aiTools: Record<string, any> = {};
    for (const mcpTool of METIS_MCP_TOOLS) {
      aiTools[mcpTool.name] = tool({
        description: mcpTool.description,
        parameters: jsonSchema(mcpTool.inputSchema as any),
        execute: async (args: any) => {
          const res = await handleMcpToolCall({
            sessionId: context.sessionId,
            name: mcpTool.name,
            args,
          });
          return res.content.map((c) => c.text).join("\n");
        },
      } as never);
    }

    const itemId = crypto.randomUUID();
    let fullText = "";
    let usage: DriverExecutionResult["usage"];

    const result = streamText({
      model,
      system: systemPrompt,
      prompt: context.prompt,
      tools: aiTools,
      abortSignal: context.signal,
    } as any);

    for await (const chunk of result.textStream) {
      fullText += chunk;
      this.emit(context.sessionId, {
        type: "content.delta",
        turnId: context.turnId,
        itemId,
        kind: "assistant_text",
        text: chunk,
        timestamp: Date.now(),
      });
    }

    const finalUsage = await result.usage;
    if (finalUsage) {
      const u = finalUsage as any;
      usage = {
        inputTokens: u.inputTokens ?? u.promptTokens,
        outputTokens: u.outputTokens ?? u.completionTokens,
        totalTokens: u.totalTokens,
      };
    }

    this.emit(context.sessionId, {
      type: "turn.completed",
      turnId: context.turnId,
      usage,
      timestamp: Date.now(),
    });

    return {
      text: fullText,
      usage,
    };
  }
}
