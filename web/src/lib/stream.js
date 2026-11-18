// Server-sent-events reader for the OpenAI-compatible stream the chat function passes through.

export async function* readEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const chunks = buffer.split(/\r?\n\r?\n/);
      if (done) {
        buffer = "";
      } else {
        buffer = chunks.pop() || "";
      }
      for (const chunk of chunks) {
        const data = chunk
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue; // comments such as ": OPENROUTER PROCESSING"
        if (data === "[DONE]") {
          finished = true;
          return;
        }
        let event;
        try { event = JSON.parse(data); } catch { throw new Error("The provider sent an invalid streaming response."); }
        if (event.error) throw new Error(event.error.message || String(event.error));
        yield event;
      }
      if (done) {
        if (!finished) throw new Error("The AI stream ended before the response was complete.");
        return;
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}

function textOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  return "";
}

export function readDelta(event) {
  const choice = event?.choices?.[0];
  const delta = choice?.delta || {};
  return {
    content: textOf(delta.content),
    reasoning: textOf(delta.reasoning_content ?? delta.reasoning),
    finish: choice?.finish_reason || "",
  };
}
