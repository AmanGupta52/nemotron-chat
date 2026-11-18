import { getFreeModels, getNvidiaModels } from "./lib/openrouter.js";
import { getDb } from "./lib/db.js";
import {
  HttpError,
  requireAuth,
  requireSameOrigin,
  isValidId,
  withCors,
} from "./lib/security.js";
import { conversationOwnerFilter, conversationTitle, messageOwnerFilter } from "./lib/validation.js";
import { splitThink } from "./lib/think.js";
import { randomUUID } from "node:crypto";

const ENDPOINTS = {
  nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};
const MAX_IMAGE_CHARS = 5_600_000;

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

function normalizeMessage(message, modelConfig) {
  if (!message || !["user", "assistant"].includes(message.role)) return null;
  const text = typeof message.content === "string" ? message.content.trim() : "";
  const image = typeof message.imageDataUrl === "string" ? message.imageDataUrl : "";

  if (text.length > 16_000) {
    throw new Error("A message is too long. Keep each message under 16,000 characters.");
  }
  if (image.length > MAX_IMAGE_CHARS) {
    throw new Error("Image is too large. Please use an image under 4 MB.");
  }
  if (image && (!modelConfig.vision || message.role !== "user")) {
    throw new Error("The selected model does not support image input. Choose a vision-capable model.");
  }
  if (image && !/^data:image\/(png|jpe?g|webp);base64,/i.test(image)) {
    throw new Error("Unsupported image. Use PNG, JPG, or WEBP.");
  }
  if (!text && !image) return null;

  if (image) {
    const content = [];
    if (text) content.push({ type: "text", text });
    content.push({ type: "image_url", image_url: { url: image } });
    return { role: message.role, content };
  }
  return { role: message.role, content: text };
}

function errorText(payload, fallback) {
  const upstreamError = payload?.error;
  return String(
    upstreamError?.message
      || payload?.message
      || (typeof upstreamError === "string" ? upstreamError : "")
      || fallback,
  ).slice(0, 1400);
}

function apiError(error) {
  if (error instanceof HttpError) return json({ error: error.message, ...error.extra }, error.status);
  console.error("Chat request failed.", error?.name || "Error");
  return json({ error: "The chat service is temporarily unavailable." }, 500);
}

async function saveUserMessage(db, user, conversationId, messageId, message, provider, modelConfig) {
  const conversations = db.collection("conversations");
  const storedMessages = db.collection("messages");
  const ownerFilter = conversationOwnerFilter(user._id, conversationId);
  const now = new Date();
  let createdConversation = false;
  const content = typeof message.content === "string" ? message.content.trim() : "";
  const metadata = {};
  if (message.imageDataUrl) {
    metadata.hadImage = true;
    if (typeof message.imageName === "string") metadata.imageName = message.imageName.slice(0, 160);
  }

  let conversation = await conversations.findOne(ownerFilter);
  if (!conversation) {
    if (await conversations.findOne({ _id: conversationId }, { projection: { _id: 1 } })) {
      throw new HttpError(403, "You cannot access this conversation.");
    }
    conversation = {
      _id: conversationId,
      userId: user._id,
      title: conversationTitle(content),
      pinned: false,
      provider,
      modelId: modelConfig.id,
      modelName: modelConfig.name,
      messageCount: 0,
      preview: content.slice(0, 240) || (metadata.hadImage ? "Image attachment" : ""),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await conversations.insertOne(conversation);
      createdConversation = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      conversation = await conversations.findOne(ownerFilter);
      if (!conversation) throw new HttpError(403, "You cannot access this conversation.");
    }
  }

  const existing = await storedMessages.findOne({
    ...messageOwnerFilter(user._id, conversationId),
    clientMessageId: messageId,
  });
  let inserted = false;
  if (existing) {
    if (existing.role !== "user") throw new HttpError(409, "This message cannot be updated.");
    await storedMessages.updateOne(
      { _id: existing._id, ...messageOwnerFilter(user._id, conversationId) },
      { $set: { content, metadata, editedAt: now } },
    );
  } else {
    try {
      await storedMessages.insertOne({
        _id: messageId,
        clientMessageId: messageId,
        conversationId,
        userId: user._id,
        role: "user",
        content,
        metadata,
        createdAt: now,
      });
      inserted = true;
    } catch (error) {
      if (error?.code !== 11000) {
        if (createdConversation) await conversations.deleteOne(ownerFilter);
        throw error;
      }
      const duplicate = await storedMessages.findOne({
        ...messageOwnerFilter(user._id, conversationId),
        clientMessageId: messageId,
      });
      if (!duplicate || duplicate.role !== "user" || duplicate.content !== content) {
        if (createdConversation) await conversations.deleteOne(ownerFilter);
        throw new HttpError(409, "This message was already submitted with different content.");
      }
    }
  }

  const isFirstMessage = conversation.messageCount === 0;
  await conversations.updateOne(ownerFilter, {
    $set: {
      ...(isFirstMessage ? { title: conversationTitle(content) } : {}),
      provider,
      modelId: modelConfig.id,
      modelName: modelConfig.name,
      preview: content.slice(0, 240) || (metadata.hadImage ? "Image attachment" : ""),
      updatedAt: now,
    },
    ...(inserted ? { $inc: { messageCount: 1 } } : {}),
  });
}

async function saveAssistantMessage(db, user, options) {
  const {
    conversationId, messageId, currentUserMessageId, discardMessageIds, content, reasoning,
    provider, modelConfig, responseTimeMs, requestId, finishReason,
  } = options;
  if (!content.trim()) return;
  const ownerFilter = conversationOwnerFilter(user._id, conversationId);
  if (!await db.collection("conversations").findOne(ownerFilter, { projection: { _id: 1 } })) {
    throw new Error("Conversation is no longer available.");
  }

  const metadata = { modelName: modelConfig.name, provider, responseTimeMs };
  if (reasoning) metadata.reasoning = reasoning;
  if (requestId) metadata.requestId = requestId;
  if (finishReason) metadata.finishReason = finishReason;
  await db.collection("messages").insertOne({
    _id: messageId,
    conversationId,
    userId: user._id,
    role: "assistant",
    content,
    metadata,
    createdAt: new Date(),
  });

  const discardIds = Array.isArray(discardMessageIds)
    ? [...new Set(discardMessageIds.slice(0, 100).filter((id) => isValidId(id) && id !== messageId && id !== currentUserMessageId))]
    : [];
  const removed = discardIds.length
    ? await db.collection("messages").deleteMany({
      _id: { $in: discardIds },
      ...messageOwnerFilter(user._id, conversationId),
    })
    : { deletedCount: 0 };
  const now = new Date();
  await db.collection("conversations").updateOne(ownerFilter, {
    $set: {
      provider,
      modelId: modelConfig.id,
      modelName: modelConfig.name,
      preview: content.slice(0, 240),
      updatedAt: now,
    },
    $inc: { messageCount: 1 - removed.deletedCount },
  });
}

function persistedSseStream(upstream, {
  req, controller, timeoutId, abortOnDisconnect, db, user, conversationId, userMessageId,
  assistantMessageId, discardMessageIds, provider, modelConfig, startedAt,
}) {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let answer = "";
  let reasoning = "";
  let requestId = "";
  let finishReason = "";
  let providerFailed = false;
  let completed = false;

  const cleanup = () => {
    clearTimeout(timeoutId);
    req.signal?.removeEventListener("abort", abortOnDisconnect);
  };

  return new ReadableStream({
    async start(output) {
      const processFrame = async (frame) => {
        const data = frame.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data === "[DONE]") {
          if (!providerFailed) {
            try {
              const split = splitThink(answer);
              await saveAssistantMessage(db, user, {
                conversationId,
                messageId: assistantMessageId,
                currentUserMessageId: userMessageId,
                discardMessageIds,
                content: split.answer,
                reasoning: [reasoning, split.think].filter(Boolean).join("\n\n"),
                provider,
                modelConfig,
                responseTimeMs: Date.now() - startedAt,
                requestId,
                finishReason,
              });
            } catch {
              const errorEvent = `data: ${JSON.stringify({ error: { message: "The response could not be saved to chat history." } })}\n\n`;
              output.enqueue(encoder.encode(errorEvent));
            }
          }
          completed = true;
          output.enqueue(encoder.encode(`${frame}\n\n`));
          output.close();
          return true;
        }
        if (data) {
          try {
            const event = JSON.parse(data);
            if (event.error) providerFailed = true;
            if (typeof event.id === "string") requestId = event.id.slice(0, 200);
            const delta = event.error ? null : readProviderDelta(event);
            if (delta) {
              answer += delta.content;
              reasoning += delta.reasoning;
              if (delta.finish) finishReason = delta.finish;
            }
          } catch {
            providerFailed = true;
          }
        }
        output.enqueue(encoder.encode(`${frame}\n\n`));
        return false;
      };

      try {
        while (!completed) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
          const chunks = buffer.split(/\r?\n\r?\n/);
          if (done) {
            buffer = "";
            if (chunks.length && chunks[chunks.length - 1]) {
              const finalFrame = chunks.pop();
              if (finalFrame) chunks.push(finalFrame);
            }
          } else {
            buffer = chunks.pop() || "";
          }
          for (const chunk of chunks) {
            if (await processFrame(chunk)) break;
          }
          if (done) {
            if (!completed) output.close();
            break;
          }
        }
      } catch {
        try {
          if (!controller.signal.aborted) {
            output.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: "The AI stream ended before it could be saved." } })}\n\n`));
          }
          output.close();
        } catch { /* The client disconnected while the stream was closing. */ }
      } finally {
        cleanup();
        try { reader.releaseLock(); } catch { /* already released */ }
      }
    },
    async cancel() {
      controller.abort();
      cleanup();
      try { await reader.cancel(); } catch { /* upstream already ended */ }
    },
  });
}

function readProviderDelta(event) {
  const choice = event?.choices?.[0];
  const delta = choice?.delta || {};
  const textOf = (value) => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
    return "";
  };
  return {
    content: textOf(delta.content),
    reasoning: textOf(delta.reasoning_content ?? delta.reasoning),
    finish: choice?.finish_reason || "",
  };
}

async function handler(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed. Use POST." }, 405);

  let auth;
  try {
    requireSameOrigin(req);
    auth = await requireAuth(req);
  } catch (error) {
    return apiError(error);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return json({ error: "Send at least one chat message." }, 400);
  }
  if (!["nvidia", "openrouter"].includes(body.provider)) {
    return json({ error: "Choose NVIDIA or OpenRouter." }, 400);
  }
  if (typeof body.model !== "string" || !body.model) {
    return json({ error: "Choose a model before sending a message." }, 400);
  }

  const apiKey = body.provider === "nvidia"
    ? process.env.NVIDIA_API_KEY
    : process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const keyName = body.provider === "nvidia" ? "NVIDIA_API_KEY" : "OPENROUTER_API_KEY";
    return json({
      error: `${keyName} is missing.`,
      detail: `Add ${keyName} to your root .env file or Netlify environment variables.`,
    }, 500);
  }

  let modelConfig;
  if (body.provider === "nvidia") {
    modelConfig = (await getNvidiaModels()).find((model) => model.id === body.model);
  } else {
    try {
      const freeModels = await getFreeModels();
      modelConfig = freeModels.find((model) => model.id === body.model);
    } catch (error) {
      return json({
        error: "Could not verify that this model is free on OpenRouter.",
        detail: error?.message || "Model catalog request failed.",
      }, 502);
    }
  }
  if (!modelConfig) {
    return json({
      error: body.provider === "openrouter"
        ? "This model is no longer available as a free OpenRouter model."
        : "This model is not enabled for NVIDIA.",
      detail: "Refresh the model list and select an available model.",
    }, 400);
  }

  let messages;
  try {
    const recent = body.messages.slice(-20);
    const totalImageChars = recent.reduce(
      (sum, message) => sum + (typeof message?.imageDataUrl === "string" ? message.imageDataUrl.length : 0),
      0,
    );
    if (totalImageChars > 8_000_000) {
      throw new Error("This conversation has too many large images. Start a new chat or use smaller images.");
    }
    messages = recent.map((message) => normalizeMessage(message, modelConfig)).filter(Boolean);
  } catch (error) {
    return json({ error: error.message }, 400);
  }
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return json({ error: "The last chat message must be from the user." }, 400);
  }

  const userMessage = body.messages[body.messages.length - 1];
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  const userMessageId = typeof body.userMessageId === "string" ? body.userMessageId : "";
  const assistantMessageId = typeof body.assistantMessageId === "string" ? body.assistantMessageId : randomUUID();
  if (!isValidId(conversationId) || !isValidId(userMessageId) || !isValidId(assistantMessageId)) {
    return json({ error: "Invalid conversation or response identifier." }, 400);
  }
  const persistUser = body.persistUser !== false;

  let db;
  try {
    db = await getDb();
    if (persistUser) {
      await saveUserMessage(db, auth.user, conversationId, userMessageId, userMessage, body.provider, modelConfig);
    } else {
      if (!await db.collection("conversations").findOne(conversationOwnerFilter(auth.user._id, conversationId), { projection: { _id: 1 } })) {
        return json({ error: "You cannot access this conversation." }, 403);
      }
      const priorMessage = await db.collection("messages").findOne({
        ...messageOwnerFilter(auth.user._id, conversationId),
        clientMessageId: userMessageId,
        role: "user",
      });
      if (!priorMessage || priorMessage.content !== (userMessage.content || "").trim()) {
        return json({ error: "The query must match a saved message in this conversation." }, 400);
      }
    }
  } catch (error) {
    return apiError(error);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);
  const abortOnDisconnect = () => controller.abort();
  req.signal?.addEventListener("abort", abortOnDisconnect, { once: true });

  try {
    const startedAt = Date.now();
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    };
    if (body.provider === "openrouter") {
      const siteUrl = process.env.OPENROUTER_SITE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL;
      const appName = process.env.OPENROUTER_APP_NAME || "Nemotron Workbench";
      if (siteUrl) headers["HTTP-Referer"] = siteUrl;
      if (appName) headers["X-OpenRouter-Title"] = appName;
    }

    const payload = {
      model: modelConfig.id,
      messages: [
        {
          role: "system",
          content: "You are a helpful, accurate, friendly AI assistant. Answer clearly, explain your reasoning when useful, and use Markdown when it improves readability. If you are unsure, say so.",
        },
        ...messages,
      ],
      temperature: 0.6,
      max_tokens: 4096,
      stream: true,
    };
    if (body.provider === "openrouter") {
      payload.provider = {
        allow_fallbacks: false,
        max_price: { prompt: 0, completion: 0 },
      };
    }

    const upstream = await fetch(ENDPOINTS[body.provider], {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const raw = await upstream.text();
      let data;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { message: raw.slice(0, 1200) };
      }
      const rateLimited = upstream.status === 429;
      const message = errorText(data, `${body.provider} returned HTTP ${upstream.status}.`);
      clearTimeout(timeoutId);
      req.signal?.removeEventListener("abort", abortOnDisconnect);
      return json({
        error: rateLimited
          ? "The selected provider is rate-limited."
          : `${body.provider === "nvidia" ? "NVIDIA" : "OpenRouter"} API request failed.`,
        detail: message,
        status: upstream.status,
        model: modelConfig.id,
      }, rateLimited ? 429 : 502);
    }
    if (!upstream.body) {
      clearTimeout(timeoutId);
      req.signal?.removeEventListener("abort", abortOnDisconnect);
      return json({ error: "The provider did not return a streaming response." }, 502);
    }

    const stream = persistedSseStream(upstream.body, {
      req,
      controller,
      timeoutId,
      abortOnDisconnect,
      db,
      user: auth.user,
      conversationId,
      userMessageId,
      assistantMessageId,
      discardMessageIds: body.discardMessageIds,
      provider: body.provider,
      modelConfig,
      startedAt,
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Conversation-Id": conversationId,
      },
    });
  } catch (error) {
    clearTimeout(timeoutId);
    req.signal?.removeEventListener("abort", abortOnDisconnect);
    const timedOut = error?.name === "AbortError";
    return json({
      error: timedOut ? "The AI request timed out. Please try again." : "Could not connect to the selected provider.",
      detail: timedOut ? "The request exceeded 90 seconds." : (error?.message || "Network error"),
    }, 502);
  }
}

export default withCors(handler);
