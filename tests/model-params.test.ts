import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultParamsForModel,
  modelParametersForModel,
  providerNativeParams,
  sanitizeModelParams,
  stripRemovedModelParams,
} from "../lib/model-params";

test("models above 272K expose a 272K limit and their full maximum", () => {
  const model = {
    id: "gpt-5.6-luna",
    contextWindow: 1_000_000,
    parameters: [],
  };
  const context = modelParametersForModel(model).find((parameter) => parameter.id === "context");
  assert.deepEqual(context?.values, [
    { value: "272k", displayName: "272K" },
    { value: "max", displayName: "1M" },
  ]);
  assert.equal(defaultParamsForModel(model).find((param) => param.id === "context")?.value, "max");
});

test("models at or below 272K expose only their real maximum", () => {
  const context = modelParametersForModel({
    id: "grok-3-mini",
    contextWindow: 131_072,
    parameters: [],
  }).find((parameter) => parameter.id === "context");
  assert.deepEqual(context?.values, [{ value: "max", displayName: "131K" }]);
});

test("context parameter is ordered at the top above thinking effort", () => {
  const parameters = modelParametersForModel({
    id: "gpt-5.6-luna",
    contextWindow: 1_000_000,
    parameters: [
      {
        id: "fast",
        values: [{ value: "false" }, { value: "true" }],
      },
      {
        id: "reasoning",
        displayName: "Effort",
        values: [{ value: "low" }, { value: "high" }],
      },
    ],
  });
  assert.equal(parameters[0]?.id, "context");
  assert.equal(parameters[1]?.id, "effort");
  assert.equal(parameters.some((p) => p.id === "uncensored"), false);
});

test("stored uncensored selections are stripped", () => {
  assert.deepEqual(
    stripRemovedModelParams([
      { id: "context", value: "max" },
      { id: "uncensored", value: "true" },
      { id: "effort", value: "high" },
    ]),
    [
      { id: "context", value: "max" },
      { id: "effort", value: "high" },
    ],
  );
});

test("provider reasoning and fast parameters are normalized without inventing values", () => {
  const parameters = modelParametersForModel({
    id: "gpt-5.6-luna",
    parameters: [
      {
        id: "reasoning",
        displayName: "Effort",
        values: [{ value: "low" }, { value: "high" }],
      },
      {
        id: "fast",
        values: [{ value: "false" }, { value: "true" }],
      },
    ],
  });
  assert.equal(parameters.find((parameter) => parameter.id === "effort")?.displayName, "Reasoning");
  assert.deepEqual(parameters.find((parameter) => parameter.id === "fast")?.values, [
    { value: "false" },
    { value: "true" },
  ]);
  assert.equal(parameters.some((parameter) => parameter.id === "uncensored"), false);
});

test("invalid and Metis-only parameters do not reach native providers", () => {
  const model = {
    id: "gpt-5.6",
    parameters: [{ id: "effort", values: [{ value: "low" }, { value: "high" }] }],
  };
  assert.deepEqual(sanitizeModelParams(model, [
    { id: "effort", value: "high" },
    { id: "effort", value: "invalid" },
  ]), [
    { id: "effort", value: "high" },
  ]);
  assert.deepEqual(providerNativeParams(model, [
    { id: "effort", value: "high" },
    { id: "context", value: "max" },
    { id: "unknown", value: "value" },
  ]), [{ id: "effort", value: "high" }]);
});


test("concrete variants are the only source for explicit context values", () => {
 const context = modelParametersForModel({
 contextWindow: 1_000_000,
 parameters: [{ id: "context", values: [{ value: "unlimited" }, { value: "invalid" }] }],
 variants: [[{ id: "context", value: "272k" }]],
 }).find((parameter) => parameter.id === "context");
 assert.deepEqual(context?.values, [
 { value: "272k" },
 { value: "max", displayName: "1M" },
 ]);
 assert.deepEqual(sanitizeModelParams({ parameters: [{ id: "effort", values: [{ value: "low" }] }] }, [
 { id: "effort", value: "low" },
 { id: "effort", value: "invalid" },
 null as never,
 ]), [{ id: "effort", value: "low" }]);
});

test("cursor models keep variant context options without a catalog window", () => {
 const context = modelParametersForModel({
 id: "grok-4.6",
 parameters: [{ id: "context", values: [{ value: "272k" }, { value: "1m" }, { value: "max" }] }],
 variants: [[{ id: "context", value: "272k" }], [{ id: "context", value: "1m" }]],
 }).find((parameter) => parameter.id === "context");
 assert.ok(context);
 assert.ok(context?.values.some((value) => value.value === "272k"));
 assert.ok(context?.values.some((value) => value.value === "1m" || value.value === "max"));
});

test("cursor grok models get a context row even without catalog window or variants", () => {
  const context = modelParametersForModel({ id: "grok-4.6", displayName: "Grok 4.6" }).find((parameter) => parameter.id === "context");
  assert.ok(context);
  assert.ok(context?.values.some((value) => value.value === "272k" || value.value === "max"));
});

