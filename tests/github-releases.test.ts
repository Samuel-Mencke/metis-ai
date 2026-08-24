import assert from "node:assert/strict";
import test from "node:test";
import { isReleaseNewer, type GithubRelease } from "../lib/github-releases";

const release = (tag: string, commit?: string): GithubRelease => ({
  tag_name: tag,
  target_commitish: commit,
});

test("a different release tag is treated as an available update", () => {
  assert.equal(isReleaseNewer(release("v1.4.0"), "v1.3.2"), true);
  assert.equal(isReleaseNewer(release("1.4.0"), "v1.4.0"), false);
  assert.equal(isReleaseNewer(release("v1.4.0", "abc123"), "abc123"), false);
});

test("unknown or empty current refs do not claim an update", () => {
  assert.equal(isReleaseNewer(release("v1.4.0"), "unknown"), false);
  assert.equal(isReleaseNewer(release("v1.4.0"), ""), false);
});
