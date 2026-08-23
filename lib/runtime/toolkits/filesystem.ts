import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface FileViewResult {
  content: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

export async function viewFile(params: {
  filePath: string;
  cwd: string;
  startLine?: number;
  endLine?: number;
}): Promise<FileViewResult> {
  const resolved = path.isAbsolute(params.filePath)
    ? params.filePath
    : path.resolve(params.cwd, params.filePath);
  const raw = await fs.readFile(resolved, "utf8");
  const lines = raw.split(/\r?\n/);
  const totalLines = lines.length;

  const start = Math.max(1, params.startLine || 1);
  const end = Math.min(totalLines, params.endLine || Math.min(totalLines, start + 799));
  const slice = lines.slice(start - 1, end);
  const numbered = slice.map((line, idx) => `${start + idx}: ${line}`).join("\n");

  return {
    content: numbered,
    totalLines,
    startLine: start,
    endLine: end,
    truncated: end < totalLines || start > 1,
  };
}

export async function writeToFile(params: {
  filePath: string;
  cwd: string;
  content: string;
  overwrite?: boolean;
}): Promise<{ bytesWritten: number; path: string }> {
  const resolved = path.isAbsolute(params.filePath)
    ? params.filePath
    : path.resolve(params.cwd, params.filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });

  if (!params.overwrite) {
    try {
      await fs.access(resolved);
      throw new Error(`File ${resolved} already exists. Set overwrite: true to replace.`);
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  await fs.writeFile(resolved, params.content, "utf8");
  return { bytesWritten: Buffer.byteLength(params.content, "utf8"), path: resolved };
}

export async function replaceFileContent(params: {
  filePath: string;
  cwd: string;
  targetContent: string;
  replacementContent: string;
  allowMultiple?: boolean;
}): Promise<{ replacedCount: number; path: string }> {
  const resolved = path.isAbsolute(params.filePath)
    ? params.filePath
    : path.resolve(params.cwd, params.filePath);
  const original = await fs.readFile(resolved, "utf8");

  if (!original.includes(params.targetContent)) {
    throw new Error(`TargetContent not found in ${resolved}.`);
  }

  let replaced: string;
  let count = 0;
  if (params.allowMultiple) {
    const parts = original.split(params.targetContent);
    count = parts.length - 1;
    replaced = parts.join(params.replacementContent);
  } else {
    count = 1;
    replaced = original.replace(params.targetContent, params.replacementContent);
  }

  await fs.writeFile(resolved, replaced, "utf8");
  return { replacedCount: count, path: resolved };
}

export async function listDir(params: {
  dirPath: string;
  cwd: string;
}): Promise<{ entries: Array<{ name: string; isDirectory: boolean; size?: number }> }> {
  const resolved = path.isAbsolute(params.dirPath)
    ? params.dirPath
    : path.resolve(params.cwd, params.dirPath);
  const dirEntries = await fs.readdir(resolved, { withFileTypes: true });
  const results = await Promise.all(
    dirEntries.map(async (entry) => {
      let size: number | undefined;
      if (!entry.isDirectory()) {
        try {
          const stat = await fs.stat(path.join(resolved, entry.name));
          size = stat.size;
        } catch {
          // ignore stat errors
        }
      }
      return {
        name: entry.name,
        isDirectory: entry.isDirectory(),
        ...(size !== undefined ? { size } : {}),
      };
    }),
  );
  return { entries: results };
}

export async function findByName(params: {
  pattern: string;
  searchDirectory: string;
  cwd: string;
  maxDepth?: number;
}): Promise<{ files: string[] }> {
  const resolved = path.isAbsolute(params.searchDirectory)
    ? params.searchDirectory
    : path.resolve(params.cwd, params.searchDirectory);
  const args = ["-type", "f", "-name", params.pattern];
  if (params.maxDepth) {
    args.unshift("-maxdepth", String(params.maxDepth));
  }
  try {
    const { stdout } = await execFileAsync("find", [resolved, ...args], { maxBuffer: 10 * 1024 * 1024 });
    const lines = stdout.split(/\r?\n/).filter(Boolean).slice(0, 100);
    return { files: lines };
  } catch (err: any) {
    return { files: [] };
  }
}

export async function grepSearch(params: {
  query: string;
  searchPath: string;
  cwd: string;
  isRegex?: boolean;
  caseInsensitive?: boolean;
}): Promise<{ matches: Array<{ file: string; line: number; content: string }> }> {
  const resolved = path.isAbsolute(params.searchPath)
    ? params.searchPath
    : path.resolve(params.cwd, params.searchPath);
  const args = ["--line-number", "--no-heading", "--color=never"];
  if (params.caseInsensitive) args.push("-i");
  if (!params.isRegex) args.push("-F");
  args.push(params.query, resolved);

  try {
    const { stdout } = await execFileAsync("rg", args, { maxBuffer: 10 * 1024 * 1024 });
    const lines = stdout.split(/\r?\n/).filter(Boolean).slice(0, 100);
    const matches = lines.map((line) => {
      const parts = line.split(":");
      const file = parts[0];
      const lineNum = parseInt(parts[1] || "1", 10);
      const content = parts.slice(2).join(":");
      return { file, line: lineNum, content };
    });
    return { matches };
  } catch {
    return { matches: [] };
  }
}
