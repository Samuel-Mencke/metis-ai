import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isAuthenticated } from "@/lib/auth";
import { config } from "@/lib/config";
import { isUncensoredEnabled } from "@/lib/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function promptsPath() {
  const custom = process.env.METIS_PROMPTS_PATH?.trim();
  if (custom) return custom;
  const inData = path.join(config.dataDir, "prompts.json");
  if (existsSync(inData)) return inData;
  return path.join(config.root, "public", "prompts.json");
}

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isUncensoredEnabled()) {
    return new Response(null, { status: 404 });
  }
  const file = promptsPath();
  if (!existsSync(file)) {
    return new Response(null, { status: 404 });
  }
  return new Response(readFileSync(file, "utf8"), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
