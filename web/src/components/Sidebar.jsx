import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, LogOut, MoreHorizontal, PanelLeftClose, Pencil, Pin, PinOff, Plus, Search, Settings, Sparkles, Trash2, UserRound, X } from "lucide-react";
import { formatTime, groupChats } from "../lib/history.js";
import { Link } from "react-router-dom";

function RenameInput({ initial, onCommit, onCancel }) {
  const ref = useRef(null);
  const doneRef = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (save) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (save) onCommit(ref.current.value); else onCancel();
  };
  return (
    <input
      ref={ref}
      className="rename-input"
      defaultValue={initial}
      maxLength={120}
      aria-label="Conversation name"
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        if (e.key === "Escape") { e.preventDefault(); finish(false); }
      }}
      onBlur={() => finish(true)}
    />
  );
}

export default function Sidebar({
  chats, activeId, busyChatId, historyError, open, collapsed, onClose, onCollapse,
  onNew, onOpen, onRename, onPin, onDelete, onExport, onClearAll,
  user, onLogout, onSearch, onImport, localImportCount, historyLoading,
  hasMore, loadingMore, onLoadMore,
}) {
  const [query, setQuery] = useState("");
  const [ui, setUi] = useState({ menuId: null, up: false, confirm: false, renamingId: null });
  const [confirmAll, setConfirmAll] = useState(false);
  const rootRef = useRef(null);

  const groups = useMemo(() => groupChats(chats.map((chat) => ({ chat, snippet: chat.preview || "" }))), [chats]);

  useEffect(() => {
    const timer = window.setTimeout(() => onSearch?.(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query, onSearch]);

  useEffect(() => {
    if (!ui.menuId) return undefined;
    const close = (event) => {
      if (!event.target.closest?.("[data-menu]")) setUi((s) => ({ ...s, menuId: null, confirm: false }));
    };
    const onKey = (event) => { if (event.key === "Escape") setUi((s) => ({ ...s, menuId: null, confirm: false })); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", onKey); };
  }, [ui.menuId]);

  useEffect(() => { if (!confirmAll) return undefined; const t = window.setTimeout(() => setConfirmAll(false), 4000); return () => window.clearTimeout(t); }, [confirmAll]);

  const openMenu = (event, id) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setUi((s) => (s.menuId === id ? { ...s, menuId: null, confirm: false } : { ...s, menuId: id, confirm: false, up: window.innerHeight - rect.bottom < 210 }));
  };

  return (
    <>
      {open && <button type="button" className="scrim" aria-label="Close conversations" onClick={onClose} />}
      <aside className={`sidebar ${open ? "open" : ""} ${collapsed ? "collapsed" : ""}`} aria-label="Conversations" ref={rootRef}>
        <div className="sb-top">
          <Link className="brand" to="/" aria-label="Nemotron Workbench home" onClick={onClose}>
            <span className="brand-mark"><Sparkles size={16} /></span>
            <span>Nemotron<span className="muted"> Workbench</span></span>
          </Link>
          <button type="button" className="icon-btn small hide-desktop" onClick={onClose} aria-label="Close sidebar"><X size={18} /></button>
          <button type="button" className="icon-btn small hide-mobile" onClick={onCollapse} aria-label="Collapse sidebar" title="Collapse sidebar"><PanelLeftClose size={18} /></button>
        </div>

        <button type="button" className="new-chat" onClick={onNew}><Plus size={17} /> New chat</button>

        <label className="sb-search">
          <Search size={15} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
        </label>

        {historyError && <p className="sb-error" role="status">{historyError}</p>}

        <nav className="sb-list" aria-label="Saved conversations">
          {groups.map((group) => (
            <section key={group.name}>
              <h2>{group.name}</h2>
              <ul>
                {group.items.map(({ chat, snippet }) => {
                  const active = chat.id === activeId;
                  const busy = chat.id === busyChatId;
                  const menuOpen = ui.menuId === chat.id;
                  return (
                    <li key={chat.id} className={`chat-item ${active ? "active" : ""} ${menuOpen ? "menu-open" : ""}`}>
                      {ui.renamingId === chat.id ? (
                        <RenameInput
                          initial={chat.title}
                          onCommit={(value) => { setUi((s) => ({ ...s, renamingId: null })); onRename(chat.id, value); }}
                          onCancel={() => setUi((s) => ({ ...s, renamingId: null }))}
                        />
                      ) : (
                        <button type="button" className="chat-main" onClick={() => onOpen(chat.id)} aria-current={active ? "page" : undefined}>
                          <span className="chat-title">
                            {chat.pinned && <Pin size={12} className="pin" aria-label="Pinned" />}
                            <span>{chat.title}</span>
                          </span>
                          <span className="chat-meta">{snippet || `${chat.modelName || "Chat"} · ${formatTime(chat.updatedAt)}`}</span>
                        </button>
                      )}
                      {busy && <span className="busy-dot" title="Generating a reply" />}
                      {ui.renamingId !== chat.id && (
                        <button type="button" className="chat-more" data-menu onClick={(e) => openMenu(e, chat.id)} aria-label={`Options for ${chat.title}`} aria-expanded={menuOpen}>
                          <MoreHorizontal size={17} />
                        </button>
                      )}
                      {menuOpen && (
                        <div className={`chat-menu ${ui.up ? "up" : ""}`} role="menu" data-menu>
                          <button type="button" role="menuitem" onClick={() => setUi({ menuId: null, up: false, confirm: false, renamingId: chat.id })}><Pencil size={15} /> Rename</button>
                          <button type="button" role="menuitem" onClick={() => { setUi((s) => ({ ...s, menuId: null })); onPin(chat.id); }}>
                            {chat.pinned ? <PinOff size={15} /> : <Pin size={15} />} {chat.pinned ? "Unpin" : "Pin to top"}
                          </button>
                          <button type="button" role="menuitem" onClick={() => { setUi((s) => ({ ...s, menuId: null })); onExport(chat.id); }}><Download size={15} /> Export as Markdown</button>
                          <button
                            type="button"
                            role="menuitem"
                            className="danger"
                            onClick={() => {
                              if (!ui.confirm) { setUi((s) => ({ ...s, confirm: true })); return; }
                              setUi((s) => ({ ...s, menuId: null, confirm: false }));
                              onDelete(chat.id);
                            }}
                          >
                            <Trash2 size={15} /> {ui.confirm ? "Click again to delete" : "Delete"}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {hasMore && (
            <button type="button" className="sb-more" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more chats"}
            </button>
          )}
          {!groups.length && (
            <p className="sb-empty">{historyLoading ? "Loading your conversations…" : query ? "No conversations match your search." : "Your conversations will appear here."}</p>
          )}
        </nav>

        <div className="sb-foot">
          <span>{chats.length} shown{hasMore ? " · more available" : ""} · private to your account</span>
          {chats.length > 0 && (
            <button type="button" className={`link-btn ${confirmAll ? "danger" : ""}`} onClick={() => { if (!confirmAll) { setConfirmAll(true); return; } setConfirmAll(false); onClearAll(); }}>
              {confirmAll ? "Click again to confirm" : "Clear all"}
            </button>
          )}
          {localImportCount > 0 && (
            <button type="button" className="link-btn" onClick={onImport}>Import {localImportCount} local chat{localImportCount === 1 ? "" : "s"}</button>
          )}
        </div>
        <div className="sb-account">
          <div className="sb-user"><span className="sb-avatar">{(user?.name || "U").slice(0, 1).toUpperCase()}</span><span><strong>{user?.name}</strong><small>{user?.email}</small></span></div>
          <div className="sb-account-actions">
            <Link to="/profile" onClick={onClose} aria-label="Profile" title="Profile"><UserRound size={16} /></Link>
            <Link to="/settings" onClick={onClose} aria-label="Settings" title="Settings"><Settings size={16} /></Link>
            <button type="button" onClick={onLogout} aria-label="Log out" title="Log out"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
    </>
  );
}
