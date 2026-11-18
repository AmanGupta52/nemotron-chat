import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Eye, RefreshCw, Search } from "lucide-react";

function contextLabel(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M ctx`;
  return `${Math.round(n / 1000)}K ctx`;
}

const KEY_NAMES = { nvidia: "NVIDIA_API_KEY", openrouter: "OPENROUTER_API_KEY" };
const LABELS = { nvidia: "NVIDIA", openrouter: "OpenRouter" };

export default function ModelPicker({ providers, selection, current, onSelect, onRefresh, loading }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(selection.provider);
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (!wrapRef.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open) { setTab(selection.provider); setQuery(""); }
    setOpen((v) => !v);
  };

  useEffect(() => {
    // Focus search on desktop only; on phones it would pop the keyboard over the list.
    if (open && window.matchMedia?.("(pointer: fine)").matches) searchRef.current?.focus();
  }, [open]);

  const data = providers[tab];
  const models = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data.models.filter((m) => !q || `${m.name} ${m.id} ${m.description || ""}`.toLowerCase().includes(q));
    return [...list].sort((a, b) => (a.id === "openrouter/free" ? -1 : b.id === "openrouter/free" ? 1 : 0));
  }, [data.models, query]);

  const pick = (model) => { onSelect(tab, model); setOpen(false); };

  return (
    <div className="mp" ref={wrapRef}>
      <button type="button" className="mp-button" onClick={toggle} aria-expanded={open} aria-haspopup="dialog">
        <span className={`pmark ${selection.provider}`}>{selection.provider === "nvidia" ? "N" : "OR"}</span>
        <span className="mp-text">
          <strong>{current?.name || (loading ? "Loading models…" : "Choose a model")}</strong>
          <small>{current ? `${LABELS[selection.provider]}${selection.provider === "openrouter" ? " · Free" : ""}${current.vision ? " · Vision" : ""}` : "No model selected"}</small>
        </span>
        <ChevronDown size={16} className={`chev ${open ? "up" : ""}`} />
      </button>

      {open && <button type="button" className="mp-scrim" aria-label="Close model picker" onClick={() => setOpen(false)} />}
      {open && (
        <div className="mp-panel" role="dialog" aria-label="Choose a model">
          <div className="mp-grab" aria-hidden="true" />
          <div className="mp-head">
            <div className="seg" role="tablist" aria-label="Provider">
              {["nvidia", "openrouter"].map((key) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => { setTab(key); setQuery(""); }}>
                  {LABELS[key]}<span>{providers[key].models.length}{key === "openrouter" ? " free" : ""}</span>
                </button>
              ))}
            </div>
            <button type="button" className="icon-btn small" onClick={onRefresh} aria-label="Refresh model list" title="Refresh model list">
              <RefreshCw size={15} className={loading ? "spin" : ""} />
            </button>
          </div>

          {data.configured === false && (
            <div className="mp-note warn">Add <code>{KEY_NAMES[tab]}</code> to the backend <code>.env</code> or your hosting environment variables to use these models.</div>
          )}
          {data.error && <div className="mp-note error">{data.error}</div>}

          <label className="mp-search">
            <Search size={15} />
            <input ref={searchRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search models" aria-label="Search models" />
          </label>

          <div className="mp-list" role="listbox" aria-label={`${LABELS[tab]} models`}>
            {models.map((model) => {
              const selected = selection.provider === tab && selection.modelId === model.id;
              return (
                <button key={model.id} type="button" role="option" aria-selected={selected} className={`mp-item ${selected ? "selected" : ""}`} onClick={() => pick(model)}>
                  <span className="mp-item-main">
                    <strong>{model.name}</strong>
                    <small>{model.description || model.id}</small>
                    <span className="badges">
                      {tab === "openrouter" && <em className="badge free">Free</em>}
                      {model.vision && <em className="badge"><Eye size={11} /> Vision</em>}
                      {contextLabel(model.contextLength) && <em className="badge">{contextLabel(model.contextLength)}</em>}
                    </span>
                  </span>
                  {selected && <Check size={17} className="tick" />}
                </button>
              );
            })}
            {!models.length && (
              <p className="mp-empty">{loading ? "Loading models…" : query ? "No models match your search." : "No models available."}</p>
            )}
          </div>
          <p className="mp-foot">
            {tab === "openrouter"
              ? "Only zero-price models are listed. Free quotas and availability change often."
              : "Access and free limits depend on your NVIDIA account. No paid fallback is used."}
          </p>
        </div>
      )}
    </div>
  );
}
