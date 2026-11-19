import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Menu, Monitor, Moon, PanelLeftOpen, Plus, Sun, X } from "lucide-react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Composer from "./components/Composer.jsx";
import Message from "./components/Message.jsx";
import BentoWelcome from "./components/BentoWelcome.jsx";
import ModelPicker from "./components/ModelPicker.jsx";
import Sidebar from "./components/Sidebar.jsx";
import {
  chatToMarkdown, createId, deriveTitle, downloadText, loadHistory, readActiveId,
  safeFilename, titleFromText, writeActiveId,
} from "./lib/history.js";
import { prepareImage } from "./lib/image.js";
import { readDelta, readEvents } from "./lib/stream.js";
import { splitThink } from "./lib/think.js";
import { useAuth } from "./auth/AuthContext.jsx";
import { ACCOUNT_API, apiFetch, apiRequest, CHAT_API, CONVERSATIONS_API, MODELS_API } from "./auth/api.js";
import {
  ForgotPasswordPage, LoginPage, ProfilePage, RegisterPage, ResetPasswordPage,
  SettingsPage, VerifyEmailPage,
} from "./pages/AccountPages.jsx";

const MODEL_KEY = "nemotron-workbench-model";
const THEME_KEY = "nemotron-workbench-theme";
const SIDEBAR_KEY = "nemotron-workbench-sidebar-collapsed";
const REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_MODELS = {
  nvidia: "nvidia/nemotron-3.5-lightning-30b-a3b",
  openrouter: "nvidia/nemotron-3.5-lightning:free",
};
const EMPTY_PROVIDERS = {
  nvidia: { models: [], configured: null, error: "" },
  openrouter: { models: [], configured: null, error: "" },
};
const NO_MESSAGES = [];
const SERVICE_MISSING = "The API wasn't found. Start the backend (`npm run dev` in /backend) or set VITE_API_BASE_URL to your deployed API.";

const readStore = (key) => { try { return window.localStorage.getItem(key); } catch { return null; } };
const writeStore = (key, value) => { try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

function timestamp(value) {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function mapConversation(raw) {
  return {
    ...raw,
    id: raw.id,
    createdAt: timestamp(raw.createdAt),
    updatedAt: timestamp(raw.updatedAt),
    loaded: false,
    messages: [],
  };
}

function mapMessage(raw) {
  const metadata = raw.metadata || {};
  return {
    id: raw.id,
    role: raw.role,
    content: raw.content || "",
    createdAt: timestamp(raw.createdAt),
    ...(metadata.modelName ? { modelName: metadata.modelName } : {}),
    ...(metadata.reasoning ? { reasoning: metadata.reasoning } : {}),
    ...(metadata.error ? { error: metadata.error } : {}),
    ...(metadata.partial ? { partial: true } : {}),
    ...(metadata.truncated ? { truncated: true } : {}),
    ...(metadata.hadImage ? { hadImage: true, imageName: metadata.imageName } : {}),
  };
}

function readSavedSelection() {
  try {
    const saved = JSON.parse(readStore(MODEL_KEY) || "null");
    if (saved && (saved.provider === "nvidia" || saved.provider === "openrouter") && typeof saved.modelId === "string") return saved;
  } catch { /* ignore */ }
  return null;
}

function pickDefault(providers, selection) {
  const has = (key) => providers[key].models.length > 0;
  let provider = selection.provider;
  if (!selection.modelId) {
    if (providers.nvidia.configured && has("nvidia")) provider = "nvidia";
    else if (has("openrouter")) provider = "openrouter";
    else if (has("nvidia")) provider = "nvidia";
  }
  const list = providers[provider].models;
  if (!list.length) return null;
  const model = list.find((m) => m.id === DEFAULT_MODELS[provider])
    || (provider === "openrouter" && list.find((m) => m.id === "openrouter/free"))
    || list[0];
  return { provider, modelId: model.id };
}

// Turns the stored conversation into what the server accepts: no failed turns, think-tags removed,
// images only for vision models (newest three), and sizes within the server limits.
function buildPayload(messages, model) {
  const recent = messages.slice(-20);
  let imagesLeft = 3;
  const out = [];
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const m = recent[i];
    if (m.streaming || m.error) continue;
    let text = m.role === "assistant" ? splitThink(m.content).answer : (m.content || "").trim();
    text = text.slice(0, 15_900);
    let image = "";
    if (m.role === "user" && m.imageDataUrl) {
      if (model.vision && imagesLeft > 0) { image = m.imageDataUrl; imagesLeft -= 1; }
      else text = `${text ? `${text}\n\n` : ""}[An image was attached here, but it is not available to this model.]`;
    } else if (m.role === "user" && m.hadImage) {
      text = `${text ? `${text}\n\n` : ""}[An image was attached here, but it is no longer available.]`;
    }
    if (!text && !image) continue;
    out.push({ role: m.role, content: text, ...(image ? { imageDataUrl: image, imageName: m.imageName } : {}) });
  }
  out.reverse();
  while (out.length && out[0].role !== "user") out.shift();
  const merged = [];
  for (const m of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role && !prev.imageDataUrl && !m.imageDataUrl) prev.content = `${prev.content}\n\n${m.content}`.slice(0, 15_900);
    else merged.push({ ...m });
  }
  return merged;
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = readStore(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", theme);
    writeStore(THEME_KEY, theme);
    const dark = theme === "dark" || (theme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b0e13" : "#f6f7f9");
  }, [theme]);
  const cycle = () => setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"));
  return [theme, cycle, setTheme];
}

function Workbench() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [initial] = useState(() => {
    const saved = readSavedSelection();
    return {
      selection: saved || { provider: "openrouter", modelId: "" },
      activeId: readActiveId(),
    };
  });

  const [chats, setChats] = useState([]);
  const [conversationList, setConversationList] = useState([]);
  const [activeId, setActiveId] = useState(initial.activeId);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [messagePage, setMessagePage] = useState({ hasMore: false, nextCursor: null });
  const [chatLoading, setChatLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [localChats, setLocalChats] = useState(() => loadHistory().chats);
  const [selection, setSelection] = useState(initial.selection);
  const [providers, setProviders] = useState(EMPTY_PROVIDERS);
  const [catalogReady, setCatalogReady] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState(null);
  const [busyChatId, setBusyChatId] = useState(null);
  const [banner, setBanner] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readStore(SIDEBAR_KEY) === "1");
  const [dragActive, setDragActive] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [theme, cycleTheme, setTheme] = useTheme();

  const busyRef = useRef(null);
  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const dragDepth = useRef(0);
  const firstListLoadRef = useRef(true);
  const listRequestRef = useRef(0);
  const conversationRequestRef = useRef(0);

  const activeChat = useMemo(() => chats.find((c) => c.id === activeId) || null, [chats, activeId]);
  const messages = activeChat?.messages || NO_MESSAGES;
  const activeProvider = providers[selection.provider] || EMPTY_PROVIDERS.nvidia;
  const selectedModel = activeProvider.models.find((m) => m.id === selection.modelId) || null;
  const keyMissing = activeProvider.configured === false;
  const busy = busyChatId !== null;

  const flash = useCallback((text, kind = "error") => setBanner({ text, kind, id: Date.now() }), []);

  const loadConversation = useCallback(async (id, { before = "", append = false } = {}) => {
    const requestId = ++conversationRequestRef.current;
    if (append) setLoadingOlder(true);
    else setChatLoading(true);
    try {
      const params = new URLSearchParams({ id, limit: "50" });
      if (before) params.set("before", before);
      const data = await apiRequest(`${CONVERSATIONS_API}?${params.toString()}`);
      if (requestId !== conversationRequestRef.current) return;
      const conversation = mapConversation(data.conversation);
      conversation.loaded = true;
      const incoming = data.messages.map(mapMessage);
      setChats((current) => {
        const previous = current.find((chat) => chat.id === id);
        const existingMessages = previous?.messages || [];
        conversation.messages = append
          ? [...incoming, ...existingMessages]
          : incoming;
        return [conversation, ...current.filter((chat) => chat.id !== id)];
      });
      setConversationList((current) => current.map((chat) => (
        chat.id === id ? { ...conversation, messages: [] } : chat
      )));
      setMessagePage({ hasMore: data.hasMore, nextCursor: data.nextCursor });
      setHistoryError("");
    } catch (error) {
      if (error.status === 401) {
        navigate("/login", { replace: true });
      } else {
        setHistoryError(error.message || "Could not load this conversation.");
      }
    } finally {
      if (requestId === conversationRequestRef.current) {
        setChatLoading(false);
        setLoadingOlder(false);
      }
    }
  }, [navigate]);

  const loadConversationList = useCallback(async (query = "") => {
    const requestId = ++listRequestRef.current;
    setHistoryLoading(true);
    try {
      const data = await apiRequest(`${CONVERSATIONS_API}?q=${encodeURIComponent(query)}`);
      if (requestId !== listRequestRef.current) return;
      const list = (data.conversations || []).map(mapConversation);
      setConversationList(list);
      setChats((current) => {
        const details = new Map(current.filter((chat) => chat.loaded).map((chat) => [chat.id, chat]));
        const listed = new Set(list.map((chat) => chat.id));
        return [
          ...list.map((summary) => details.get(summary.id) || summary),
          ...[...details.values()].filter((chat) => !listed.has(chat.id)),
        ];
      });
      setHistoryError("");
      if (firstListLoadRef.current) {
        firstListLoadRef.current = false;
        const savedId = readActiveId();
        const selected = list.find((chat) => chat.id === savedId || chat.sourceId === savedId);
        if (selected) {
          setActiveId(selected.id);
          loadConversation(selected.id);
        } else {
          setActiveId(null);
        }
      }
    } catch (error) {
      if (error.status === 401) navigate("/login", { replace: true });
      else setHistoryError(error.message || "Could not load your conversations.");
    } finally {
      if (requestId === listRequestRef.current) setHistoryLoading(false);
    }
  }, [loadConversation, navigate]);

  useEffect(() => { loadConversationList(""); }, [loadConversationList]);

  // ---------- model catalog ----------
  const loadModels = useCallback(async (refresh = false) => {
    setModelsLoading(true);
    try {
      const response = await apiFetch(`${MODELS_API}${refresh ? "?refresh=1" : ""}`, { headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 404 && !data.error) throw new Error(SERVICE_MISSING);
        throw new Error([data.error, data.detail].filter(Boolean).join(" — ") || `Request failed (${response.status}).`);
      }
      const catalog = data.providers || {};
      const list = (value) => (Array.isArray(value) ? value : []);
      setProviders({
        nvidia: { models: list(catalog.nvidia?.models), configured: Boolean(catalog.nvidia?.configured), error: "" },
        openrouter: {
          models: list(catalog.openrouter?.models).filter((m) => !/gemini/i.test(`${m.id} ${m.name}`)),
          configured: Boolean(catalog.openrouter?.configured),
          error: catalog.openrouter?.error || "",
        },
      });
      setCatalogReady(true);
    } catch (error) {
      const message = error?.message || "Could not load models.";
      setProviders((cur) => ({ nvidia: { ...cur.nvidia, error: message }, openrouter: { ...cur.openrouter, error: message } }));
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels(false);
    const timer = window.setInterval(() => loadModels(false), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadModels]);

  // Keep the selection valid as the catalog changes.
  useEffect(() => {
    if (!catalogReady) return;
    const list = providers[selection.provider].models;
    if (selection.modelId && list.some((m) => m.id === selection.modelId)) return;
    if (selection.modelId && !list.length) return; // provider list unavailable: keep the preference
    const next = pickDefault(providers, selection);
    if (!next) return;
    if (selection.modelId) {
      const name = list.find((m) => m.id === next.modelId)?.name || next.modelId;
      flash(`The previous model is no longer available. Switched to ${name}.`, "info");
    }
    setSelection(next);
  }, [catalogReady, providers, selection, flash]);

  useEffect(() => {
    if (selection.modelId) writeStore(MODEL_KEY, JSON.stringify(selection));
  }, [selection]);

  useEffect(() => { writeActiveId(activeId); }, [activeId]);
  useEffect(() => {
    if (user?.preferences?.theme) setTheme(user.preferences.theme);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const applyTheme = (event) => setTheme(event.detail);
    window.addEventListener("workbench-theme", applyTheme);
    return () => window.removeEventListener("workbench-theme", applyTheme);
  }, [setTheme]);

  useEffect(() => {
    document.title = activeChat ? `${activeChat.title} · Nemotron Workbench` : "Nemotron Workbench";
  }, [activeChat?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!banner || banner.kind === "error") return undefined;
    const timer = window.setTimeout(() => setBanner(null), 6000);
    return () => window.clearTimeout(timer);
  }, [banner]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // ---------- scrolling ----------
  const scrollToBottom = (smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    else el.scrollTop = el.scrollHeight;
  };
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = distance < 120;
    setShowJump(distance > 360);
  };
  useLayoutEffect(() => { if (stickRef.current) scrollToBottom(false); }, [messages, banner]);
  useLayoutEffect(() => { stickRef.current = true; scrollToBottom(false); }, [activeId]);

  // ---------- chat state helpers ----------
  const patchChat = useCallback((chatId, fn) => {
    setChats((cur) => cur.map((c) => (c.id === chatId ? fn(c) : c)));
    setConversationList((cur) => cur.map((c) => {
      if (c.id !== chatId) return c;
      // List entries are summaries without messages, so give fn an empty array to work with.
      const { messages: _messages, ...summary } = fn({ ...c, messages: c.messages || [] });
      return summary;
    }));
  }, []);

  const patchMessage = useCallback((chatId, messageId, patch) => {
    patchChat(chatId, (chat) => ({
      ...chat,
      messages: (chat.messages || []).map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
    }));
  }, [patchChat]);

  const runCompletion = useCallback(async (chatId, history, model, provider, saveOptions = {}) => {
    const controller = new AbortController();
    abortRef.current = controller;
    busyRef.current = chatId;
    setBusyChatId(chatId);
    setBanner(null);

    const assistantId = createId();
    patchChat(chatId, (chat) => ({
      ...chat,
      provider,
      modelId: model.id,
      modelName: model.name,
      updatedAt: Date.now(),
      preview: [...history].reverse().find((message) => message.role === "user")?.content?.slice(0, 240) || chat.preview,
      messages: [...history, { id: assistantId, role: "assistant", content: "", modelName: model.name, streaming: true }],
    }));

    let answer = "";
    let reasoning = "";
    let finish = "";
    let timer = 0;
    const flush = () => {
      timer = 0;
      patchMessage(chatId, assistantId, { content: answer, reasoning });
    };
    const schedule = () => { if (!timer) timer = window.setTimeout(flush, 40); };
    const stopTimer = () => { if (timer) { window.clearTimeout(timer); timer = 0; } };

    try {
      const response = await apiFetch(CHAT_API, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "text/event-stream, application/json" },
        body: JSON.stringify({
          provider,
          model: model.id,
          messages: buildPayload(history, model),
          conversationId: chatId,
          userMessageId: saveOptions.userMessageId || [...history].reverse().find((message) => message.role === "user")?.id,
          assistantMessageId: assistantId,
          persistUser: saveOptions.persistUser !== false,
          replaceMessageId: saveOptions.replaceMessageId || "",
          discardMessageIds: saveOptions.discardMessageIds || [],
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 404 && !data.error) throw new Error(SERVICE_MISSING);
        throw new Error([data.error, data.detail].filter(Boolean).join(" — ") || `Request failed (${response.status}).`);
      }
      const type = response.headers.get("content-type") || "";
      if (!type.includes("text/event-stream")) {
        const data = await response.json().catch(() => ({}));
        if (typeof data.answer !== "string") throw new Error("The provider returned an unsupported response.");
        answer = data.answer;
      } else {
        if (!response.body) throw new Error("Streaming is unavailable in this browser.");
        for await (const event of readEvents(response)) {
          const delta = readDelta(event);
          if (delta.content) answer += delta.content;
          if (delta.reasoning) reasoning += delta.reasoning;
          if (delta.finish) finish = delta.finish;
          if (delta.content || delta.reasoning) schedule();
        }
      }
      stopTimer();
      const split = splitThink(answer);
      const finalReasoning = [reasoning, split.think].filter(Boolean).join("\n\n");
      if (!split.answer.trim()) {
        patchMessage(chatId, assistantId, {
          content: "", reasoning: finalReasoning, streaming: false,
          error: finalReasoning
            ? "The model used its whole token budget thinking and never wrote an answer. Try again, or choose a faster model."
            : "The model returned an empty response. Please try again.",
        });
      } else {
        patchMessage(chatId, assistantId, {
          content: split.answer, reasoning: finalReasoning, streaming: false, truncated: finish === "length",
        });
      }
    } catch (error) {
      stopTimer();
      const aborted = controller.signal.aborted || error?.name === "AbortError";
      if (aborted) {
        if (answer.trim() || reasoning.trim()) {
          patchMessage(chatId, assistantId, { content: splitThink(answer).answer, reasoning, streaming: false, partial: true });
        } else {
          patchChat(chatId, (chat) => ({ ...chat, messages: chat.messages.filter((m) => m.id !== assistantId) }));
        }
      } else {
        patchMessage(chatId, assistantId, {
          content: splitThink(answer).answer, reasoning, streaming: false,
          error: error?.message || "Something went wrong. Please try again.",
        });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      busyRef.current = null;
      setBusyChatId(null);
      patchChat(chatId, (chat) => ({ ...chat, updatedAt: Date.now() }));
      loadConversationList("").catch(() => {});
      if (window.matchMedia?.("(pointer: fine)").matches) document.querySelector(".composer textarea")?.focus();
    }
  }, [loadConversationList, patchChat, patchMessage]);

  // ---------- actions ----------
  const send = (override) => {
    const text = (typeof override === "string" ? override : input).trim();
    if ((!text && !pendingImage) || busyRef.current) return;
    if (!selectedModel) { flash("Choose a model first."); return; }
    if (keyMissing) { flash(`Add ${selection.provider === "nvidia" ? "NVIDIA_API_KEY" : "OPENROUTER_API_KEY"} to use this provider.`); return; }

    const userMessage = {
      id: createId(), role: "user", content: text,
      ...(pendingImage ? { imageDataUrl: pendingImage.dataUrl, imageName: pendingImage.name } : {}),
    };
    let chatId = activeId;
    let history;
    if (!chatId || !activeChat) {
      chatId = createId();
      history = [userMessage];
      const now = Date.now();
      const chat = {
        id: chatId, title: deriveTitle(history), pinned: false, createdAt: now, updatedAt: now,
        provider: selection.provider, modelId: selectedModel.id, modelName: selectedModel.name,
        preview: text.slice(0, 240) || (pendingImage ? "Image attachment" : ""), loaded: true, messages: history,
      };
      setChats((cur) => [chat, ...cur.filter((item) => item.id !== chatId)]);
      setConversationList((cur) => [chat, ...cur.filter((item) => item.id !== chatId)]);
      setActiveId(chatId);
      setMessagePage({ hasMore: false, nextCursor: null });
    } else {
      history = [...activeChat.messages, userMessage];
    }
    setInput("");
    setPendingImage(null);
    stickRef.current = true;
    runCompletion(chatId, history, selectedModel, selection.provider, { userMessageId: userMessage.id });
  };

  const stop = () => abortRef.current?.abort();

  const regenerate = (messageId) => {
    if (busyRef.current || !activeChat || !selectedModel) return;
    const index = activeChat.messages.findIndex((m) => m.id === messageId);
    const history = activeChat.messages.slice(0, index);
    if (index < 0 || !history.length || history[history.length - 1].role !== "user") {
      flash("This reply can't be regenerated because its prompt is missing.");
      return;
    }
    stickRef.current = true;
    runCompletion(activeChat.id, history, selectedModel, selection.provider, {
      persistUser: false,
      replaceMessageId: messageId,
      discardMessageIds: [messageId],
    });
  };

  const editMessage = (messageId, text) => {
    if (busyRef.current || !activeChat || !selectedModel) return;
    const index = activeChat.messages.findIndex((m) => m.id === messageId);
    if (index < 0) return;
    const original = activeChat.messages[index];
    const history = [...activeChat.messages.slice(0, index), { ...original, content: text }];
    const discardMessageIds = activeChat.messages.slice(index + 1).map((message) => message.id);
    if (index === 0 && activeChat.title === titleFromText(original.content)) {
      patchChat(activeChat.id, (chat) => ({ ...chat, title: deriveTitle(history) }));
    }
    stickRef.current = true;
    runCompletion(activeChat.id, history, selectedModel, selection.provider, {
      userMessageId: original.id,
      discardMessageIds,
    });
  };

  const newChat = () => {
    setActiveId(null);
    setInput("");
    setPendingImage(null);
    setBanner(null);
    setDrawerOpen(false);
    setMessagePage({ hasMore: false, nextCursor: null });
    conversationRequestRef.current += 1;
    if (window.matchMedia?.("(pointer: fine)").matches) window.setTimeout(() => document.querySelector(".composer textarea")?.focus(), 0);
  };

  const openChat = (id) => {
    setDrawerOpen(false);
    if (id === activeId) return;
    const chat = conversationList.find((c) => c.id === id);
    if (!chat) return;
    setActiveId(id);
    setBanner(null);
    const list = providers[chat.provider].models;
    if (chat.modelId && list.some((m) => m.id === chat.modelId)) {
      setSelection({ provider: chat.provider, modelId: chat.modelId });
    } else if (chat.modelName && catalogReady) {
      flash(`This conversation used ${chat.modelName}, which isn't available right now. Your next message will use ${selectedModel?.name || "the selected model"}.`, "info");
    }
    setMessagePage({ hasMore: false, nextCursor: null });
    loadConversation(id);
  };

  const deleteChat = async (id) => {
    if (busyRef.current === id) abortRef.current?.abort();
    try {
      await apiRequest(`${CONVERSATIONS_API}?id=${encodeURIComponent(id)}`, { method: "DELETE", body: {} });
      setChats((cur) => cur.filter((c) => c.id !== id));
      setConversationList((cur) => cur.filter((c) => c.id !== id));
      if (id === activeId) {
        setActiveId(null);
        setMessagePage({ hasMore: false, nextCursor: null });
      }
    } catch (error) {
      flash(error.message || "Could not delete this conversation.");
    }
  };

  const renameChat = async (id, title) => {
    const next = title.trim().slice(0, 120);
    if (!next) return;
    try {
      await apiRequest(`${CONVERSATIONS_API}?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { title: next },
      });
      patchChat(id, (chat) => ({ ...chat, title: next }));
    } catch (error) {
      flash(error.message || "Could not rename this conversation.");
    }
  };

  const pinChat = async (id) => {
    const chat = conversationList.find((item) => item.id === id);
    if (!chat) return;
    try {
      await apiRequest(`${CONVERSATIONS_API}?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { pinned: !chat.pinned },
      });
      patchChat(id, (item) => ({ ...item, pinned: !item.pinned }));
    } catch (error) {
      flash(error.message || "Could not update this conversation.");
    }
  };

  const exportChat = async (id) => {
    try {
      const allMessages = [];
      let before = "";
      let hasMore = true;
      let conversation;
      while (hasMore) {
        const params = new URLSearchParams({ id, limit: "100" });
        if (before) params.set("before", before);
        const data = await apiRequest(`${CONVERSATIONS_API}?${params.toString()}`);
        conversation = data.conversation;
        allMessages.unshift(...data.messages.map(mapMessage));
        hasMore = data.hasMore;
        before = data.nextCursor;
      }
      if (conversation) {
        const chat = { ...mapConversation(conversation), messages: allMessages };
        downloadText(`${safeFilename(chat.title)}.md`, chatToMarkdown(chat));
      }
    } catch (error) {
      flash(error.message || "Could not export this conversation.");
    }
  };

  const clearAll = async () => {
    abortRef.current?.abort();
    try {
      await apiRequest(`${CONVERSATIONS_API}?all=1`, { method: "DELETE", body: {} });
      setChats([]);
      setConversationList([]);
      setActiveId(null);
      setMessagePage({ hasMore: false, nextCursor: null });
    } catch (error) {
      flash(error.message || "Could not delete your conversations.");
    }
  };

  const importLocalChats = async () => {
    if (!localChats.length || !window.confirm(`Import ${localChats.length} local conversation${localChats.length === 1 ? "" : "s"} into this account?`)) return;
    let imported = 0;
    for (const chat of localChats) {
      try {
        await apiRequest(CONVERSATIONS_API, { method: "POST", body: { action: "import", chat } });
        imported += 1;
      } catch (error) {
        setHistoryError(error.message || `Could not import “${chat.title}”.`);
        return;
      }
    }
    setLocalChats([]);
    flash(`${imported} local conversation${imported === 1 ? "" : "s"} imported.`, "info");
    loadConversationList("");
  };

  const logoutUser = async () => {
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      flash(error.message || "Could not sign out.");
    }
  };

  const loadOlder = () => {
    if (!activeId || !messagePage.hasMore || !messagePage.nextCursor || loadingOlder) return;
    loadConversation(activeId, { before: messagePage.nextCursor, append: true });
  };

  const selectModel = (provider, model) => {
    setSelection({ provider, modelId: model.id });
    setBanner(null);
    if (pendingImage && !model.vision) {
      setPendingImage(null);
      flash(`${model.name} can't read images, so the attached image was removed.`, "info");
    }
  };

  const pickFile = async (file) => {
    if (!file) return;
    if (!selectedModel?.vision) {
      flash("The selected model can't read images. Pick a model with the Vision badge first.", "info");
      return;
    }
    try {
      setPendingImage(await prepareImage(file));
      setBanner(null);
    } catch (error) {
      flash(error.message || "Could not read that image.");
    }
  };

  const collapseSidebar = (value) => { setCollapsed(value); writeStore(SIDEBAR_KEY, value ? "1" : "0"); };

  // ---------- drag and drop ----------
  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
  const onDragEnter = (event) => { if (!hasFiles(event)) return; event.preventDefault(); dragDepth.current += 1; setDragActive(true); };
  const onDragOver = (event) => { if (hasFiles(event)) event.preventDefault(); };
  const onDragLeave = (event) => { if (!hasFiles(event)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragActive(false); };
  const onDrop = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    pickFile(Array.from(event.dataTransfer.files).find((f) => f.type.startsWith("image/")));
  };

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const lastId = messages[messages.length - 1]?.id;
  const keyName = selection.provider === "nvidia" ? "NVIDIA_API_KEY" : "OPENROUTER_API_KEY";
  const providerError = activeProvider.error;
  const changeTheme = async () => {
    const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    cycleTheme();
    try {
      await apiRequest(ACCOUNT_API, { method: "PATCH", body: { preferences: { theme: next } } });
      await refresh();
    } catch (error) {
      flash(error.message || "Could not save your theme preference.");
    }
  };

  return (
    <div className={`app ${collapsed ? "sb-collapsed" : ""}`}>
      <Sidebar
        chats={conversationList}
        activeId={activeId}
        busyChatId={busyChatId}
        historyError={historyError}
        open={drawerOpen}
        collapsed={collapsed}
        onClose={() => setDrawerOpen(false)}
        onCollapse={() => collapseSidebar(true)}
        onNew={newChat}
        onOpen={openChat}
        onRename={renameChat}
        onPin={pinChat}
        onDelete={deleteChat}
        onExport={exportChat}
        onClearAll={clearAll}
        user={user}
        onLogout={logoutUser}
        onSearch={loadConversationList}
        onImport={importLocalChats}
        localImportCount={localChats.length}
        historyLoading={historyLoading}
      />

      <main className="main" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <header className="topbar">
          <button type="button" className="icon-btn hide-desktop" onClick={() => setDrawerOpen(true)} aria-label="Open conversations"><Menu size={20} /></button>
          {collapsed && (
            <button type="button" className="icon-btn hide-mobile" onClick={() => collapseSidebar(false)} aria-label="Show sidebar" title="Show sidebar"><PanelLeftOpen size={19} /></button>
          )}
          <ModelPicker
            providers={providers}
            selection={selection}
            current={selectedModel}
            onSelect={selectModel}
            onRefresh={() => loadModels(true)}
            loading={modelsLoading}
          />
          <div className="topbar-spacer" />
          <button type="button" className="icon-btn" onClick={changeTheme} aria-label={`Theme: ${theme}. Click to change`} title={`Theme: ${theme}`}><ThemeIcon size={18} /></button>
          <button type="button" className="icon-btn" onClick={newChat} aria-label="New chat" title="New chat"><Plus size={20} /></button>
        </header>

        <div className="thread-wrap">
          <div className="thread-scroll" ref={scrollRef} onScroll={onScroll}>
            {chatLoading && activeId ? (
              <div className="welcome"><div className="typing" aria-label="Loading conversation"><i /><i /><i /></div><p className="sub">Loading your conversation…</p></div>
            ) : messages.length === 0 ? (
              <BentoWelcome
                providerError={providerError}
                onRetry={() => loadModels(true)}
                keyMissing={keyMissing}
                keyName={keyName}
                onPick={send}
                disabled={!selectedModel || keyMissing || busy}
                modelName={selectedModel?.name}
                providerName={selection.provider === "nvidia" ? "NVIDIA" : "OpenRouter"}
                vision={Boolean(selectedModel?.vision)}
                modelCount={activeProvider.models.length}
                chatCount={chats.length}
              />
            ) : (
              <div className="thread" role="log" aria-busy={busy}>
                {messagePage.hasMore && (
                  <button type="button" className="load-older" onClick={loadOlder} disabled={loadingOlder}>
                    {loadingOlder ? "Loading older messages…" : "Load older messages"}
                  </button>
                )}
                {messages.map((message) => (
                  <Message
                    key={message.id}
                    message={message}
                    isLast={message.id === lastId}
                    busy={busy}
                    onRegenerate={regenerate}
                    onEdit={editMessage}
                    onError={flash}
                  />
                ))}
              </div>
            )}
          </div>
          {showJump && messages.length > 0 && (
            <button type="button" className="jump" onClick={() => { stickRef.current = true; scrollToBottom(true); }} aria-label="Jump to latest message"><ArrowDown size={18} /></button>
          )}
          {dragActive && <div className="drop-overlay"><span>Drop an image to attach it</span></div>}
        </div>

        {banner && (
          <div className={`banner ${banner.kind}`} role={banner.kind === "error" ? "alert" : "status"}>
            <span>{banner.text}</span>
            <button type="button" className="icon-btn small" onClick={() => setBanner(null)} aria-label="Dismiss"><X size={15} /></button>
          </div>
        )}
        {keyMissing && messages.length > 0 && (
          <div className="banner warn" role="status"><span>Add <code>{keyName}</code> to use this provider.</span></div>
        )}

        <Composer
          value={input}
          onChange={setInput}
          onSend={() => send()}
          onStop={stop}
          busy={busy}
          locked={!selectedModel || keyMissing}
          placeholder={selectedModel ? `Message ${selectedModel.name}` : "Choose a model to start chatting"}
          vision={Boolean(selectedModel?.vision)}
          image={pendingImage}
          onPickFile={pickFile}
          onRemoveImage={() => setPendingImage(null)}
          onNotice={(text) => flash(text, "info")}
        />
      </main>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className="route-loading">Checking your session…</main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  const home = loading
    ? <main className="route-loading">Checking your session…</main>
    : <Navigate to={user ? "/chat" : "/login"} replace />;

  return (
    <Routes>
      <Route path="/" element={home} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/dashboard" element={<ProtectedRoute><Workbench /></ProtectedRoute>} />
      <Route path="/chat" element={<ProtectedRoute><Workbench /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="*" element={home} />
    </Routes>
  );
}
