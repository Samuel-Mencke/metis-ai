import type {
  ModelInfo,
  ModelParamSelection,
  ModelParameter,
} from "@/components/settings-panel";

function paramSelection(
  model: ModelInfo,
  params: ModelParamSelection[],
  id: string,
): { param: ModelParameter; value: string } | null {
  const param = model.parameters?.find((p) => p.id === id);
  if (!param) return null;
  const value =
    params.find((p) => p.id === id)?.value ??
    model.defaultParams?.find((p) => p.id === id)?.value ??
    "";
  if (!value) return null;
  return { param, value };
}

function displayLabel(param: ModelParameter, value: string): string {
  const match = param.values.find((v) => v.value === value);
  return (match?.displayName || value).replace(/\u200b/g, "").trim();
}

/**
 * Secondary attrs after the model name:
 * `<context> <effort|reasoning> <Fast if on>`
 */
export function modelAttrSummary(
  model: ModelInfo,
  params: ModelParamSelection[],
): string {
  const parts: string[] = [];

  const context = paramSelection(model, params, "context");
  if (context) parts.push(displayLabel(context.param, context.value));

  const effort =
    paramSelection(model, params, "effort") ||
    paramSelection(model, params, "reasoning");
  if (
    effort &&
    effort.value !== "false" &&
    effort.value !== "none"
  ) {
    parts.push(displayLabel(effort.param, effort.value));
  }

  const fast = paramSelection(model, params, "fast");
  if (fast?.value === "true") parts.push("Fast");

  const uncensored = paramSelection(model, params, "uncensored");
  if (uncensored?.value === "true") parts.push("Uncensored");

  return parts.join(" ");
}
