import process from "node:process";

const userId = String(process.env.MCP_USER_ID || "").trim();
const uid = Number(process.env.MCP_OS_UID);
const gid = Number(process.env.MCP_OS_GID);
const username = String(process.env.MCP_OS_USERNAME || "").trim();
const allowRoot = process.env.MCP_ALLOW_ROOT_AGENTS === "1";

if (process.getuid?.() === 0) {
  if (!userId) {
    console.error("MCP_USER_ID is required for isolated agent execution.");
    process.exit(1);
  }
  if (!Number.isInteger(uid) || uid < 0 || !Number.isInteger(gid) || gid < 0) {
    console.error("Agent execution requires a valid OS user mapping.");
    process.exit(1);
  }
  if (uid === 0) {
    if (!allowRoot) {
      console.error("Root agent execution is disabled unless explicitly configured.");
      process.exit(1);
    }
  } else {
    if (username && process.initgroups) {
      process.initgroups(username, gid);
    }
    process.setgid(gid);
    process.setuid(uid);
  }
}

if (process.getuid?.() === 0 && !allowRoot) {
  console.error("Refusing to run agent tools as root.");
  process.exit(1);
}

await import(process.argv[2]);
