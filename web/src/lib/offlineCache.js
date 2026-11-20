// Offline cache: keeps your account summary, the latest conversations and the messages of recently opened
// chats on this device, so the app can open instantly and still show your chats without a connection.
// Everything is removed on sign-out. Images are never cached (only text) to stay well under storage limits.

const PREFIX = "nw:";
const MAX_CHATS_WITH_MESSAGES = 12;
const MAX_MESSAGES_PER_CHAT = 60;

function read(key) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function write(key, value) {
  try { window.localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
}
function remove(key) {
  try { window.localStorage.removeItem(PREFIX + key); } catch { /* storage unavailable */ }
}

export const cacheUser = (user) => { if (user) write("user", user); };
export const getCachedUser = () => read("user");

export const cacheList = (list) => {
  write("list", list.map(({ messages: _messages, ...summary }) => ({ ...summary, loaded: false })));
};
export const getCachedList = () => (Array.isArray(read("list")) ? read("list") : []);

export function cacheMessages(id, messages) {
  if (!id || !Array.isArray(messages) || !messages.length) return;
  const slim = messages
    .filter((message) => !message.pending)
    .slice(-MAX_MESSAGES_PER_CHAT)
    .map(({ imageDataUrl: _image, ...message }) => message);
  if (!slim.length) return;

  let index = (read("msg-index") || []).filter((item) => item !== id);
  index.push(id); // most recently used last
  while (index.length > MAX_CHATS_WITH_MESSAGES) remove(`msg:${index.shift()}`);

  if (!write(`msg:${id}`, { savedAt: Date.now(), messages: slim })) {
    // Storage is full: drop the oldest cached chats and try once more.
    while (index.length > 1 && !write(`msg:${id}`, { savedAt: Date.now(), messages: slim })) remove(`msg:${index.shift()}`);
  }
  write("msg-index", index);
}
export const getCachedMessages = (id) => read(`msg:${id}`)?.messages || null;

export function clearCache() {
  try {
    const storage = window.localStorage;
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch { /* storage unavailable */ }
}
