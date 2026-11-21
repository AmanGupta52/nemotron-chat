// Local chat history: storage, migration, grouping, search and export.
// Everything here is browser-only. Image bytes are never written to storage.

export const HISTORY_KEY = "nemotron-workbench-history-v2";
export const LEGACY_HISTORY_KEY = "nemotron-workbench-history-v1";
export const ACTIVE_KEY = "nemotron-workbench-active-chat";
export const MAX_CHATS = 100;
export const MAX_MESSAGES = 200;

const LEGACY_IMAGE_NOTE = "[Image attachment was not saved with this conversation.]";

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw new Error("Secure random IDs are not available in this browser.");
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function titleFromText(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= 48) return clean;
  const cut = clean.slice(0, 48);
  const space = cut.lastIndexOf(" ");
  return `${space > 24 ? cut.slice(0, space) : cut}…`;
}

export function deriveTitle(messages) {
  const first = messages.find((m) => m.role === "user" && m.content?.trim());
  if (first) return titleFromText(first.content);
  if (messages.some((m) => m.imageDataUrl || m.hadImage)) return "Image conversation";
  return "New conversation";
}

function toTimestamp(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function cleanMessage(raw) {
  if (!raw || !["user", "assistant"].includes(raw.role) || typeof raw.content !== "string") return null;
  const message = {
    id: typeof raw.id === "string" ? raw.id : createId(),
    role: raw.role,
    content: raw.content,
  };
  if (raw.role === "user") {
    let { content } = message;
    let hadImage = Boolean(raw.hadImage);
    if (content.includes(LEGACY_IMAGE_NOTE)) {
      // Older versions stored this note inside the prompt text. Move it out so it is never sent to a model.
      content = content.replace(LEGACY_IMAGE_NOTE, "").trim();
      hadImage = true;
    }
    message.content = content;
    if (hadImage) message.hadImage = true;
    if (typeof raw.imageName === "string") message.imageName = raw.imageName;
    if (raw.attachment && typeof raw.attachment.url === "string" && typeof raw.attachment.publicId === "string") message.attachment = raw.attachment;
  } else {
    if (typeof raw.reasoning === "string" && raw.reasoning) message.reasoning = raw.reasoning;
    if (typeof raw.modelName === "string") message.modelName = raw.modelName;
    if (typeof raw.error === "string" && raw.error) message.error = raw.error;
    if (raw.partial) message.partial = true;
    if (raw.truncated) message.truncated = true;
  }
  return message;
}

function cleanChat(raw) {
  if (!raw || typeof raw.id !== "string" || !Array.isArray(raw.messages)) return null;
  const messages = raw.messages.map(cleanMessage).filter(Boolean).slice(-MAX_MESSAGES);
  if (!messages.length) return null;
  const updatedAt = toTimestamp(raw.updatedAt, Date.now());
  return {
    id: raw.id,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 120) : deriveTitle(messages),
    pinned: Boolean(raw.pinned),
    createdAt: toTimestamp(raw.createdAt, updatedAt),
    updatedAt,
    provider: raw.provider === "nvidia" ? "nvidia" : "openrouter",
    modelId: typeof raw.modelId === "string" ? raw.modelId : "",
    modelName: typeof raw.modelName === "string" ? raw.modelName : "",
    messages,
  };
}

function parseList(raw) {
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data.map(cleanChat).filter(Boolean) : [];
}

export function loadHistory() {
  try {
    const current = window.localStorage.getItem(HISTORY_KEY);
    if (current) return { chats: parseList(current).slice(0, MAX_CHATS), error: "" };
    const legacy = window.localStorage.getItem(LEGACY_HISTORY_KEY);
    if (legacy) return { chats: parseList(legacy).slice(0, MAX_CHATS), error: "" };
    return { chats: [], error: "" };
  } catch {
    return { chats: [], error: "Saved conversations could not be read from this browser." };
  }
}

function serializeMessage(message) {
  const { imageDataUrl, streaming, ...rest } = message;
  const saved = { ...rest };
  if (imageDataUrl) saved.hadImage = true;
  if (streaming) saved.partial = true;
  return saved;
}

export function serializeChats(chats) {
  return chats.slice(0, MAX_CHATS).map((chat) => ({
    ...chat,
    messages: chat.messages.slice(-MAX_MESSAGES).map(serializeMessage),
  }));
}

// Returns { error } where error is "" on success. If storage is full, the oldest unpinned chats are dropped.
export function saveHistory(chats) {
  let list = serializeChats(chats);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
      return { error: attempt ? "Storage was full, so the oldest conversations were not saved." : "" };
    } catch {
      let dropIndex = -1;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (!list[i].pinned) { dropIndex = i; break; }
      }
      if (dropIndex < 0) dropIndex = list.length - 1;
      if (dropIndex < 0) return { error: "Conversations could not be saved. Browser storage may be disabled." };
      list = list.filter((_, i) => i !== dropIndex);
    }
  }
  return { error: "Conversations could not be saved. Browser storage may be full." };
}

export function readActiveId() {
  try { return window.localStorage.getItem(ACTIVE_KEY) || null; } catch { return null; }
}

export function writeActiveId(id) {
  try {
    if (id) window.localStorage.setItem(ACTIVE_KEY, id);
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch { /* storage unavailable */ }
}

const GROUPS = ["Pinned", "Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

function bucket(timestamp, now = new Date()) {
  const date = new Date(timestamp);
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return "Older";
}

export function searchChats(chats, query) {
  const q = query.trim().toLowerCase();
  if (!q) return chats.map((chat) => ({ chat, snippet: "" }));
  const results = [];
  for (const chat of chats) {
    if (chat.title.toLowerCase().includes(q)) { results.push({ chat, snippet: "" }); continue; }
    for (const message of chat.messages) {
      const text = message.content || "";
      const at = text.toLowerCase().indexOf(q);
      if (at >= 0) {
        const start = Math.max(0, at - 24);
        const snippet = `${start > 0 ? "…" : ""}${text.slice(start, at + q.length + 48).replace(/\s+/g, " ")}`;
        results.push({ chat, snippet });
        break;
      }
    }
  }
  return results;
}

export function groupChats(entries) {
  const sorted = [...entries].sort((a, b) => b.chat.updatedAt - a.chat.updatedAt);
  const map = new Map(GROUPS.map((name) => [name, []]));
  for (const entry of sorted) map.get(entry.chat.pinned ? "Pinned" : bucket(entry.chat.updatedAt)).push(entry);
  return GROUPS.map((name) => ({ name, items: map.get(name) })).filter((group) => group.items.length);
}

export function formatTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function chatToMarkdown(chat) {
  const lines = [`# ${chat.title}`, "", `_Exported ${new Date().toLocaleString()}_`, ""];
  for (const message of chat.messages) {
    if (message.role === "user") {
      lines.push("## You", "", message.content || "", message.hadImage || message.imageName ? `\n_(image: ${message.imageName || "attached"})_` : "", "");
    } else {
      lines.push(`## ${message.modelName || "Assistant"}`, "", message.content || (message.error ? `_${message.error}_` : ""), "");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export async function downloadText(filename, text, type = "text/markdown") {
  if (globalThis.Capacitor?.isNativePlatform?.() && navigator.share) {
    try {
      await navigator.share({ title: filename, text });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return; // the user closed the share sheet
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFilename(title) {
  return (title || "conversation").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "conversation";
}
