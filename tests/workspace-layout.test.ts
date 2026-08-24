import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CHAT_MIN_WIDTH,
  displayedWorkspacePanelWidth,
  maxWorkspaceWidthWithSidebar,
  workspaceCrowdsSidebar,
  workspaceWidthAfterReopeningSidebar,
} from "../lib/workspace-layout";

const shellSource = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");

test("reopening the sidebar shrinks an oversized workspace instead of leaving both overflowing", () => {
  const viewport = 1400;
  const sidebar = 280;
  const crowded = 900;
  assert.equal(workspaceCrowdsSidebar(viewport, sidebar, crowded), true);
  const next = workspaceWidthAfterReopeningSidebar(viewport, sidebar, crowded);
  assert.equal(next, maxWorkspaceWidthWithSidebar(viewport, sidebar));
  assert.equal(next, viewport - sidebar - CHAT_MIN_WIDTH);
  assert.equal(workspaceCrowdsSidebar(viewport, sidebar, next), false);
});

test("displayed workspace width squeezes to the remaining column when the sidebar is open", () => {
  assert.equal(displayedWorkspacePanelWidth({
    workspaceOpen: true,
    workspaceFullscreen: false,
    workspaceWidth: 900,
    viewportWidth: 1400,
    sidebarWidth: 280,
  }), 480);
  assert.equal(displayedWorkspacePanelWidth({
    workspaceOpen: true,
    workspaceFullscreen: true,
    workspaceWidth: 900,
    viewportWidth: 1400,
    sidebarWidth: 280,
  }), 900);
});

test("project hub closes the workspace and the browser panel uses the resizable width", () => {
  assert.match(shellSource, /function openProjectHome\(projectId: string\) \{[\s\S]*?setWorkspaceOpen\(false\);/);
  assert.match(shellSource, /const toggleDesktopSidebar = useCallback\(/);
  assert.match(shellSource, /workspaceWidthAfterReopeningSidebar/);
  assert.match(shellSource, /displayedWorkspacePanelWidth/);
  assert.doesNotMatch(shellSource, /min\(68vw, 1040px\)/);
  assert.match(shellSource, /aria-label="Workspace panel width"/);
});
