import { getDatabase } from "@/lib/sqlite";
import type { Chat, ChatMessage } from "@/lib/store";
import { compactMessagePartsForPersistence, persistToolsForMessage } from "@/lib/tool-persistence";

const db = getDatabase();
const rows = db.prepare("SELECT id, data FROM chats ORDER BY created_at ASC").all() as Array<{ id: string; data: string }>;
const update = db.prepare("UPDATE chats SET data = ? WHERE id = ?");
let chatsChanged = 0;
let messagesChanged = 0;
let snapshotsMoved = 0;
let bytesBefore = 0;
let bytesAfter = 0;

for (const row of rows) {
  bytesBefore += Buffer.byteLength(row.data, "utf8");
  let chat: Chat;
  try {
    chat = JSON.parse(row.data) as Chat;
  } catch {
    bytesAfter += Buffer.byteLength(row.data, "utf8");
    continue;
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    let changed = false;
    const messages = chat.messages.map((message): ChatMessage => {
      let next = message;
      if (message.tools?.length) {
        snapshotsMoved += message.tools.filter((tool) =>
          tool.kind === "edit" && Boolean(tool.diff) &&
          (typeof tool.diff?.before === "string" || typeof tool.diff?.after === "string"),
        ).length;
        const compactTools = persistToolsForMessage(chat.id, message.id, message.tools);
        if (JSON.stringify(compactTools) !== JSON.stringify(message.tools)) {
          next = { ...next, tools: compactTools };
          changed = true;
        }
      }
      if (message.parts?.length) {
        const compactParts = compactMessagePartsForPersistence(message.parts);
        if (JSON.stringify(compactParts) !== JSON.stringify(message.parts)) {
          next = { ...next, parts: compactParts };
          changed = true;
        }
      }
      if (next !== message) messagesChanged += 1;
      return next;
    });
    if (changed) {
      chat = { ...chat, messages };
      const encoded = JSON.stringify(chat);
      update.run(encoded, row.id);
      chatsChanged += 1;
      bytesAfter += Buffer.byteLength(encoded, "utf8");
    } else {
      bytesAfter += Buffer.byteLength(row.data, "utf8");
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

console.log(JSON.stringify({
  chatsChanged,
  messagesChanged,
  snapshotsMoved,
  bytesBefore,
  bytesAfter,
  savedBytes: bytesBefore - bytesAfter,
}, null, 2));
