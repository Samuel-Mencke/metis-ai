import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultParamsForModel,
  modelParametersForModel,
  providerNativeParams,
  sanitizeModelParams,
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
  assert.ok(parameters.some((parameter) => parameter.id === "uncensored"));
});

test("invalid and Metis-only parameters do not reach native providers", () => {
  const model = {
    id: "gpt-5.6",
    parameters: [{ id: "effort", values: [{ value: "low" }, { value: "high" }] }],
  };
  assert.deepEqual(sanitizeModelParams(model, [
    { id: "effort", value: "high" },
    { id: "effort", value: "invalid" },
    { id: "uncensored", value: "true" },
  ]), [
    { id: "effort", value: "high" },
    { id: "uncensored", value: "true" },
  ]);
 assert.deepEqual(providerNativeParams(model, [
 { id: "effort", value: "high" },
 { id: "context", value: "max" },
 { id: "uncensored", value: "true" },
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
