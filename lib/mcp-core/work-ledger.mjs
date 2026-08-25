// work-ledger.mjs — proof-of-work ledger for the Metis gateway.
//
// Companion to the `verify_work` gateway tool: an agent lists concrete claims
// ("tests pass", "server is up", …) each backed by a command plus expected
// output markers; the tool executes them and records verified/failed entries
// in a per-job ledger. `ledger_review` reads the ledger back so finished work
// is cited by evidence, not by assertion.
//
// Pure logic only — shell execution stays in gateway-core.mjs (runShell +
// policy already live there). The in-memory store is anchored on globalThis
// because tsx-loaded gateway code and bundled code can get separate module
// instances of this file.

const MAX_CLAIMS = 10;
const MAX_LABEL = 200;
const MAX_EXPECT = 8;
const DEFAULT_TIMEOUT = 30;
const MAX_TIMEOUT = 120;

function globalStore() {
  const key = "__metisWorkLedger";
  if (!globalThis[key]) globalThis[key] = new Map();
  return globalThis[key];
}

export function normalizeClaims(raw) {
  const errors = [];
  const claims = [];
  const list = Array.isArray(raw) ? raw.slice(0, MAX_CLAIMS) : [];
  list.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      errors.push(`claim ${index + 1}: must be an object`);
      return;
    }
    const label = String(item.label || "").trim().slice(0, MAX_LABEL);
    const command = String(item.command || "").trim();
    if (!label) errors.push(`claim ${index + 1}: label is required`);
    if (!command) errors.push(`claim ${index + 1}: command is required`);
    if (!label || !command) return;
    const expect = (Array.isArray(item.expect) ? item.expect : [])
      .map((s) => String(s).trim()).filter(Boolean).slice(0, MAX_EXPECT);
    const reject = (Array.isArray(item.reject) ? item.reject : [])
      .map((s) => String(s).trim()).filter(Boolean).slice(0, MAX_EXPECT);
    const timeout = Math.max(
      1,
      Math.min(Number(item.timeout) || DEFAULT_TIMEOUT, MAX_TIMEOUT),
    );
    const target = String(item.target || "server").trim() || "server";
    claims.push({ label, command, expect, reject, timeout, target });
  });
  return { claims, errors };
}

// Evaluate one executed claim against its shell result.
// `result` shape: { exit_code, stdout, stderr } (runShell/runSpawn contract).
export function evaluateClaim(claim, result) {
  const text = `${result?.stdout || ""}\n${result?.stderr || ""}`;
  const lower = text.toLowerCase();
  const matched = claim.expect.filter((s) => lower.includes(s.toLowerCase()));
  const missing = claim.expect.filter((s) => !lower.includes(s.toLowerCase()));
  const foundRejected = claim.reject.filter((s) => lower.includes(s.toLowerCase()));
  const exitCode = result?.exit_code ?? result?.exitCode ?? null;
  const exitOk = Number(exitCode) === 0;
  const verified = exitOk && missing.length === 0 && foundRejected.length === 0;
  const tail = text.trim().split("\n").slice(-4).join("\n").slice(0, 600);
  return {
    label: claim.label,
    command: claim.command,
    target: claim.target,
    verified,
    exitCode,
    matched,
    missing,
    foundRejected,
    outputTail: tail,
  };
}

function jobKey(context = {}) {
  return String(context.jobId || context.chatId || "").trim();
}

export function recordVerified(job, context, entries) {
  const key = jobKey(context);
  if (!key) return null;
  const store = globalStore();
  const record =
    store.get(key) ||
    { job: key, chatId: String(context.chatId || ""), createdAt: new Date().toISOString(), entries: [] };
  for (const entry of entries) {
    record.entries.push({ ...entry, at: new Date().toISOString() });
  }
  // bound the ledger: keep the most recent 40 entries
  if (record.entries.length > 40) {
    record.entries = record.entries.slice(-40);
  }
  store.set(key, record);
  return record;
}

export function ledgerSummary(context = {}) {
  const key = jobKey(context);
  const store = globalStore();
  const record = key ? store.get(key) : null;
  if (!record) {
    return { exists: false, job: key, entries: [], verified: 0, failed: 0 };
  }
  const verified = record.entries.filter((e) => e.verified).length;
  return {
    exists: true,
    job: record.job,
    chatId: record.chatId,
    createdAt: record.createdAt,
    verified,
    failed: record.entries.length - verified,
    entries: record.entries.map((e) => ({
      label: e.label,
      command: e.command,
      target: e.target,
      verified: e.verified,
      exitCode: e.exitCode,
      at: e.at,
    })),
  };
}

export function compactReport(results) {
  const verified = results.filter((r) => r.verified).length;
  const lines = results.map((r) => {
    const missing = Array.isArray(r.missing) ? r.missing : [];
    const foundRejected = Array.isArray(r.foundRejected) ? r.foundRejected : [];
    return `${r.verified ? "VERIFIED" : "FAILED"}  ${r.label}  (exit ${r.exitCode})${
      missing.length ? `  missing: ${missing.join(", ")}` : ""
    }${foundRejected.length ? `  rejected-output: ${foundRejected.join(", ")}` : ""}`;
  });
  return {
    verified,
    total: results.length,
    allVerified: verified === results.length && results.length > 0,
    report: lines.join("\n"),
  };
}
