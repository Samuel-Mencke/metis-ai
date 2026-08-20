const DIAGRAM_START =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|gitGraph|timeline|quadrantChart|sankey(?:-beta)?|xychart(?:-beta)?|block-beta|C4Context)\b/;

export function isMermaidSource(language: string | undefined, code: string) {
  const lang = (language || "").toLowerCase();
  if (lang === "mermaid" || lang === "flowchart") return true;
  return DIAGRAM_START.test(code.trim());
}

function quoteLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed;
  }
  if (!/[\s()\/\\:,.#?=+*&<>!@%]|--/.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/"/g, "#quot;")}"`;
}

export function prepareMermaidSource(code: string) {
  return code
    .replace(/\r\n/g, "\n")
    .replace(/(\b[\w.-]+)\[\(([^)\n]+)\)\]/g, (_, id, label) => `${id}[(${quoteLabel(label)})]`)
    .replace(/(\b[\w.-]+)\[\[([^\]\n]+)\]\]/g, (_, id, label) => `${id}[[${quoteLabel(label)}]]`)
    .replace(/(\b[\w.-]+)\[\/([^\]\n]+)\/\]/g, (_, id, label) => `${id}[/${quoteLabel(label)}/]`)
    .replace(/(\b[\w.-]+)\[\\([^\]\n]+)\\\]/g, (_, id, label) => `${id}[\\${quoteLabel(label)}\\]`)
    .replace(/(\b[\w.-]+)\[([^\]\n]+)\]/g, (_, id, label) => {
      const trimmed = label.trim();
      if ("([\"'/\\".includes(trimmed[0] || "")) return `${id}[${label}]`;
      return `${id}[${quoteLabel(label)}]`;
    })
    .replace(/(\b[\w.-]+)\{([^{}\n]+)\}/g, (_, id, label) => `${id}{${quoteLabel(label)}}`)
    .replace(/(\b[\w.-]+)\(\[([^\]\n]+)\]\)/g, (_, id, label) => `${id}([${quoteLabel(label)}])`)
    .replace(/\|([^|\n]+)\|/g, (_, label) => `|${quoteLabel(label)}|`)
    .trim();
}

export function isMermaidErrorSvg(svg: string) {
  return /syntax error in text|Parse error/i.test(svg)
    || /<text[^>]*>\s*mermaid version/i.test(svg)
    || /class="[^"]*error-icon/.test(svg);
}

export function fitMermaidSvg(svg: string) {
  return svg
    .replace(/\s(height|width)="[^"]*"/gi, "")
    .replace(/style="([^"]*)"/i, (_, style: string) => {
      const cleaned = style
        .replace(/max-width\s*:[^;]+;?/gi, "")
        .replace(/height\s*:[^;]+;?/gi, "")
        .replace(/width\s*:[^;]+;?/gi, "")
        .trim()
        .replace(/;+$/, "");
      const next = [cleaned, "max-width:100%;height:auto"].filter(Boolean).join(";");
      return `style="${next}"`;
    });
}

export function wrapBareMermaid(content: string) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part) => {
      if (part.startsWith("```")) return part;
      const lines = part.split("\n");
      const output: string[] = [];
      for (let index = 0; index < lines.length; index += 1) {
        if (!DIAGRAM_START.test(lines[index].trim())) {
          output.push(lines[index]);
          continue;
        }
        const block = [lines[index]];
        index += 1;
        while (index < lines.length && lines[index].trim() !== "") {
          block.push(lines[index]);
          index += 1;
        }
        output.push("```mermaid", ...block, "```");
        if (index < lines.length) output.push(lines[index]);
      }
      return output.join("\n");
    })
    .join("");
}
