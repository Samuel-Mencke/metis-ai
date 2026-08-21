export type RepoIndexFile = {
  path: string;
  size: number;
  mtimeMs: number;
  symbols?: string[];
  imports?: string[];
  keywords?: string[];
};

export type RepoIndex = {
  version: number;
  root: string;
  generatedAt: string;
  files: RepoIndexFile[];
};

export function buildRepositoryIndex(root: string, options?: { force?: boolean }): Promise<RepoIndex>;
export function searchRepository(root: string, query: string, options?: { limit?: number }): Promise<{
  query: string;
  results: Array<{ path: string; score: number; symbols: string[]; imports: string[]; size: number }>;
  indexedFiles: number;
  generatedAt: string;
}>;
export function inspectCodebase(root: string, query: string, options?: { limit?: number }): Promise<{
  query: string;
  results: Array<{ path: string; score: number; symbols: string[]; imports: string[]; size: number }>;
  indexedFiles: number;
  generatedAt: string;
}>;
export function findSymbol(root: string, symbol: string, options?: { limit?: number }): Promise<{
  symbol: string;
  results: Array<{ path: string; symbols: string[]; imports: string[] }>;
  indexedFiles: number;
}>;
