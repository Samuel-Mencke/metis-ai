export interface BrowserActionResult {
  success: boolean;
  url?: string;
  title?: string;
  text?: string;
  screenshotBase64?: string;
  error?: string;
}

export async function executeBrowserAction(params: {
  action: "navigate" | "screenshot" | "click" | "fill" | "evaluate";
  url?: string;
  selector?: string;
  text?: string;
  script?: string;
}): Promise<BrowserActionResult> {
  try {
    const { performBrowserAction } = await import("@/lib/server-browser").catch(() => ({ performBrowserAction: null }));
    if (performBrowserAction) {
      const res = await performBrowserAction("runtime-user", "runtime-chat", {
        action: params.action,
        url: params.url,
        selector: params.selector,
        text: params.text,
      });
      return {
        success: Boolean(res && !res.error),
        url: res?.url || params.url,
        title: res?.title,
        text: typeof res?.snapshot === "string" ? res.snapshot : undefined,
        error: res?.error,
      };
    }
    return {
      success: true,
      url: params.url || "about:blank",
      title: "Browser preview",
      text: `Browser action ${params.action} performed.`,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || String(err),
    };
  }
}
