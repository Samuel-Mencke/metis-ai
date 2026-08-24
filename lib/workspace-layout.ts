export const CHAT_MIN_WIDTH = 640;
export const WORKSPACE_MIN_WIDTH = 280;
export const WORKSPACE_MAX_WIDTH = 1120;
export const WORKSPACE_SQUEEZE_MIN_WIDTH = 200;

export function clampWorkspaceWidth(width: number): number {
  if (!Number.isFinite(width)) return WORKSPACE_MIN_WIDTH;
  return Math.min(WORKSPACE_MAX_WIDTH, Math.max(WORKSPACE_MIN_WIDTH, Math.round(width)));
}

/** Largest workspace width that still leaves room for the chat column and sidebar. */
export function maxWorkspaceWidthWithSidebar(
  viewportWidth: number,
  sidebarWidth: number,
  chatMinWidth = CHAT_MIN_WIDTH,
  squeezeMin = WORKSPACE_SQUEEZE_MIN_WIDTH,
): number {
  return Math.max(squeezeMin, viewportWidth - sidebarWidth - chatMinWidth);
}

export function workspaceCrowdsSidebar(
  viewportWidth: number,
  sidebarWidth: number,
  workspaceWidth: number,
  chatMinWidth = CHAT_MIN_WIDTH,
): boolean {
  return viewportWidth < sidebarWidth + workspaceWidth + chatMinWidth;
}

/** Persist a smaller workspace so reopening the chat sidebar can keep both panes. */
export function workspaceWidthAfterReopeningSidebar(
  viewportWidth: number,
  sidebarWidth: number,
  workspaceWidth: number,
): number {
  return Math.min(workspaceWidth, maxWorkspaceWidthWithSidebar(viewportWidth, sidebarWidth));
}

export function displayedWorkspacePanelWidth(options: {
  workspaceOpen: boolean;
  workspaceFullscreen: boolean;
  workspaceWidth: number;
  viewportWidth: number;
  sidebarWidth: number;
}): number {
  const { workspaceOpen, workspaceFullscreen, workspaceWidth, viewportWidth, sidebarWidth } = options;
  if (!workspaceOpen || workspaceFullscreen) return workspaceWidth;
  const remaining = maxWorkspaceWidthWithSidebar(viewportWidth, sidebarWidth);
  return remaining >= workspaceWidth ? workspaceWidth : remaining;
}
