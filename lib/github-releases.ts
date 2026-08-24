import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RELEASE_URL = "https://api.github.com/repos/f1shyondrugs/metis-ai/releases/latest";
const USER_AGENT = "metis-ai-update-checker";
const cache: { etag?: string; release?: GithubRelease; checkedAt?: number } = {};
const CACHE_TTL_MS = 5 * 60_000;

export type GithubRelease = {
 tag_name: string;
 target_commitish?: string;
 name?: string;
 body?: string;
 html_url?: string;
};

export type UpdateCheck = {
 latestTag: string;
 currentRef: string;
 updateAvailable: boolean;
 release: GithubRelease;
};

export async function fetchLatestRelease(fetcher: typeof fetch = fetch): Promise<GithubRelease> {
 const now = Date.now();
 if (cache.release && cache.checkedAt && now - cache.checkedAt < CACHE_TTL_MS) return cache.release;
 const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" };
 if (cache.etag) headers["If-None-Match"] = cache.etag;
 const response = await fetcher(RELEASE_URL, { headers, cache: "no-store" });
 if (response.status === 304 && cache.release) {
 cache.checkedAt = now;
 return cache.release;
 }
 if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status}).`);
 const release = (await response.json()) as GithubRelease;
 if (!release.tag_name) throw new Error("GitHub returned a release without a tag.");
 cache.etag = response.headers.get("etag") || cache.etag;
 cache.release = release;
 cache.checkedAt = now;
 return release;
}

export async function resolveCurrentRef(root: string): Promise<string> {
 const configured = process.env.METIS_RELEASE_TAG?.trim();
 if (configured) return configured;
 try {
 const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root, timeout: 2_000 });
 return stdout.trim();
 } catch {
 try {
 const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { version?: unknown };
 return typeof packageJson.version === "string" ? packageJson.version.trim() : "unknown";
 } catch {
 return "unknown";
 }
 }
}

function normalizeRef(value: string) {
 return value.trim().replace(/^refs\/tags\//, "").replace(/^v/i, "").toLowerCase();
}

export function isReleaseNewer(release: GithubRelease, currentRef: string) {
 const current = normalizeRef(currentRef);
 return Boolean(current && current !== "unknown") &&
 normalizeRef(release.tag_name) !== current &&
 normalizeRef(release.target_commitish || "") !== current;
}

export async function checkForUpdate(root: string, fetcher?: typeof fetch): Promise<UpdateCheck> {
 const release = await fetchLatestRelease(fetcher);
 const currentRef = await resolveCurrentRef(root);
 return {
 latestTag: release.tag_name,
 currentRef,
 updateAvailable: isReleaseNewer(release, currentRef),
 release,
 };
}
