import assert from "node:assert/strict";
import test from "node:test";
import { decodeBase64Size, isTextAttachment, sanitizeFileName } from "../lib/uploads";

test("attachment helpers classify and sanitize files safely", () => {
  assert.equal(sanitizeFileName("../../notes: draft?.txt"), "notes_ draft_.txt");
  assert.equal(isTextAttachment({ mimeType: "application/json", name: "data.bin" }), true);
  assert.equal(isTextAttachment({ mimeType: "application/octet-stream", name: "script.ts" }), true);
  assert.equal(isTextAttachment({ mimeType: "application/octet-stream", name: "archive.zip" }), false);
});

test("base64 size calculation matches decoded payload size", () => {
  assert.equal(decodeBase64Size(Buffer.from("hello").toString("base64")), 5);
  assert.equal(decodeBase64Size(Buffer.from("hello world").toString("base64")), 11);
});
