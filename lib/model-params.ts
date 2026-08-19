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

/** Appended to models only when METIS_ENABLE_UNCENSORED is on. */
export const UNCENSORED_PARAMETER: ModelParameter = {
  id: "uncensored",
  displayName: "Uncensored",
  values: [
    { value: "false" },
    { value: "true", displayName: "Uncensored" },
  ],
};
