import { randomUUID } from "node:crypto";
import { getDb } from "./lib/db.js";
import {
  HttpError,
  json,
  readJson,
  requireAuth,
  requireSameOrigin,
  withCors,
} from "./lib/security.js";
import {
  conversationOwnerFilter,
  messageOwnerFilter,
} from "./lib/validation.js";

const MAX_PAGE_SIZE = 100;
const MAX_IMPORT_MESSAGES = 200;
const MAX_MESSAGE_LENGTH = 16_000;

function errorResponse(error) {
  if (error instanceof HttpError) return json({ error: error.message, ...error.extra }, error.status);
  console.error("Conversation request failed.", error?.name || "Error");
  return json({ error: "The conversation service is temporarily unavailable." }, 500);
}

function parseDate(value, fallback) {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime()) || typeof parsed.id !== "string") return null;
    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function encodeCursor(message) {
  return Buffer.from(JSON.stringify({
    createdAt: message.createdAt.toISOString(),
    id: message._id,
  })).toString("base64url");
}

function publicMessage(message) {
  return {
    id: message._id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    metadata: message.metadata || {},
  };
}

function cleanImportedMessage(raw, index, baseTime) {
  if (!raw || !["user", "assistant"].includes(raw.role) || typeof raw.content !== "string") return null;
  const content = raw.content.slice(0, MAX_MESSAGE_LENGTH);
  if (raw.streaming || (raw.role === "assistant" && raw.error && !content)) return null;
  const rawTime = raw.createdAt ? new Date(raw.createdAt) : new Date(baseTime.getTime() + index);
  const metadata = {};
  if (raw.role === "user" && (raw.hadImage || raw.imageName)) {
    metadata.hadImage = true;
    if (typeof raw.imageName === "string") metadata.imageName = raw.imageName.slice(0, 160);
  }
  if (raw.role === "assistant") {
    for (const key of ["modelName", "reasoning", "error", "partial", "truncated"]) {
      if (typeof raw[key] === "string" || typeof raw[key] === "boolean") metadata[key] = raw[key];
    }
  }
  return {
    _id: randomUUID(),
    role: raw.role,
    content,
    createdAt: Number.isNaN(rawTime.getTime()) ? new Date(baseTime.getTime() + index) : rawTime,
    metadata,
  };
}

async function importConversation(db, user, raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !Array.isArray(raw.messages)) {
    throw new HttpError(400, "The selected local conversation is invalid.");
  }
  if (raw.messages.length > MAX_IMPORT_MESSAGES) {
    throw new HttpError(400, "A conversation contains too many messages to import.");
  }
  const sourceId = raw.id.slice(0, 80);
  const conversations = db.collection("conversations");
  const existing = await conversations.findOne({ userId: user._id, sourceId }, { projection: { _id: 1 } });
  if (existing) return json({ id: existing._id, alreadyImported: true });

  const createdAt = parseDate(raw.createdAt, new Date());
  const messages = raw.messages
    .map((message, index) => cleanImportedMessage(message, index, createdAt))
    .filter(Boolean);
  if (!messages.length) throw new HttpError(400, "This conversation has no messages to import.");
  const id = randomUUID();
  const last = messages[messages.length - 1];
  const conversation = {
    _id: id,
    userId: user._id,
    sourceId,
    title: (typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "Imported conversation").slice(0, 120),
    pinned: Boolean(raw.pinned),
    provider: raw.provider === "nvidia" ? "nvidia" : "openrouter",
    modelId: typeof raw.modelId === "string" ? raw.modelId.slice(0, 160) : "",
    modelName: typeof raw.modelName === "string" ? raw.modelName.slice(0, 120) : "",
    messageCount: messages.length,
    preview: last.content.slice(0, 240),
    createdAt,
    updatedAt: parseDate(raw.updatedAt, last.createdAt),
  };

  try {
    await conversations.insertOne(conversation);
    await db.collection("messages").insertMany(messages.map((message) => ({
      ...message,
      ...(message.role === "user" ? { clientMessageId: message._id } : {}),
      conversationId: id,
      userId: user._id,
    })));
  } catch (error) {
    await conversations.deleteOne({ _id: id, userId: user._id });
    await db.collection("messages").deleteMany(messageOwnerFilter(user._id, id));
    if (error?.code === 11000) {
      const imported = await conversations.findOne({ userId: user._id, sourceId }, { projection: { _id: 1 } });
      if (imported) return json({ id: imported._id, alreadyImported: true });
    }
    throw error;
  }
  return json({ id });
}

async function searchConversationIds(db, userId, term) {
  const conversations = db.collection("conversations");
  const messages = db.collection("messages");
  try {
    const [titleMatches, messageMatches] = await Promise.all([
      conversations.find(
        { userId, $text: { $search: term } },
        { projection: { _id: 1 } },
      ).limit(100).toArray(),
      messages.find(
        { userId, $text: { $search: term } },
        { projection: { conversationId: 1 } },
      ).limit(500).toArray(),
    ]);
    return [...new Set([
      ...titleMatches.map((item) => item._id),
      ...messageMatches.map((item) => item.conversationId),
    ])];
  } catch {
    throw new HttpError(400, "Search could not be processed. Try simpler keywords.");
  }
}

async function handler(req) {
  try {
    if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
      return json({ error: "Method not allowed." }, 405);
    }
    if (req.method !== "GET") requireSameOrigin(req);
    const { user } = await requireAuth(req);
    const db = await getDb();
    const url = new URL(req.url);
    const conversations = db.collection("conversations");
    const messages = db.collection("messages");

    if (req.method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) {
        const search = (url.searchParams.get("q") || "").trim().slice(0, 120);
        const filter = { userId: user._id };
        if (search) {
          const ids = await searchConversationIds(db, user._id, search);
          filter._id = { $in: ids };
        }
        // Paged so a client can load just the first few chats and ask for more later.
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 100));
        const skip = Math.min(5000, Math.max(0, Number(url.searchParams.get("skip")) || 0));
        const docs = await conversations.find(filter, { projection: { userId: 0 } })
          .sort({ pinned: -1, updatedAt: -1, _id: -1 }).skip(skip).limit(limit + 1).toArray();
        return json({
          conversations: docs.slice(0, limit).map(({ _id, ...conversation }) => ({ id: _id, ...conversation })),
          hasMore: docs.length > limit,
        });
      }

      const conversation = await conversations.findOne(conversationOwnerFilter(user._id, id), {
        projection: { userId: 0, sourceId: 0 },
      });
      if (!conversation) throw new HttpError(403, "You cannot access this conversation.");
      const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(url.searchParams.get("limit")) || 50));
      const cursor = decodeCursor(url.searchParams.get("before"));
      if (url.searchParams.has("before") && !cursor) throw new HttpError(400, "The message cursor is invalid.");
      const filter = messageOwnerFilter(user._id, id);
      if (cursor) {
        filter.$or = [
          { createdAt: { $lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
        ];
      }
      const page = await messages.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .toArray();
      const hasMore = page.length > limit;
      const selected = page.slice(0, limit).reverse();
      return json({
        conversation: { id: conversation._id, ...conversation },
        messages: selected.map(publicMessage),
        hasMore,
        nextCursor: hasMore && selected.length ? encodeCursor(selected[0]) : null,
      });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      if (body?.action !== "import") throw new HttpError(400, "Choose a valid conversation action.");
      return await importConversation(db, user, body.chat);
    }

    if (req.method === "PATCH") {
      const id = url.searchParams.get("id");
      if (!id) throw new HttpError(400, "Conversation ID is required.");
      const body = await readJson(req);
      const updates = { updatedAt: new Date() };
      if (body.title !== undefined) {
        if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 120) {
          throw new HttpError(400, "Conversation title must be between 1 and 120 characters.");
        }
        updates.title = body.title.trim();
      }
      if (body.pinned !== undefined) {
        if (typeof body.pinned !== "boolean") throw new HttpError(400, "Pinned must be true or false.");
        updates.pinned = body.pinned;
      }
      if (Object.keys(updates).length === 1) throw new HttpError(400, "No conversation changes were provided.");
      const result = await conversations.updateOne(conversationOwnerFilter(user._id, id), { $set: updates });
      if (!result.matchedCount) throw new HttpError(403, "You cannot access this conversation.");
      return json({ message: "Conversation updated." });
    }

    const id = url.searchParams.get("id");
    if (!id && url.searchParams.get("all") === "1") {
      await conversations.deleteMany({ userId: user._id });
      await messages.deleteMany({ userId: user._id });
      return json({ message: "All conversations deleted." });
    }
    if (!id) throw new HttpError(400, "Conversation ID is required.");
    const result = await conversations.deleteOne(conversationOwnerFilter(user._id, id));
    if (!result.deletedCount) throw new HttpError(403, "You cannot access this conversation.");
    await messages.deleteMany(messageOwnerFilter(user._id, id));
    return json({ message: "Conversation deleted." });
  } catch (error) {
    return errorResponse(error);
  }
}

export default withCors(handler);
