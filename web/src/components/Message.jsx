import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AlertTriangle, Brain, Check, ChevronRight, Copy, ImageIcon, Pencil, RotateCcw, Sparkles } from "lucide-react";
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

function UserMessage({ message, canEdit, onEdit, onError }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const areaRef = useRef(null);

  useEffect(() => {
    if (!editing) return;
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [editing, draft]);

  const save = () => {
    const next = draft.trim();
    if (!next && !message.imageDataUrl) return;
    setEditing(false);
    onEdit(message.id, next);
  };

  return (
    <article className="msg user">
      <div className="user-wrap">
        {message.imageDataUrl && <img className="msg-image" src={message.imageDataUrl} alt={message.imageName || "Attached image"} />}
        {!message.imageDataUrl && message.hadImage && (
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
              <button type="button" className="btn primary" onClick={save} disabled={!draft.trim() && !message.imageDataUrl}>Save &amp; resend</button>
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
