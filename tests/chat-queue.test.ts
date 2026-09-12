import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

const dataDir = path.join(os.tmpdir(), `metis-chat-queue-${randomUUID()}`);
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");

const modulesPromise = Promise.all([
  import("../lib/auth"),
  import("../lib/db-store"),
  import("../lib/chat-queue"),
]);
let modules!: Awaited<typeof modulesPromise>;

before(async () => {
  modules = await modulesPromise;
});

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("queued chat follow-ups are durable FIFO and idempotent by message id", () => {
  const { createUser } = modules[0];
  const { createChat, getChat, removeQueuedMessage } = modules[1];
  const { queueChatFollowUp } = modules[2];

  const user = createUser("queue-owner", "test-password");
  const chat = createChat("Queue test", undefined, user.id);

  const first = queueChatFollowUp(chat.id, user.id, {
    id: "message-a",
    text: "first follow-up",
  });
  const second = queueChatFollowUp(chat.id, user.id, {
    id: "message-b",
    text: "second follow-up",
  });
  const retry = queueChatFollowUp(chat.id, user.id, {
    id: "message-b",
    text: "second follow-up",
  });

  assert.equal(first?.position, 1);
  assert.equal(second?.position, 2);
  assert.equal(retry?.duplicate, true);
  assert.equal(retry?.position, 2);
  assert.deepEqual(
    getChat(chat.id, user.id)?.queuedMessages?.map((item) => item.id),
    ["message-a", "message-b"],
  );

  removeQueuedMessage(chat.id, "message-a", user.id);
  assert.deepEqual(
    getChat(chat.id, user.id)?.queuedMessages?.map((item) => item.id),
    ["message-b"],
  );
});

test("queue writes respect chat ownership", () => {
  const { createUser } = modules[0];
  const { createChat, getChat } = modules[1];
  const { queueChatFollowUp } = modules[2];

  const owner = createUser("queue-owner-2", "test-password");
  const other = createUser("queue-other", "test-password");
  const chat = createChat("Private queue", undefined, owner.id);

  assert.equal(
    queueChatFollowUp(chat.id, other.id, { id: "forbidden", text: "nope" }),
    null,
  );
  assert.equal(getChat(chat.id, owner.id)?.queuedMessages?.length ?? 0, 0);
});
