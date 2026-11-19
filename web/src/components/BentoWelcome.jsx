import React from "react";
import { ArrowUpRight, BookOpen, Code2, Cpu, Eye, GraduationCap, Keyboard, Lightbulb, MessageSquare, Sparkles } from "lucide-react";

const PROMPTS = {
  code: "Help me write and debug code",
  explain: "Explain a difficult topic in simple words",
  ideas: "Give me ideas for my next project",
  learn: "Teach me something new today",
};

function PromptTile({ icon: Icon, label, prompt, className = "", onPick, disabled }) {
  return (
    <button type="button" className={`tile tile-button ${className}`} onClick={() => onPick(prompt)} disabled={disabled}>
      <span className="tile-top">
        <span className="tile-icon"><Icon size={18} /></span>
        <ArrowUpRight className="tile-arrow" size={16} />
      </span>
      <span>
        <span className="tile-label">{label}</span>
        <span className="tile-title">{prompt}</span>
      </span>
    </button>
  );
}

// Bento grid: different-sized rounded tiles. Shown on an empty chat.
export default function BentoWelcome({
  providerError, onRetry, keyMissing, keyName,
  onPick, disabled, modelName, providerName, vision, modelCount, chatCount,
}) {
  return (
    <div className="bento-wrap">
      <div className="bento">
        <section className="tile tile-hero">
          <span className="tile-icon tile-icon-accent"><Sparkles size={20} /></span>
          <div>
            <p className="tile-label">Your AI workspace</p>
            <h1>One chat.<br /><span>Many minds.</span></h1>
            <p className="tile-text">Chat with NVIDIA models or free OpenRouter models for coding, reasoning and vision.</p>
            {providerError && (
              <div className="inline-note error" role="alert">
                <span>{providerError}</span>
                <button type="button" onClick={onRetry}>Retry</button>
              </div>
            )}
            {keyMissing && !providerError && (
              <div className="inline-note warn" role="status">Add <code>{keyName}</code> to the backend's environment variables to chat with this provider.</div>
            )}
          </div>
        </section>

        <section className="tile tile-wide">
          <span className="tile-top">
            <span className="tile-icon"><Cpu size={18} /></span>
            {vision && <span className="tile-badge"><Eye size={12} /> Vision</span>}
          </span>
          <div>
            <p className="tile-label">Active model · {providerName}</p>
            <p className="tile-title tile-title-lg">{modelName || "Loading models…"}</p>
            <p className="tile-text">Change it any time from the picker at the top.</p>
          </div>
        </section>

        <PromptTile icon={Code2} label="Code" prompt={PROMPTS.code} onPick={onPick} disabled={disabled} />
        <PromptTile icon={BookOpen} label="Explain" prompt={PROMPTS.explain} onPick={onPick} disabled={disabled} />
        <PromptTile icon={Lightbulb} label="Ideas" prompt={PROMPTS.ideas} className="tile-wide" onPick={onPick} disabled={disabled} />

        <section className="tile tile-accent">
          <span className="tile-icon"><MessageSquare size={18} /></span>
          <div>
            <p className="tile-stat">{chatCount}</p>
            <p className="tile-label">{chatCount === 1 ? "conversation" : "conversations"}</p>
          </div>
        </section>

        <PromptTile icon={GraduationCap} label="Learn" prompt={PROMPTS.learn} onPick={onPick} disabled={disabled} />

        <section className="tile tile-tip">
          <span className="tile-icon"><Keyboard size={18} /></span>
          <p className="tile-text"><strong>Tip:</strong> press Enter to send and Shift + Enter for a new line. {modelCount ? `${modelCount} models available.` : ""}</p>
        </section>
      </div>
    </div>
  );
}
