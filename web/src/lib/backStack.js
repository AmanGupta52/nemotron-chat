// Android back-button support.
//  - Open overlays (image viewer, side drawer, dialogs) register a handler here; back closes the top one first.
//  - Otherwise App.jsx goes to the previous page, and only exits the app from the main screen (double back).
import { useEffect, useRef } from "react";

const stack = [];

export function runBackHandler() {
  const handler = stack[stack.length - 1];
  if (!handler) return false;
  handler();
  return true;
}

export function useBackHandler(active, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return undefined;
    const entry = () => ref.current();
    stack.push(entry);
    return () => {
      const index = stack.lastIndexOf(entry);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [active]);
}

export function showToast(text) {
  const el = document.createElement("div");
  el.textContent = text;
  el.setAttribute("role", "status");
  Object.assign(el.style, {
    position: "fixed", left: "50%", bottom: "max(28px, env(safe-area-inset-bottom))", transform: "translateX(-50%)",
    zIndex: 2000, padding: "10px 16px", borderRadius: "99px", background: "rgba(20,24,30,.94)", color: "#fff",
    font: "500 14px system-ui, sans-serif", boxShadow: "0 6px 24px rgba(0,0,0,.35)", pointerEvents: "none",
  });
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 1800);
}
