export type LedgerClaim = {
  label: string;
  command: string;
  expect?: string[];
  reject?: string[];
  timeout?: number;
  target?: string;
};

export type LedgerEntry = {
  label: string;
  command: string;
  target?: string;
  verified: boolean;
  exitCode: number | null;
  matched?: string[];
  missing?: string[];
  foundRejected?: string[];
  outputTail?: string;
  at?: string;
};

export type LedgerSummary = {
  exists: boolean;
  job: string;
  chatId?: string;
  createdAt?: string;
  verified: number;
  failed: number;
  entries: Array<{ label: string; command: string; target: string; verified: boolean; exitCode: number | null; at?: string }>;
};

export type ShellResult = {
  exit_code: number;
  stdout: string;
  stderr: string;
};

export function normalizeClaims(raw: unknown): { claims: LedgerClaim[]; errors: string[] };

export function evaluateClaim(claim: LedgerClaim, result: Partial<ShellResult>): LedgerEntry;

export function recordVerified(
  job: undefined,
  context: { jobId?: string; chatId?: string },
  entries: LedgerEntry[],
): { job: string; chatId: string; createdAt: string; entries: LedgerEntry[] } | null;

export function ledgerSummary(context: { jobId?: string; chatId?: string }): LedgerSummary;

export function compactReport(results: LedgerEntry[]): {
  verified: number;
  total: number;
  allVerified: boolean;
  report: string;
};
