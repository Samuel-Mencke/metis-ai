import assert from "node:assert/strict";
import test from "node:test";
import { bearerTokenMatches, safeEqual } from "../lib/security";
import { consumeRateLimit, resetRateLimit } from "../lib/rate-limit";

test("safeEqual only matches equal strings", () => {
  assert.equal(safeEqual("secret", "secret"), true);
  assert.equal(safeEqual("secret", "secreT"), false);
  assert.equal(safeEqual("secret", "secret-longer"), false);
});

test("bearerTokenMatches requires a well-formed bearer header", () => {
  const request = (authorization?: string) => new Request("http://localhost", {
    headers: authorization ? { authorization } : undefined,
  });

  assert.equal(bearerTokenMatches(request("Bearer token"), "token"), true);
  assert.equal(bearerTokenMatches(request("bearer token"), "token"), true);
  assert.equal(bearerTokenMatches(request("token"), "token"), false);
  assert.equal(bearerTokenMatches(request("Bearer wrong"), "token"), false);
});

test("rate limits reject attempts after the configured threshold", () => {
  const key = `test:${Date.now()}`;
  resetRateLimit(key);
  assert.equal(consumeRateLimit(key, 2, 60_000).allowed, true);
  assert.equal(consumeRateLimit(key, 2, 60_000).allowed, true);
  assert.equal(consumeRateLimit(key, 2, 60_000).allowed, false);
  resetRateLimit(key);
});
