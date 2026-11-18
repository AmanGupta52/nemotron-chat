// Some models put their reasoning inside <think>…</think> in the normal text stream.
export function splitThink(text) {
  if (!text || !text.includes("<think>")) return { answer: text || "", think: "", open: false };
  let rest = text;
  let answer = "";
  let think = "";
  let open = false;
  while (rest) {
    const start = rest.indexOf("<think>");
    if (start < 0) { answer += rest; break; }
    answer += rest.slice(0, start);
    rest = rest.slice(start + 7);
    const end = rest.indexOf("</think>");
    if (end < 0) { think += rest; open = true; break; }
    think += `${think ? "\n\n" : ""}${rest.slice(0, end)}`;
    rest = rest.slice(end + 8);
  }
  return { answer: answer.trim(), think: think.trim(), open };
}
