import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Brain, Check, ChevronRight, Copy, Download, FileText, ImageIcon, Pencil, RotateCcw, Sparkles, X } from "lucide-react";
import { splitThink } from "../lib/think.js";

const Markdown = lazy(() => import("./Markdown.jsx"));

function ThinkBlock({ text, live }) {
  const [override, setOverride] = useState(null);
  const open = override ?? live; // follows the stream until the user toggles it
  return (
    <div className={`think ${open ? "open" : ""}`}>
      <button type="button" className="think-toggle" onClick={() => setOverride(!open)} aria-expanded={open}>
        <Brain size={14} />
        <span>{live ? "Thinking…" : "Thought process"}</span>
        <ChevronRight size={14} className="chev" />
      </button>
      {open && <div className="think-body">{text}</div>}
    </div>
  );
}

function CopyButton({ text, onError, label = "Copy" }) {
  const [done, setDone] = useState(false);
  const click = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 1500);
    } catch {
      onError?.("Clipboard access was blocked by your browser.");
    }
  };
  return (
    <button type="button" className="act" onClick={click} aria-label={label}>
      {done ? <Check size={14} /> : <Copy size={14} />}
      <span>{done ? "Copied" : label}</span>
    </button>
  );
}

// Full-screen image viewer inside the app (closes with the X, a tap outside the image, or Esc).
function ImageViewer({ src, name, downloadUrl, onClose }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [onClose]);

  const bar = {
    position: "absolute", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", gap: 8,
    padding: "max(10px, env(safe-area-inset-top)) 12px 10px", color: "#fff",
    background: "linear-gradient(rgba(0,0,0,.6), transparent)",
  };
  const btn = {
    display: "inline-grid", placeItems: "center", width: 38, height: 38, borderRadius: 99,
    border: 0, background: "rgba(255,255,255,.16)", color: "#fff", cursor: "pointer",
  };
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name || "Image"}
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.92)", display: "grid", placeItems: "center" }}
    >
      <div style={bar} onClick={(e) => e.stopPropagation()}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14 }}>{name}</span>
        {downloadUrl && (
          <a href={downloadUrl} download={name || "image"} target="_blank" rel="noopener noreferrer" style={btn} aria-label="Download image" title="Download">
            <Download size={18} />
          </a>
        )}
        <button type="button" style={btn} onClick={onClose} aria-label="Close image" title="Close"><X size={20} /></button>
      </div>
      <img
        src={src}
        alt={name || "Image"}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "100vw", maxHeight: "100vh", objectFit: "contain", touchAction: "pinch-zoom" }}
      />
    </div>,
    document.body,
  );
}

function UserMessage({ message, canEdit, onEdit, onError }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const areaRef = useRef(null);
  const [viewer, setViewer] = useState(null); // { src, name, downloadUrl }

  useEffect(() => {
    if (!editing) return;
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [editing, draft]);

  const save = () => {
    const next = draft.trim();
    if (!next && !message.imageDataUrl && !message.attachment) return;
    setEditing(false);
    onEdit(message.id, next);
  };

  return (
    <article className="msg user">
      <div className="user-wrap">
        {message.imageDataUrl && (
          <img
            className="msg-image"
            src={message.imageDataUrl}
            alt={message.imageName || "Attached image"}
            style={{ cursor: "zoom-in" }}
            onClick={() => setViewer({ src: message.imageDataUrl, name: message.imageName, downloadUrl: message.attachment?.url })}
          />
        )}
        {!message.imageDataUrl && message.attachment?.kind === "image" && (
          <img
            className="msg-image"
            src={message.attachment.url.replace("/upload/", "/upload/w_800,q_auto,f_auto/")}
            alt={message.attachment.name || "Attached image"}
            loading="lazy"
            style={{ cursor: "zoom-in" }}
            onClick={() => setViewer({ src: message.attachment.url, name: message.attachment.name, downloadUrl: message.attachment.url })}
          />
        )}
        {viewer && <ImageViewer {...viewer} onClose={() => setViewer(null)} />}
        {message.attachment && message.attachment.kind !== "image" && (
          <a className="img-chip" href={message.attachment.url} target="_blank" rel="noopener noreferrer" download={message.attachment.name}>
            <FileText size={13} /> {message.attachment.name}
          </a>
        )}
        {!message.imageDataUrl && !message.attachment && message.hadImage && (
          <span className="img-chip"><ImageIcon size={13} /> {message.imageName || "Image"} · not saved in history</span>
        )}
        {editing ? (
          <div className="edit-box">
            <textarea
              ref={areaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setEditing(false); setDraft(message.content); }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
              }}
              rows={2}
              maxLength={16000}
              aria-label="Edit your message"
              autoFocus
            />
            <div className="edit-actions">
              <button type="button" className="btn ghost" onClick={() => { setEditing(false); setDraft(message.content); }}>Cancel</button>
              <button type="button" className="btn primary" onClick={save} disabled={!draft.trim() && !message.imageDataUrl && !message.attachment}>Save &amp; resend</button>
            </div>
          </div>
        ) : (
          message.content && <div className="bubble">{message.content}</div>
        )}
        {!editing && (
          <div className="msg-actions user-actions">
            <CopyButton text={message.content} onError={onError} />
            {canEdit && (
              <button type="button" className="act" onClick={() => { setDraft(message.content); setEditing(true); }} aria-label="Edit message">
                <Pencil size={14} /><span>Edit</span>
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export default function Message({ message, isLast, busy, onRegenerate, onEdit, onError }) {
  if (message.role === "user") {
    return <UserMessage message={message} canEdit={!busy} onEdit={onEdit} onError={onError} />;
  }

  const split = splitThink(message.content);
  const reasoning = [message.reasoning, split.think].filter(Boolean).join("\n\n");
  const answer = split.answer;
  const streaming = Boolean(message.streaming);
  const waiting = streaming && !answer && !reasoning;
  const thinkingLive = streaming && !answer;

  return (
    <article className="msg assistant">
      <div className="avatar" aria-hidden="true"><Sparkles size={15} /></div>
      <div className="assistant-main">
        <div className="author">{message.modelName || "Assistant"}</div>
        {reasoning && <ThinkBlock text={reasoning} live={thinkingLive} />}
        {waiting && <div className="typing" aria-label="Waiting for response"><i /><i /><i /></div>}
        {answer && (
          <Suspense fallback={<div className="md">{answer}</div>}>
            <Markdown content={answer} onError={onError} />
          </Suspense>
        )}
        {streaming && answer && <span className="caret" aria-hidden="true" />}
        {message.truncated && !streaming && (
          <p className="note">This answer stopped at the length limit. Ask the model to continue.</p>
        )}
        {message.partial && !streaming && !message.error && (
          <p className="note">Response was stopped before it finished.</p>
        )}
        {message.error && (
          <div className="msg-error" role="alert">
            <AlertTriangle size={16} />
            <div>
              <strong>This reply failed</strong>
              <span>{message.error}</span>
            </div>
          </div>
        )}
        {!streaming && (
          <div className="msg-actions">
            {answer && <CopyButton text={answer} onError={onError} />}
            {isLast && !busy && (
              <button type="button" className="act" onClick={() => onRegenerate(message.id)} aria-label={message.error ? "Try again" : "Regenerate response"}>
                <RotateCcw size={14} /><span>{message.error ? "Try again" : "Regenerate"}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
