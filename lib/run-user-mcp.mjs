import process from "node:process";

const uid = Number(process.env.MCP_OS_UID);
const gid = Number(process.env.MCP_OS_GID);
if (process.getuid?.() === 0 && Number.isInteger(uid) && Number.isInteger(gid) && uid > 0) {
  if (process.env.MCP_OS_USERNAME && process.initgroups) {
    process.initgroups(process.env.MCP_OS_USERNAME, gid);
  }
  process.setgid(gid);
  process.setuid(uid);
}

await import(process.argv[2]);
