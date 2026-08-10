import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createAccount } from "@/lib/accounts";

const readline = createInterface({ input, output });

async function questionHidden(prompt: string) {
  output.write(prompt);
  return new Promise<string>((resolve) => {
    let value = "";
    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString()) {
        if (character === "\r" || character === "\n") {
          input.setRawMode?.(false);
          input.pause();
          input.off("data", onData);
          output.write("\n");
          resolve(value);
        } else if (character === "\u0003") {
          process.exit(130);
        } else if (character === "\u007f") {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    input.setRawMode?.(true);
    input.resume();
    input.on("data", onData);
  });
}

async function main() {
  try {
    const username = (process.env.METIS_AI_BOOTSTRAP_USERNAME || await readline.question("Username: ")).trim();
    const password = process.env.METIS_AI_BOOTSTRAP_PASSWORD || await questionHidden("Password: ");
    const confirmation = process.env.METIS_AI_BOOTSTRAP_PASSWORD
      ? password
      : await questionHidden("Confirm password: ");

    if (!username || password !== confirmation) {
      throw new Error("Username is required and passwords must match.");
    }
    const account = createAccount(username, password);
    if (!account) {
      if (process.env.METIS_AI_BOOTSTRAP_OPTIONAL === "1") {
        console.log("Initial account already exists; keeping the existing account.");
        return;
      }
      throw new Error("Could not create account. The username may already exist or the password is too short.");
    }
    console.log(`Created initial account: ${account.username}`);
  } finally {
    readline.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
