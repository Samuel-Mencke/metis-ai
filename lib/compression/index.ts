export type CompressionMode = "lite" | "standard" | "aggressive" | "ultra" | "rtk" | "stacked";

export type CompressionResult = {
  text: string;
  inputChars: number;
  outputChars: number;
  removedChars: number;
  mode: CompressionMode;
  changed: boolean;
};

const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CODE_BLOCK_RE = /(```[\s\S]*?```|`[^`\n]+`)/g;
const URL_RE = /(https?:\/\/[^\s)]+|(?:\/|~\/)[\w./@:+~-]+)/g;
function protect(text: string, transform: (value: string) => string) {
  const protectedParts: string[] = [];
  const mask = (part: string) => {
    const index = protectedParts.push(part) - 1;
    return `\u0000${index}\u0000`;
  };
  const masked = text.replace(CODE_BLOCK_RE, mask).replace(URL_RE, mask);
  const transformed = transform(masked);
  return transformed.replace(/\u0000(\d+)\u0000/g, (_, index: string) => protectedParts[Number(index)] || "");
}

function isImportantLine(line: string) {
  return /(\berror\b|\bfail(?:ed|ure)?\b|\bwarning\b|\bwarn\b|\bexception\b|\btraceback\b|\bexit code\b|\bchanged files?\b|\bsummary\b|\bpassed\b|\btest[s]?\b.*\bpassed\b)/i.test(line);
}

function rtk(text: string) {
  const cleaned = text.replace(ANSI_RE, "");
  const lines = cleaned.split(/\r?\n/);
  const output: string[] = [];
  let previous = "";
  let repeated = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(/[ \t]+$/g, "");
    const normalized = line.trim();
    if (!normalized) {
      if (output.at(-1) !== "") output.push("");
      continue;
    }
    if (/^(?:[#-]{2,}\s*)?(?:progress|downloading|installing)\b.*(?:\d+%|\|)/i.test(normalized)) continue;
    if (/^(?:webpack|vite|turbo|npm|pnpm|yarn)\b.*(?:compiled|building|transforming)\b.*(?:\d+%|in \d+)/i.test(normalized)) continue;
    if (normalized === previous) {
      repeated += 1;
      if (repeated > 1 && !isImportantLine(normalized)) continue;
    } else {
      previous = normalized;
      repeated = 0;
    }
    output.push(line.length > 2_000 ? `${line.slice(0, 1_800)} … [line truncated]` : line);
  }

  const compact = output.join("\n").replace(/\n{4,}/g, "\n\n");
  if (compact.length <= 12_000) return compact;
  const head = compact.slice(0, 7_000);
  const tail = compact.slice(-5_000);
  return `${head}\n… [middle truncated by RTK] …\n${tail}`;
}

function caveman(text: string, intensity: "lite" | "standard" | "aggressive" | "ultra") {
  const replacements: Array<[RegExp, string]> = [
    [/\bplease\s+/gi, ""],
    [/\bkindly\s+/gi, ""],
    [/\bin order to\b/gi, "to"],
    [/\bat this point in time\b/gi, "now"],
    [/\bdue to the fact that\b/gi, "because"],
    [/\bhas the ability to\b/gi, "can"],
    [/\bis able to\b/gi, "can"],
    [/\bfor the purpose of\b/gi, "for"],
    [/\bcurrently\b/gi, "now"],
  ];
  const maxPasses = intensity === "lite" ? 1 : intensity === "standard" ? 2 : intensity === "aggressive" ? 3 : 4;
  return protect(text, (value) => {
    let result = value;
    for (const [pattern, replacement] of replacements.slice(0, 4 + maxPasses)) {
      result = result.replace(pattern, replacement);
    }
    result = result.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
    if (intensity === "aggressive" || intensity === "ultra") {
      result = result.replace(/^(?:furthermore|moreover|additionally),?\s+/gim, "");
      result = result.replace(/\b(it is important to note that|as mentioned above),?\s*/gi, "");
    }
    if (intensity === "ultra") {
      result = result.replace(/\b(really|very|quite|just|simply)\b\s*/gi, "");
    }
    return result;
  });
}

function lite(text: string) {
  return protect(text, (value) => value
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n"));
}

export function compress(input: string, mode: CompressionMode = "stacked"): CompressionResult {
  const original = typeof input === "string" ? input : String(input ?? "");
  try {
    let text = original;
    if (mode === "rtk" || mode === "stacked") text = rtk(text);
    if (mode === "lite") text = lite(text);
    if (mode === "standard" || mode === "aggressive" || mode === "ultra" || mode === "stacked") {
      text = caveman(text, mode === "stacked" ? "standard" : mode);
    }
    if (mode === "stacked") text = lite(text);
    return {
      text,
      inputChars: original.length,
      outputChars: text.length,
      removedChars: Math.max(0, original.length - text.length),
      mode,
      changed: text !== original,
    };
  } catch {
    return {
      text: original,
      inputChars: original.length,
      outputChars: original.length,
      removedChars: 0,
      mode,
      changed: false,
    };
  }
}

export function compressionModes(): Array<{ value: CompressionMode; label: string; description: string }> {
  return [
    { value: "lite", label: "Lite", description: "Sehr risikoarme Whitespace- und Duplikatbereinigung." },
    { value: "standard", label: "Standard", description: "Kondensiert normale Prosa." },
    { value: "aggressive", label: "Aggressive", description: "Stärkere, potenziell verlustbehaftete Prosa-Kompression." },
    { value: "rtk", label: "RTK", description: "Optimiert Terminal-, Build-, Test- und Git-Ausgaben." },
    { value: "stacked", label: "Stacked", description: "RTK und Caveman kombiniert; empfohlen für Coding-Agent-Kontexte." },
    { value: "ultra", label: "Ultra", description: "Maximale Kompression als letzter Ausweg bei großen Kontexten." },
  ];
}
