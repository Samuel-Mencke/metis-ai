import assert from "node:assert/strict";
import test from "node:test";
import { isUncensoredEnabled, sanitizeModelParams } from "../lib/feature-flags";

test("uncensored stays off unless METIS_ENABLE_UNCENSORED is set", () => {
  const previous = process.env.METIS_ENABLE_UNCENSORED;
  delete process.env.METIS_ENABLE_UNCENSORED;
  assert.equal(isUncensoredEnabled(), false);
  process.env.METIS_ENABLE_UNCENSORED = "true";
  assert.equal(isUncensoredEnabled(), true);
  process.env.METIS_ENABLE_UNCENSORED = "0";
  assert.equal(isUncensoredEnabled(), false);
  if (previous === undefined) delete process.env.METIS_ENABLE_UNCENSORED;
  else process.env.METIS_ENABLE_UNCENSORED = previous;
});

test("sanitizeModelParams strips uncensored when the flag is off", () => {
  const previous = process.env.METIS_ENABLE_UNCENSORED;
  delete process.env.METIS_ENABLE_UNCENSORED;
  const params = [
    { id: "effort", value: "high" },
    { id: "uncensored", value: "true" },
  ];
  assert.deepEqual(sanitizeModelParams(params), [{ id: "effort", value: "high" }]);
  process.env.METIS_ENABLE_UNCENSORED = "true";
  assert.deepEqual(sanitizeModelParams(params), params);
  if (previous === undefined) delete process.env.METIS_ENABLE_UNCENSORED;
  else process.env.METIS_ENABLE_UNCENSORED = previous;
});
