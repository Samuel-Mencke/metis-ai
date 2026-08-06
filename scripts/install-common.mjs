#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const defaults = {
  repository: process.env.METIS_AI_REPOSITORY || "f1shyondrugs/metis-ai",
  branch: process.env.METIS_AI_BRANCH || "master",
  minimumNode: Number(process.env.METIS_AI_MIN_NODE || 20),
};

function value(name) {
  return process.env[name]?.trim() || "";
}

function fail(message, code = 2) {
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = code;
}

export function validateOptions(options) {
  const installDir = options.installDir || "";
  const dataDir = options.dataDir || "";
  const agentCwd = options.agentCwd || "";
  const port = Number(options.port);
  const mcpPort = Number(options.mcpPort);
  const appName = options.appName || "Metis AI";
  const serviceName = options.serviceName || "metis-ai-worker";

  if (!installDir || !path.isAbsolute(installDir)) {
    throw new Error("--install-dir must be an absolute path");
  }
  if (dataDir && !path.isAbsolute(dataDir)) {
    throw new Error("--data-dir must be an absolute path");
  }
  if (agentCwd && !path.isAbsolute(agentCwd)) {
    throw new Error("--agent-cwd must be an absolute path");
  }
  for (const [name, number] of [["port", port], ["mcp-port", mcpPort]]) {
    if (!Number.isInteger(number) || number < 1 || number > 65535) {
      throw new Error(`--${name} must be an integer between 1 and 65535`);
    }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{1,63}$/.test(appName)) {
    throw new Error("--app-name contains unsupported characters");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$/.test(serviceName)) {
    throw new Error("--service-name contains unsupported characters");
  }
  return {
    ...options,
    installDir,
    dataDir: dataDir || path.join(installDir, "data"),
    agentCwd: agentCwd || installDir,
    port,
    mcpPort,
    appName,
    serviceName,
  };
}

export function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function installerDefaults() {
  return {
    ...defaults,
    platform: process.platform,
    architecture: process.arch,
    home: os.homedir(),
    cwd: process.cwd(),
    envSource: value("METIS_AI_SOURCE"),
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [key, inline] = token.slice(2).split("=", 2);
    if (inline !== undefined) result[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) result[key] = argv[++index];
    else result[key] = true;
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command = "help", ...argv] = process.argv.slice(2);
  try {
    if (command === "defaults") {
      process.stdout.write(`${JSON.stringify(installerDefaults())}\n`);
    } else if (command === "random-secret") {
      process.stdout.write(`${randomSecret()}\n`);
    } else if (command === "validate") {
      const args = parseArgs(argv);
      process.stdout.write(`${JSON.stringify(validateOptions({
        installDir: args["install-dir"],
        dataDir: args["data-dir"],
        agentCwd: args["agent-cwd"],
        port: args.port,
        mcpPort: args["mcp-port"],
        appName: args["app-name"],
        serviceName: args["service-name"],
      }))}\n`);
    } else {
      process.stdout.write(
        "Usage: install-common.mjs <defaults|random-secret|validate> [options]\n",
      );
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
