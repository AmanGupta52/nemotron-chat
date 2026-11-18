import { HttpError } from "./security.js";

export function normalizeEmail(value) {
  if (typeof value !== "string") throw new HttpError(400, "Enter a valid email address.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  return email;
}

export function validateRegistration(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  if (name.length < 1 || name.length > 100) throw new HttpError(400, "Name must be between 1 and 100 characters.");
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new HttpError(400, "Username must be 3–32 characters using letters, numbers, dots, underscores, or hyphens.");
  }
  return { name, username, email: normalizeEmail(body?.email) };
}

export function validateProfileName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1 || name.length > 100) throw new HttpError(400, "Name must be between 1 and 100 characters.");
  return name;
}

export function conversationTitle(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  if (clean.length <= 48) return clean;
  const prefix = clean.slice(0, 48);
  const space = prefix.lastIndexOf(" ");
  return `${space > 24 ? prefix.slice(0, space) : prefix}…`;
}

export function conversationOwnerFilter(userId, conversationId) {
  return { _id: conversationId, userId };
}

export function messageOwnerFilter(userId, conversationId) {
  return { userId, conversationId };
}
