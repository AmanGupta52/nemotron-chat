import React, { useEffect, useRef } from "react";
import { ArrowUp, ImagePlus, Square, X } from "lucide-react";

const isTouchDevice = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

export default function Composer({
  value, onChange, onSend, onStop, busy, locked, placeholder,
  vision, image, onPickFile, onRemoveImage, onNotice,
}) {
  const areaRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = Math.min(220, Math.round(window.innerHeight * 0.32));
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [value]);

  const canSend = !busy && !locked && (value.trim() || image);

  const onKeyDown = (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    // On phones Enter inserts a new line (the send button sends), like most mobile chat apps.
    if (isTouchDevice()) return;
    event.preventDefault();
    if (canSend) onSend();
  };

  const onPaste = (event) => {
    const file = Array.from(event.clipboardData?.files || []).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    onPickFile(file);
  };

  const attach = () => {
    if (!vision) {
      onNotice("The selected model can't read images. Pick a model with the Vision badge.");
      return;
    }
    fileRef.current?.click();
  };

  return (
    <div className="composer-wrap">
      {image && (
        <div className="attachment">
          <img src={image.dataUrl} alt="" />
          <div className="attachment-text">
            <strong>{image.name}</strong>
            <small>{Math.max(1, Math.round(image.size / 1024))} KB · ready to send</small>
          </div>
          <button type="button" className="icon-btn small" onClick={onRemoveImage} aria-label="Remove image"><X size={15} /></button>
        </div>
      )}
      <div className="composer">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPickFile(f); }}
        />
        <button
          type="button"
          className={`icon-btn ${vision ? "" : "dim"}`}
          onClick={attach}
          disabled={locked}
          aria-label="Attach image"
          title={vision ? "Attach an image" : "This model can't read images"}
        >
          <ImagePlus size={20} />
        </button>
        <textarea
          ref={areaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          rows={1}
          maxLength={16000}
          disabled={locked}
          enterKeyHint="enter"
          autoComplete="off"
          autoCorrect="on"
          aria-label="Message"
        />
        {busy ? (
          <button type="button" className="send stop" onClick={onStop} aria-label="Stop generating" title="Stop generating">
            <Square size={15} fill="currentColor" />
          </button>
        ) : (
          <button type="button" className="send" onClick={onSend} disabled={!canSend} aria-label="Send message" title="Send">
            <ArrowUp size={19} />
          </button>
        )}
      </div>
      <p className="composer-hint">
        <span className="hint-desktop">Enter to send · Shift + Enter for a new line · </span>
        AI can make mistakes. Check important information.
      </p>
    </div>
  );
}
