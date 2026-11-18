import dns from "node:dns";
import { MongoClient } from "mongodb";

const STATE_KEY = Symbol.for("nemotron-workbench.mongodb");

function useDnsServers(list) {
  const servers = list.split(",").map((item) => item.trim()).filter(Boolean);
  if (servers.length) dns.setServers(servers);
}

async function connect(uri) {
  const client = new MongoClient(uri, {
    appName: "Nemotron Workbench",
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 8000,
  });
  await client.connect();
  return client;
}

async function connectWithDnsFallback(uri) {
  if (process.env.MONGODB_DNS_SERVERS) useDnsServers(process.env.MONGODB_DNS_SERVERS);
  try {
    return await connect(uri);
  } catch (error) {
    // "querySrv ECONNREFUSED" means the local resolver refuses SRV lookups (mongodb+srv:// URIs).
    // Retry once with public DNS servers before giving up.
    const message = String(error?.message || "");
    if (uri.startsWith("mongodb+srv://") && /querySrv/.test(message) && /ECONNREFUSED|ETIMEOUT|ENOTFOUND/.test(message)) {
      useDnsServers("8.8.8.8,1.1.1.1");
      return connect(uri);
    }
    throw error;
  }
}

export async function getDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured.");

  const state = globalThis[STATE_KEY] || (globalThis[STATE_KEY] = {});
  if (!state.clientPromise) {
    state.clientPromise = connectWithDnsFallback(uri).catch((error) => {
      state.clientPromise = null; // do not cache a failed connection for the life of the instance
      throw error;
    });
  }

  const client = await state.clientPromise;
  const db = client.db(process.env.MONGODB_DB || undefined);
  if (!state.indexesPromise) {
    state.indexesPromise = Promise.all([
      db.collection("users").createIndex({ email: 1 }, { unique: true, name: "users_email_unique" }),
      db.collection("users").createIndex({ username: 1 }, { unique: true, name: "users_username_unique" }),
      db.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true, name: "sessions_token_unique" }),
      db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "sessions_expiry" }),
      db.collection("loginAttempts").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "login_attempts_expiry" }),
      db.collection("authRateLimits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "auth_rate_limits_expiry" }),
      db.collection("challenges").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "challenges_expiry" }),
      db.collection("conversations").createIndex({ userId: 1, updatedAt: -1 }, { name: "conversations_owner_recent" }),
      db.collection("conversations").createIndex({ userId: 1, title: "text" }, { name: "conversations_owner_title_text" }),
      db.collection("conversations").createIndex(
        { userId: 1, sourceId: 1 },
        { unique: true, partialFilterExpression: { sourceId: { $type: "string" } }, name: "conversations_owner_import_source" },
      ),
      db.collection("messages").createIndex(
        { userId: 1, conversationId: 1, createdAt: -1, _id: -1 },
        { name: "messages_owner_conversation_recent" },
      ),
      db.collection("messages").createIndex(
        { userId: 1, conversationId: 1, clientMessageId: 1 },
        { unique: true, partialFilterExpression: { clientMessageId: { $type: "string" } }, name: "messages_client_id_unique" },
      ),
      db.collection("messages").createIndex({ userId: 1, content: "text" }, { name: "messages_owner_content_text" }),
    ]).catch((error) => {
      state.indexesPromise = null; // retry index creation on the next request
      throw error;
    });
  }
  await state.indexesPromise;
  return db;
}
