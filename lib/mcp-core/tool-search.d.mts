export const CHILD_CONNECT_TIMEOUT_MS: number;
export const SEARCH_OVERALL_TIMEOUT_MS: number;
export const SEARCH_STDIO_CONCURRENCY: number;
export const SEARCH_REMOTE_CONCURRENCY: number;

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T>;

export function withOverallBudget<W, F>(
  work: Promise<W> | W,
  timeoutMs: number,
  fallbackFactory: (reason: string) => F,
): Promise<W | F>;

export function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R> | R,
): Promise<R[]>;

export function scoreToolHaystack(query: unknown, haystack: unknown): number;

export interface ToolSearchEntry {
  id?: string;
  name?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface ToolSearchTool {
  name?: string;
  description?: string;
  [key: string]: unknown;
}

export interface ToolMatch {
  server: string;
  name: string;
  description?: string;
  score: number;
  [key: string]: unknown;
}

export function toolSearchHaystack(entry: ToolSearchEntry, tool: ToolSearchTool): string;
export function rankToolMatches<T extends ToolMatch>(found: readonly T[], limit?: number): T[];
export function compactToolMatch(
  entry: ToolSearchEntry & { id: string },
  tool: ToolSearchTool & { name: string },
  score: number,
): { server: string; name: string; description: string; score: number };
