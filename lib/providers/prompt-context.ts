import { getChat, getGlobalModelSettings } from "@/lib/db-store";
import { projectContextBlock } from "@/lib/projects";
import {
  globalFactsForScope,
  loadContextScope,
  resolveScopeReferences,
} from "@/lib/context-scope";
import { skillsCatalogPrompt } from "@/lib/skills";
import { METIS_SHARED_AGENT_CONTROL, toolContractPrompt } from "@/lib/agent-control";
import { metisAgentIdentity } from "@/lib/agent-identity";
import { buildAttachmentPrompt } from "@/lib/uploads";
import type { AgentJob } from "@/lib/jobs";

export type ProviderPromptContext = {
  job: AgentJob;
  toolNames?: ReadonlyArray<string>;
  nativeTools?: boolean;
  provider?: string;
};

const EXPLICIT_CONTEXT_CHARS = 80_000;
const PINNED_CONTEXT_CHARS = 32_000;
const CHAT_FACT_CHARS = 16_000;
const GLOBAL_CONTEXT_CHARS = 16_000;

function boundedJoin(blocks: string[], maxChars: number) {
  let used = 0;
  const selected: string[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    const next = trimmed.length > remaining ? `${trimmed.slice(0, Math.max(0, remaining - 32))}\n[context clipped]` : trimmed;
    selected.push(next);
    used += next.length + 2;
  }
  return selected.join("\n\n");
}

function referenceBlock(reference: NonNullable<AgentJob["references"]>[number]) {
  return [
    `- [${reference.kind}] ${reference.label}`,
    reference.detail ? `  Detail: ${reference.detail}` : "",
    reference.path ? `  Path/URL: ${reference.path}` : "",
    reference.content ? `  Context:\n${reference.content}` : "",
  ].filter(Boolean).join("\n");
}

function factBlock(title: string, facts: ReadonlyArray<{ id: string; content: string }>, maxChars: number) {
  if (!facts.length) return "";
  const body = boundedJoin(
    facts.slice(-24).reverse().map((fact) => `- ${fact.id}: ${fact.content}`),
    maxChars,
  );
  return body ? `${title}:\n${body}` : "";
}

/**
 * Provider-neutral scoped instructions/context. This deliberately excludes the
 * persisted conversation transcript. Native runtimes combine it with their own
 * session; the custom harness combines it with Metis-managed messages.
 *
 * Durable context precedence is strict: Explicit > Pinned/chat facts > Project > Global.
 */
export function buildProviderPrompt(input: ProviderPromptContext): string {
  const job = input.job;
  const chat = getChat(job.chatId, job.userId);
  if (!chat) return metisAgentIdentity();
  const ownerId = job.userId ?? chat.ownerId;
  const incognito = Boolean(job.incognito || chat.incognito);

  const rawReferences = (job.references || []).map((reference) => ({
    ...reference,
    source: "explicit" as const,
  }));
  const resolvedReferences = resolveScopeReferences(ownerId, chat.id, rawReferences, incognito);
  const scope = loadContextScope({
    chatId: chat.id,
    ownerId,
    references: resolvedReferences,
    includeGlobal: !incognito,
  });
  const project = !incognito ? scope?.project : undefined;
  const globalFacts = incognito
    ? []
    : globalFactsForScope({
        chatId: chat.id,
        ownerId,
        includeGlobal: project?.memoryMode !== "project_only",
      });

  const explicit = boundedJoin([
    ...resolvedReferences.map(referenceBlock),
    job.referenceText ? `Referenced context:\n${job.referenceText}` : "",
    buildAttachmentPrompt(job.chatId, job.attachments, ownerId),
  ], EXPLICIT_CONTEXT_CHARS);

  const pinned = boundedJoin([
    ...(scope?.pinnedNotes || []).map((note) =>
      `- [note] ${note.title || "Untitled note"}\n  Context:\n${note.content}`,
    ),
    factBlock("Chat-scoped learned facts", scope?.learnedFacts || [], CHAT_FACT_CHARS),
  ], PINNED_CONTEXT_CHARS);

  const projectBlock = project ? projectContextBlock(project, ownerId) : "";
  const globalBlock = factBlock("Global durable memory", globalFacts, GLOBAL_CONTEXT_CHARS);

  return [
    metisAgentIdentity(),
    skillsCatalogPrompt(getGlobalModelSettings(ownerId)),
    "Working style: precise, technically fluent, proactive. Act with tools instead of narrating steps. Reply in the user's language. On clear orders decide and act; ask only when genuinely ambiguous or destructive.",
    "The repository/filesystem is durable external memory. Search/read only relevant files and symbols; do not request or replay an entire repository into context.",
    METIS_SHARED_AGENT_CONTROL,
    toolContractPrompt({
      modeId: job.modeId || chat.sessionState?.modeId || "agent",
      provider: input.provider || "alternative-provider",
      toolNames: input.toolNames,
      nativeTools: Boolean(input.nativeTools),
    }),
    incognito
      ? "Incognito mode: do not use chat/project/global durable memory or personal context. Explicit references supplied in this request remain allowed."
      : "Use personal/context-hub tools only when relevant. Do not dump private context; retrieve the smallest useful slice.",
    explicit ? `Priority 1 — Explicit references:\n${explicit}` : "",
    pinned ? `Priority 2 — Pinned chat context:\n${pinned}` : "",
    projectBlock ? `Priority 3 — Project context:\n${projectBlock}` : "",
    globalBlock ? `Priority 4 — Global durable context:\n${globalBlock}` : "",
  ].filter(Boolean).join("\n\n");
}
