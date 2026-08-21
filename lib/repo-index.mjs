import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_EXCLUDES = new Set([
  ".git",
  ".next",
  ".next-a",
  ".next-b",
  "node_modules",
  "data",
  "dist",
  "coverage",
]);
const TEXT_EXTENSIONS = new Set([
  ".cjs", ".css", ".go", ".html", ".java", ".js", ".json", ".md", ".mjs",
  ".py", ".sh", ".sql", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);

function indexPath(root) {
  return process.env.METIS_REPO_INDEX_PATH || path.join(root, "data", "repo-index.json");
}

function extractMetadata(filePath, content) {
  const symbols = [];
  const imports = [];
  for (const match of content.matchAll(/\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    symbols.push(match[1]);
  }
  for (const match of content.matchAll(/\bimport\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']/g)) imports.push(match[1]);
  for (const match of content.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) imports.push(match[1]);
  const keywords = [...new Set(
    `${filePath} ${symbols.join(" ")} ${content.slice(0, 30_000)}`
      .toLowerCase()
      .match(/[a-z][a-z0-9_-]{2,}/g) || [],
  )].slice(0, 600);
  return {
    symbols: [...new Set(symbols)].slice(0, 300),
    imports: [...new Set(imports)].slice(0, 300),
    keywords,
  };
}

async function walk(root, current, output) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    if (entry.isDirectory() && DEFAULT_EXCLUDES.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(root, full, output);
      continue;
    }
    const extension = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const stat = await fs.stat(full);
    output.push({
      path: path.relative(root, full),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }
}

export async function buildRepositoryIndex(root, { force = false } = {}) {
  const resolvedRoot = path.resolve(root);
  const cacheFile = indexPath(resolvedRoot);
  let previous = { files: [] };
  if (!force) {
    try { previous = JSON.parse(await fs.readFile(cacheFile, "utf8")); } catch {}
  }
  const previousByPath = new Map((previous.files || []).map((file) => [file.path, file]));
  const discovered = [];
  await walk(resolvedRoot, resolvedRoot, discovered);
  const files = [];
  for (const file of discovered) {
    const old = previousByPath.get(file.path);
    if (old && old.size === file.size && old.mtimeMs === file.mtimeMs) {
      files.push(old);
      continue;
    }
    let content = "";
    try { content = await fs.readFile(path.join(resolvedRoot, file.path), "utf8"); } catch {}
    files.push({ ...file, ...extractMetadata(file.path, content) });
  }
  const result = {
    version: 1,
    root: resolvedRoot,
    generatedAt: new Date().toISOString(),
    files,
  };
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  const temp = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(result), "utf8");
  await fs.rename(temp, cacheFile);
  return result;
}

function score(file, terms) {
  const haystack = `${file.path} ${(file.symbols || []).join(" ")} ${(file.keywords || []).join(" ")}`.toLowerCase();
  return terms.reduce((sum, term) => sum + (haystack.includes(term) ? (file.path.toLowerCase().includes(term) ? 3 : 1) : 0), 0);
}

export async function searchRepository(root, query, { limit = 20 } = {}) {
  const index = await buildRepositoryIndex(root);
  const terms = String(query || "").toLowerCase().split(/\s+/).filter((term) => term.length > 1);
  const results = index.files
    .map((file) => ({ file, score: score(file, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .slice(0, Math.max(1, Math.min(Number(limit) || 20, 100)))
    .map(({ file, score: matchScore }) => ({
      path: file.path,
      score: matchScore,
      symbols: file.symbols || [],
      imports: file.imports || [],
      size: file.size,
    }));
  return { query, results, indexedFiles: index.files.length, generatedAt: index.generatedAt };
}

export async function inspectCodebase(root, query, options = {}) {
  const result = await searchRepository(root, query, options);
  return {
    ...result,
    results: result.results.map((item) => ({
      ...item,
      symbols: item.symbols.slice(0, 40),
      imports: item.imports.slice(0, 40),
    })),
  };
}

export async function findSymbol(root, symbol, { limit = 20 } = {}) {
  const index = await buildRepositoryIndex(root);
  const needle = String(symbol || "").toLowerCase();
  return {
    symbol,
    results: index.files
      .filter((file) => (file.symbols || []).some((item) => item.toLowerCase() === needle || item.toLowerCase().includes(needle)))
      .slice(0, Math.max(1, Math.min(Number(limit) || 20, 100)))
      .map((file) => ({ path: file.path, symbols: file.symbols, imports: file.imports })),
    indexedFiles: index.files.length,
  };
}
