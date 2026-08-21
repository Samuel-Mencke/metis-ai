import assert from "node:assert/strict";
import test from "node:test";
import { fitMermaidSvg, isMermaidErrorSvg, isMermaidSource, prepareMermaidSource, wrapBareMermaid } from "../lib/mermaid";

test("mermaid fences and flowchart sources are detected", () => {
  assert.equal(isMermaidSource("mermaid", "flowchart TD\n  a-->b"), true);
  assert.equal(isMermaidSource("flowchart", "flowchart TD\n  a-->b"), true);
  assert.equal(isMermaidSource(undefined, "flowchart TD\n  a-->b"), true);
  assert.equal(isMermaidSource("js", "const x = 1"), false);
});

test("bare flowchart blocks are wrapped as mermaid fences", () => {
  const wrapped = wrapBareMermaid("Intro\n\nflowchart TD\n  installer[Installer] --> app[App]\n\nDone");
  assert.match(wrapped, /```mermaid\nflowchart TD\n {2}installer\[Installer\] --> app\[App\]\n```/);
});

test("prepareMermaidSource quotes labels that mermaid would reject", () => {
  const prepared = prepareMermaidSource(
    "flowchart TD\n  compose[docker compose up] -->|ja Default| native[systemd / Windows Task]",
  );
  assert.match(prepared, /compose\["docker compose up"\]/);
  assert.match(prepared, /\|"ja Default"\|/);
  assert.match(prepared, /native\["systemd \/ Windows Task"\]/);
});

test("prepareMermaidSource quotes cylinders, diamonds, and -- edge labels", () => {
  const prepared = prepareMermaidSource(`flowchart TD
 installer[Installer] --> dockerCheck{Docker vorhanden?}
 dockerCheck -->|nein oder --native| native[systemd / Windows Task]
 settings --> db[(users + user_workspace_access)]
 bootstrap[bootstrap-user] --> adminUser[users.is_admin = 1]`);
  assert.match(prepared, /dockerCheck\{"Docker vorhanden\?"\}/);
  assert.match(prepared, /\|"nein oder --native"\|/);
  assert.match(prepared, /db\[\("users \+ user_workspace_access"\)\]/);
  assert.match(prepared, /adminUser\["users.is_admin = 1"\]/);
  assert.doesNotMatch(prepared, /db\["\(users/);
});

test("fitMermaidSvg drops fixed height so diagrams do not sit at the bottom", () => {
  const fitted = fitMermaidSvg(
    '<svg width="800" height="1200" style="max-width:800px;height:1200px" viewBox="0 0 800 1200"></svg>',
  );
  assert.doesNotMatch(fitted, /height="1200"/);
  assert.match(fitted, /max-width:100%;height:auto/);
});

test("isMermaidErrorSvg ignores mermaid CSS and catches the bomb SVG", () => {
  assert.equal(
    isMermaidErrorSvg('<svg class="flowchart"><style>#t1 .error-icon{fill:#a44141;}</style></svg>'),
    false,
  );
  assert.equal(
    isMermaidErrorSvg('<svg><text>Syntax error in text</text><text>mermaid version 11.17.0</text></svg>'),
    true,
  );
});
