import assert from "node:assert/strict";
import test from "node:test";
import { isProjectLogoMime, MAX_PROJECT_FILE_BYTES, MAX_PROJECT_LOGO_BYTES } from "../lib/project-constants";

test("project logos accept common image types only", () => {
 assert.equal(isProjectLogoMime("image/png"), true);
 assert.equal(isProjectLogoMime("image/jpeg; charset=utf-8"), true);
 assert.equal(isProjectLogoMime("image/svg+xml"), true);
 assert.equal(isProjectLogoMime("application/pdf"), false);
 assert.equal(isProjectLogoMime("text/plain"), false);
 assert.ok(MAX_PROJECT_LOGO_BYTES < MAX_PROJECT_FILE_BYTES);
});
