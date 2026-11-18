import React, { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import "highlight.js/styles/github-dark.css";

function nodeText(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (React.isValidElement(node)) return nodeText(node.props.children);
  return "";
}

function CodeBlock({ children, onError }) {
  const [copied, setCopied] = useState(false);
  const codeEl = React.Children.toArray(children).find(React.isValidElement);
  const language = codeEl?.props?.className?.match(/language-([\w-]+)/)?.[1] || "text";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(nodeText(children).replace(/\n$/, ""));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      onError?.("Clipboard access was blocked by your browser.");
    }
  };

  return (
    <div className="code-block">
      <div className="code-head">
        <span>{language}</span>
        <button type="button" onClick={copy} aria-label="Copy code">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function Markdown({ content, onError }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize, [rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          a: ({ node, children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          pre: ({ node, children }) => <CodeBlock onError={onError}>{children}</CodeBlock>,
          table: ({ node, children }) => <div className="table-wrap"><table>{children}</table></div>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
