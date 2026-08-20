const DIAGRAM_START =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|gitGraph|timeline|quadrantChart|sankey(?:-beta)?|xychart(?:-beta)?|block-beta|C4Context)\b/;

export function isMermaidSource(language: string | undefined, code: string) {
  const lang = (language || "").toLowerCase();
  if (lang === "mermaid" || lang === "flowchart") return true;
  return DIAGRAM_START.test(code.trim());
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
