/**
 * Shared model-parameter definitions. Kept out of route files so the values
 * can be imported by both the models API route and the UI without tripping
 * Next's route-module type checks (which forbid non-route exports).
 */

import { contextWindowForModel } from "./context-window";

export type ModelParamValue = {
  value: string;
  displayName?: string;
};

export type ModelParameter = {
  id: string;
  displayName?: string;
  values: ModelParamValue[];
};

export type ModelParamSelection = {
  id: string;
  value: string;
};

export type ModelParameterModel = {
  id?: string;
  displayName?: string;
  contextWindow?: number;
  capabilities?: Record<string, boolean>;
  parameters?: ModelParameter[];
  defaultParams?: ModelParamSelection[];
  variants?: ReadonlyArray<ReadonlyArray<ModelParamSelection>>;
};

export const FAST_PARAMETER: ModelParameter = {
  id: "fast",
  displayName: "Fast",
  values: [
    { value: "false" },
    { value: "true", displayName: "Fast" },
  ],
};

const REASONING_IDS = new Set(["effort", "reasoning"]);
const REMOVED_PARAM_IDS = new Set(["uncensored"]);

function parameterRank(id: string): number {
  if (id === "context") return 0;
  if (REASONING_IDS.has(id)) return 1;
  if (id === "fast") return 3;
  return 2;
}

function orderModelParams<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => parameterRank(a.id) - parameterRank(b.id));
}

/** Drops retired params (e.g. leftover `uncensored` in stored chat/settings). */
export function stripRemovedModelParams<T extends { id: string }>(
  params?: T[] | null,
): T[] | undefined {
  if (!Array.isArray(params)) return undefined;
  return params.filter((param) => !REMOVED_PARAM_IDS.has(param.id));
}

function finiteContextWindow(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

function contextValueTokens(value: string): number | undefined {
  const normalized = value.trim().toLowerCase().replace(/,/g, "");
  if (normalized === "max" || normalized === "unlimited") return undefined;
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([km])?$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  const tokens = Math.round(amount * multiplier);
  return Number.isFinite(tokens) && tokens > 0 ? tokens : undefined;
}

function contextLabel(value: number) {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000 * 100) / 100}M`;
  return `${Math.round(value / 1_000)}K`;
}

export function contextParameterForModel(
  contextWindow?: number,
  concreteValues?: ReadonlyArray<ModelParamValue>,
): ModelParameter | null {
  const max = finiteContextWindow(contextWindow);
  const maxValue: ModelParamValue | null = max
    ? { value: "max", displayName: contextLabel(max) }
    : null;
  const normalizedConcrete = (concreteValues || [])
    .map((entry) => {
      const value = typeof entry?.value === "string" ? entry.value.trim() : "";
      if (!value) return null;
      if (value.toLowerCase() === "max" || value.toLowerCase() === "unlimited") {
        return maxValue || {
          value: value.toLowerCase() === "unlimited" ? "unlimited" : "max",
          ...(entry.displayName ? { displayName: entry.displayName } : {}),
        };
      }
      const tokens = contextValueTokens(value);
      return tokens ? { value, ...(entry.displayName ? { displayName: entry.displayName } : {}) } : null;
    })
    .filter((entry): entry is ModelParamValue => Boolean(entry))
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.value === entry.value) === index);
  if (normalizedConcrete.length) {
    const values = normalizedConcrete.filter((entry) => entry.value !== "max" && entry.value !== "unlimited");
    if (max && max > 272_000 && !values.some((entry) => entry.value === "272k")) {
      values.push({ value: "272k", displayName: "272K" });
    }
    if (maxValue) values.push(maxValue);
    else {
      values.push(...normalizedConcrete.filter((entry) => entry.value === "max" || entry.value === "unlimited"));
    }
    if (!values.length) return null;
    return { id: "context", displayName: "Context", values };
  }
  if (!maxValue || !max) return null;
  if (max <= 272_000) {
    return { id: "context", displayName: "Context", values: [maxValue] };
  }
  return {
    id: "context",
    displayName: "Context",
    values: [
      { value: "272k", displayName: "272K" },
      maxValue,
    ],
  };
}

function cloneParameter(parameter: ModelParameter): ModelParameter {
  return {
    id: parameter.id === "reasoning" ? "effort" : parameter.id,
    displayName: REASONING_IDS.has(parameter.id) ? "Reasoning" : parameter.displayName,
    values: parameter.values.map((value) => ({ ...value })),
  };
}

export function modelParametersForModel(model: ModelParameterModel): ModelParameter[] {
  const parameters: ModelParameter[] = [];
  const seen = new Set<string>();

  // Context is ordered at the very top, before thinking effort and other parameters.
  const contextDefinition = model.parameters?.find((parameter) => parameter.id === "context");
  const variantContextValues = (model.variants || [])
    .flatMap((variant) => variant)
    .filter((parameter) => parameter.id === "context")
    .map((parameter) => ({ value: parameter.value }));
  const inferredWindow = finiteContextWindow(model.contextWindow) ?? contextWindowForModel({
    id: model.id,
    displayName: model.displayName,
    contextWindow: model.contextWindow,
  });
  const context = contextParameterForModel(inferredWindow, [
    ...(contextDefinition?.values || []),
    ...variantContextValues,
  ]);
  if (context && !seen.has("context")) {
    parameters.push(context);
    seen.add("context");
  }

  for (const raw of model.parameters || []) {
    if (raw.id === "context" || REMOVED_PARAM_IDS.has(raw.id)) continue;
    const parameter = cloneParameter(raw);
    if (seen.has(parameter.id) || REMOVED_PARAM_IDS.has(parameter.id)) continue;
    seen.add(parameter.id);
    parameters.push(parameter);
  }

  // Fast is only offered when the provider/model explicitly exposes it.
  if (
    !seen.has("fast") &&
    Boolean(model.capabilities?.fast)
  ) {
    parameters.push(FAST_PARAMETER);
    seen.add("fast");
  }

  return orderModelParams(parameters);
}

export function defaultParamsForModel(model: ModelParameterModel): ModelParamSelection[] {
  const parameters = modelParametersForModel(model);
  const allowed = new Map(parameters.map((parameter) => [parameter.id, parameter]));
  const result: ModelParamSelection[] = [];
  const context = parameters.find((parameter) => parameter.id === "context");
  if (context) {
    result.push({ id: "context", value: "max" });
  }
  for (const param of model.defaultParams || []) {
    const id = param.id === "reasoning" ? "effort" : param.id;
    if (id === "context" || REMOVED_PARAM_IDS.has(id)) continue;
    const definition = allowed.get(id);
    if (!definition || !definition.values.some((value) => value.value === param.value)) continue;
    result.push({ id, value: param.value });
  }
  if (parameters.some((parameter) => parameter.id === "fast") && !result.some((param) => param.id === "fast")) {
    result.push({ id: "fast", value: "false" });
  }
  return orderModelParams(result);
}

export function sanitizeModelParams(
  model: ModelParameterModel,
  params?: ReadonlyArray<ModelParamSelection> | null,
): ModelParamSelection[] {
  const allowed = new Map(modelParametersForModel(model).map((parameter) => [parameter.id, parameter]));
  const result: ModelParamSelection[] = [];
  for (const raw of params || []) {
    if (!raw || typeof raw.id !== "string" || typeof raw.value !== "string") continue;
    const id = raw.id === "reasoning" ? "effort" : raw.id;
    if (REMOVED_PARAM_IDS.has(id)) continue;
    const definition = allowed.get(id);
    if (!definition || !definition.values.some((value) => value.value === raw.value)) continue;
    result.push({ id, value: raw.value });
  }
  return orderModelParams(result);
}

export function providerNativeParams(
  params?: ReadonlyArray<ModelParamSelection> | null,
): ModelParamSelection[];
export function providerNativeParams(
  model: ModelParameterModel,
  params?: ReadonlyArray<ModelParamSelection> | null,
): ModelParamSelection[];
export function providerNativeParams(
  modelOrParams?: ModelParameterModel | ReadonlyArray<ModelParamSelection> | null,
  params?: ReadonlyArray<ModelParamSelection> | null,
): ModelParamSelection[] {
  const isSelectionArray = (value: unknown): value is ReadonlyArray<ModelParamSelection> =>
    Array.isArray(value);
  const selections = isSelectionArray(modelOrParams)
    ? modelOrParams
    : modelOrParams
    ? sanitizeModelParams(modelOrParams, params)
    : [];
  return selections.filter((param) => param.id !== "context" && !REMOVED_PARAM_IDS.has(param.id));
}
