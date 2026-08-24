import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { config } from "@/lib/config";
import { isHostAdmin } from "@/lib/user-access";
import { checkForUpdate } from "@/lib/github-releases";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1_800;

export async function GET(req: Request) {
 if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
 const userId = await getAuthenticatedUserId(req);
 if (!isHostAdmin(userId)) return Response.json({ error: "Only host administrators can check for updates." }, { status: 403 });
 try {
 const update = await checkForUpdate(config.root);
 return Response.json(update, { headers: { "Cache-Control": "private, no-store" } });
 } catch (error) {
 return Response.json({ error: error instanceof Error ? error.message : "Could not check for updates." }, { status: 502 });
 }
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = await getAuthenticatedUserId(req);
  if (!isHostAdmin(userId)) return Response.json({ error: "Only host administrators can update Metis." }, { status: 403 });

  const activeSlot = process.env.NEXT_DIST_DIR === ".next-a" ? ".next-a" : ".next-b";
  const inactiveSlot = activeSlot === ".next-a" ? ".next-b" : ".next-a";
  try {
    await execFileAsync(process.env.PNPM_BIN || "pnpm", ["install", "--frozen-lockfile"], {
      cwd: config.root,
      timeout: 15 * 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    await execFileAsync("bash", ["scripts/build-production-slot.sh", inactiveSlot], {
      cwd: config.root,
      env: { ...process.env, NODE_ENV: "production" },
      timeout: 30 * 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return Response.json({
      ok: true,
      activeSlot,
      preparedSlot: inactiveSlot,
      requiresRestart: true,
      message: "Update prepared in the inactive production slot. Restart is required to activate it.",
    });
  } catch (error) {
    const detail = error && typeof error === "object" && "stderr" in error
      ? String((error as { stderr?: unknown }).stderr || "")
      : "";
    return Response.json({
      error: `${error instanceof Error ? error.message : "Metis update failed."}${detail ? `: ${detail.slice(-800)}` : ""}`,
    }, { status: 500 });
  }
}
