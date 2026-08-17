/**
 * Shared model-parameter definitions. Kept out of route files so the values
 * can be imported by both the models API route and the UI without tripping
 * Next's route-module type checks (which forbid non-route exports).
 */

export type ModelParamValue = {
  value: string;
  displayName?: string;
};

export type ModelParameter = {
  id: string;
  displayName?: string;
  values: ModelParamValue[];
};

/** Boolean toggle appended to every model so uncensored mode can be flipped
 *  per-chat like `effort` / `fast` / `context`. */
export const UNCENSORED_PARAMETER: ModelParameter = {
  id: "uncensored",
  displayName: "Uncensored",
  values: [
    { value: "false" },
    { value: "true", displayName: "Uncensored" },
  ],
};

/** Context-tier selection for models that ship multiple context windows
 *  (e.g. GLM 5.x 200K vs 1M). Selecting a tier rewrites the model id suffix
 *  ("-200k"/"-1m") before the request is sent, so the parameter is display
 *  and persistence sugar on top of the model id itself. */
export const CONTEXT_TIER_PARAMETER: ModelParameter = {
  id: "context",
  displayName: "Context",
  values: [
    { value: "200k", displayName: "200K" },
    { value: "1m", displayName: "1M" },
  ],
};
