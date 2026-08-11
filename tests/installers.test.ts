import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installerDir = path.join(root, "public", "install");

test("all platform installers and uninstallers are published", () => {
  for (const file of ["linux.sh", "macos.sh", "windows.ps1", "uninstall.sh", "uninstall-macos.sh", "uninstall.ps1", "manifest.json"]) {
    assert.equal(existsSync(path.join(installerDir, file)), true, file);
  }
});

test("installer sources do not contain this deployment's machine path", () => {
  const files = ["linux.sh", "macos.sh", "windows.ps1", "uninstall.sh", "uninstall-macos.sh", "uninstall.ps1"];
  const localPath = ["/home", "f1shy312"].join("/");
  const localDomain = ["metis-ai", "f1shy312.com"].join(".");
  for (const file of files) {
    const content = readFileSync(path.join(installerDir, file), "utf8");
    assert.equal(content.includes(localPath), false, file);
    assert.equal(content.includes(localDomain), false, file);
  }
});

test("all platform installers expose an explicit network-host option", () => {
  for (const file of ["linux.sh", "macos.sh", "windows.ps1"]) {
    const content = readFileSync(path.join(root, "install", file), "utf8");
    const publicContent = readFileSync(path.join(installerDir, file), "utf8");
    for (const source of [content, publicContent]) {
      assert.match(source, /Host web application on local network/);
      assert.match(source, /AI_CHAT_HOST/);
      assert.match(source, /0\.0\.0\.0/);
    }
  }
});
