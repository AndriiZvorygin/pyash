import MarkdownIt from "markdown-it";
import { layoutSaddleInput } from "./coding_saddle.mjs";

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true
});

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  italic: "\u001b[3m",
  strike: "\u001b[9m",
  code: "\u001b[36m",
  link: "\u001b[4;36m",
  heading: "\u001b[1;36m",
  quote: "\u001b[2m",
  list: "\u001b[36m",
  fence: "\u001b[36m",
  title: "\u001b[1;36m",
  status: "\u001b[2m",
  prompt: "\u001b[1;32m",
  activity: "\u001b[1;33m",
  toolCall: "\u001b[1;35m",
  toolResult: "\u001b[35m",
  toolApproval: "\u001b[1;33m",
  toolOther: "\u001b[35m"
};

export function stripTerminalControlSequences(value = "") {
  return String(value ?? "")
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\)|[@-_])/gu, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
}

function styleText(text, styles, color) {
  const codes = [...new Set(styles)].map((style) => ANSI[style]).filter(Boolean);
  if (!color || !codes.length || !text) return text;
  return `${codes.join("")}${text}${ANSI.reset}`;
}

function inlineSegments(tokens = []) {
  const segments = [];
  const stack = [];
  const add = (text, extra = []) => {
    const safe = stripTerminalControlSequences(text);
    if (safe) segments.push({ text: safe, styles: [...stack, ...extra] });
  };
  const linkStack = [];
  for (const token of tokens) {
    if (token.type === "strong_open") stack.push("bold");
    else if (token.type === "em_open") stack.push("italic");
    else if (token.type === "s_open") stack.push("strike");
    else if (token.type === "link_open") {
      stack.push("link");
      linkStack.push(token.attrGet("href") || "");
    } else if (token.type === "strong_close") stack.splice(stack.lastIndexOf("bold"), 1);
    else if (token.type === "em_close") stack.splice(stack.lastIndexOf("italic"), 1);
    else if (token.type === "s_close") stack.splice(stack.lastIndexOf("strike"), 1);
    else if (token.type === "link_close") {
      stack.splice(stack.lastIndexOf("link"), 1);
      const href = linkStack.pop();
      if (href) add(` (${href})`, ["link"]);
    } else if (token.type === "text" || token.type === "html_inline") add(token.content);
    else if (token.type === "code_inline") add(token.content, ["code"]);
    else if (token.type === "image") add(token.content || token.attrGet("alt") || "image", ["italic"]);
    else if (token.type === "softbreak") add(" ");
    else if (token.type === "hardbreak") add("\n");
  }
  return segments;
}

function plainInline(tokens = []) {
  return inlineSegments(tokens).map((segment) => segment.text).join("");
}

function wrapSegments(segments, width, {
  prefix = "",
  continuationPrefix = prefix,
  prefixStyle = null,
  continuationStyle = prefixStyle,
  baseStyle = null
} = {}) {
  const limit = Math.max(8, Number(width) || 80);
  const chars = [];
  if (prefix) {
    for (const character of prefix) chars.push({ character, styles: prefixStyle ? [prefixStyle] : [] });
  }
  for (const segment of segments) {
    for (const character of segment.text) {
      chars.push({ character, styles: [...segment.styles, ...(baseStyle ? [baseStyle] : [])] });
    }
  }

  const lines = [[]];
  const addLine = () => lines.push(continuationPrefix
    ? [...[...continuationPrefix].map((character) => ({ character, styles: continuationStyle ? [continuationStyle] : [] }))]
    : []);
  let index = 0;
  while (index < chars.length) {
    const entry = chars[index];
    if (entry.character === "\n") {
      addLine();
      index += 1;
      continue;
    }
    let end = index + 1;
    const isWhitespace = /\s/u.test(entry.character);
    while (end < chars.length && chars[end].character !== "\n" && /\s/u.test(chars[end].character) === isWhitespace) end += 1;
    const word = chars.slice(index, end);
    const current = lines.at(-1);
    if (isWhitespace && current.length + word.length > limit) {
      index = end;
      continue;
    }
    if (isWhitespace && current.length === (lines.length === 1 ? prefix.length : continuationPrefix.length)) {
      index = end;
      continue;
    }
    const currentPrefixLength = lines.length === 1 ? prefix.length : continuationPrefix.length;
    if (!isWhitespace && current.length + word.length > limit && current.length > currentPrefixLength) addLine();
    for (const character of word) {
      if (lines.at(-1).length >= limit && !isWhitespace) addLine();
      lines.at(-1).push(character);
    }
    index = end;
  }

  return lines.map((line) => {
    let result = "";
    let previous = "";
    for (const item of line) {
      const next = [...new Set(item.styles)].sort().join("+");
      if (next !== previous) {
        if (previous) result += ANSI.reset;
        if (next) result += next.split("+").map((style) => ANSI[style]).filter(Boolean).join("");
        previous = next;
      }
      result += item.character;
    }
    if (previous) result += ANSI.reset;
    return result;
  });
}

export function renderSaddleMarkdown(value = "", { width = 80, color = true } = {}) {
  const source = stripTerminalControlSequences(value);
  const tokens = markdown.parse(source, {});
  const lines = [];
  const listStack = [];
  let quoteDepth = 0;
  let headingLevel = 0;
  let listPrefix = null;
  let table = false;
  let tableRow = null;
  let tableCell = "";
  let tableHeader = false;
  const blank = () => {
    if (lines.length && lines.at(-1) !== "") lines.push("");
  };
  const appendInline = (inlineToken) => {
    if (table && tableRow) {
      tableCell = plainInline(inlineToken.children || []);
      return;
    }
    const quotePrefix = quoteDepth ? `${"│ ".repeat(Math.min(quoteDepth, 3))}` : "";
    const prefix = listPrefix === null ? quotePrefix : `${quotePrefix}${listPrefix}`;
    const continuationPrefix = listPrefix === null
      ? quotePrefix
      : `${quotePrefix}${" ".repeat(listPrefix.length)}`;
    const prefixStyle = quoteDepth ? "quote" : (listPrefix !== null ? "list" : null);
    const rendered = wrapSegments(inlineSegments(inlineToken.children || []), width, {
      prefix,
      continuationPrefix,
      prefixStyle,
      continuationStyle: prefixStyle,
      baseStyle: headingLevel ? "heading" : null
    });
    if (color) lines.push(...rendered);
    else lines.push(...rendered.map(stripTerminalControlSequences));
    headingLevel = 0;
    listPrefix = null;
    blank();
  };

  for (const token of tokens) {
    if (token.type === "heading_open") headingLevel = Number(token.tag.slice(1)) || 1;
    else if (token.type === "paragraph_open") { /* inline token carries the paragraph body */ }
    else if (token.type === "bullet_list_open") listStack.push({ ordered: false, index: 0 });
    else if (token.type === "ordered_list_open") listStack.push({ ordered: true, index: Number(token.attrGet("start")) || 1 });
    else if (token.type === "bullet_list_close" || token.type === "ordered_list_close") listStack.pop();
    else if (token.type === "list_item_open") {
      const list = listStack.at(-1) || { ordered: false, index: 0 };
      listPrefix = list.ordered ? `${list.index++}. ` : "• ";
    } else if (token.type === "blockquote_open") quoteDepth += 1;
    else if (token.type === "blockquote_close") { quoteDepth = Math.max(0, quoteDepth - 1); blank(); }
    else if (token.type === "fence" || token.type === "code_block") {
      blank();
      const codeLines = stripTerminalControlSequences(token.content).replace(/\n$/u, "").split("\n");
      for (const line of codeLines) {
        const safeLine = line.length > width - 2 ? `${line.slice(0, Math.max(1, width - 3))}…` : line;
        lines.push(styleText(`  ${safeLine}`, ["fence"], color));
      }
      blank();
    } else if (token.type === "hr") {
      blank();
      lines.push(styleText("─".repeat(Math.max(1, Math.min(width, 40))), ["quote"], color));
      blank();
    } else if (token.type === "table_open") table = true;
    else if (token.type === "table_close") { table = false; tableRow = null; blank(); }
    else if (token.type === "thead_open") tableHeader = true;
    else if (token.type === "thead_close") tableHeader = false;
    else if (token.type === "tr_open") tableRow = [];
    else if (token.type === "tr_close" && tableRow) {
      const row = tableRow.join("  │  ");
      lines.push(styleText(row.length > width ? `${row.slice(0, Math.max(1, width - 1))}…` : row, tableHeader ? ["bold"] : [], color));
      tableRow = null;
    } else if (token.type === "th_open" || token.type === "td_open") tableCell = "";
    else if (token.type === "th_close" || token.type === "td_close") tableRow?.push(tableCell);
    else if (token.type === "inline") appendInline(token);
  }
  while (lines.at(-1) === "") lines.pop();
  return lines.length ? lines : [""];
}

function wrapPlainLine(value, width) {
  const text = stripTerminalControlSequences(value);
  const lines = [];
  let line = "";
  for (const word of text.split(/(\s+)/u)) {
    if (!word) continue;
    if (/^\s+$/u.test(word) && !line) continue;
    if (line.length + word.length > width && line) {
      lines.push(line);
      line = "";
      if (/^\s+$/u.test(word)) continue;
    }
    for (const character of word) {
      if (line.length >= width) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  lines.push(line);
  return lines;
}

function visibleLength(value) {
  return stripTerminalControlSequences(value).length;
}

function fitLine(value, width, color, style = null) {
  const plain = stripTerminalControlSequences(value);
  const fitted = plain.length > width ? `${plain.slice(0, Math.max(0, width - 1))}…` : plain;
  if (plain.length > width || style) return styleText(fitted, style ? [style] : [], color);
  return value;
}

function plainLineRole(line) {
  if (line.startsWith("you> ")) return "prompt";
  const toolLabel = /^\[tool(?:\s+([^\]]+))?\]/iu.exec(line)?.[1]?.toLowerCase();
  if (toolLabel === "call") return "toolCall";
  if (toolLabel === "result") return "toolResult";
  if (toolLabel === "approval") return "toolApproval";
  return toolLabel ? "toolOther" : null;
}

function renderHistory(items, width, color) {
  const lines = [];
  for (const item of items) {
    const cacheKey = `${width}:${color ? "color" : "plain"}`;
    if (item.cacheKey !== cacheKey) {
      item.cacheKey = cacheKey;
      item.renderedLines = item.kind === "markdown"
        ? renderSaddleMarkdown(item.text, { width, color })
        : stripTerminalControlSequences(item.text).split("\n").flatMap((line) => {
          const role = plainLineRole(line);
          return wrapPlainLine(line, width).map((wrapped) => styleText(wrapped, role ? [role] : [], color));
        });
    }
    if (item.kind === "markdown") {
      lines.push(...item.renderedLines);
      lines.push("");
    } else {
      lines.push(...item.renderedLines);
    }
  }
  return lines;
}

function footerHelpLines(width) {
  return wrapPlainLine("Enter send/queue · Shift+Enter/Ctrl+J newline · paste keeps newlines · Tab /cmds · PgUp/PgDn scroll · Ctrl+C interrupt · Ctrl+D exit", width);
}

function statusDisplayLines(value, width, height, usage = "") {
  const compact = String(value || "starting...")
    .split(" | ")
    .filter((part) => !part.startsWith("cwd: "))
    .join("  ·  ");
  const maxRows = Math.max(1, Math.min(5, height - 6));
  const lines = wrapPlainLine(compact, width).slice(0, Math.min(3, maxRows));
  if (usage && lines.length < maxRows) {
    lines.push(...wrapPlainLine(usage, width).slice(0, maxRows - lines.length));
  }
  return lines;
}

export function createSaddleTerminalUi({ output = process.stdout, maxItems = 4000, color } = {}) {
  const enabledColor = color ?? (Boolean(output.isTTY) && !process.env.NO_COLOR && process.env.TERM !== "dumb");
  const items = [];
  let status = "";
  let usage = "";
  let activity = "ready";
  let input = { value: "", cursor: 0 };
  let promptLabel = "pyash> ";
  let scrollOffset = 0;
  let active = false;
  let cursorRow = 1;
  let cursorColumn = 1;

  const columns = () => Math.max(20, Number(output.columns) || 80);
  const rows = () => Math.max(8, Number(output.rows) || 24);
  const append = (kind, text) => {
    items.push({ kind, text: stripTerminalControlSequences(text) });
    if (items.length > maxItems) items.splice(0, items.length - maxItems);
    draw();
  };
  const draw = () => {
    if (!active) return;
    const width = columns() - 1;
    const height = rows();
    const statusLines = statusDisplayLines(status, width, height, usage);
    const headerRows = 1 + statusLines.length;
    const inputLayout = layoutSaddleInput({
      value: input.value,
      cursor: input.cursor,
      label: promptLabel,
      columns: columns()
    });
    const helpLines = footerHelpLines(width);
    const inputRows = Math.max(1, Math.min(inputLayout.rowCount, 5, height - headerRows - 2 - helpLines.length));
    const maxTranscriptRows = Math.max(1, height - headerRows - 1 - inputRows - helpLines.length);
    const content = renderHistory(items, width, enabledColor);
    const maxOffset = Math.max(0, content.length - maxTranscriptRows);
    scrollOffset = Math.min(scrollOffset, maxOffset);
    const end = Math.max(0, content.length - scrollOffset);
    const start = Math.max(0, end - maxTranscriptRows);
    const transcript = content.slice(start, end);
    while (transcript.length < maxTranscriptRows) transcript.unshift("");

    let visibleStart = Math.max(0, inputLayout.cursorRow - inputRows + 1);
    visibleStart = Math.min(visibleStart, Math.max(0, inputLayout.rowCount - inputRows));
    const visibleInput = inputLayout.lines.slice(visibleStart, visibleStart + inputRows);
    while (visibleInput.length < inputRows) visibleInput.push("");
    const cursorRelativeRow = Math.max(0, inputLayout.cursorRow - visibleStart);

    const screen = [
      fitLine("Pyash coding saddle", width, enabledColor, "title"),
      ...statusLines.map((line) => fitLine(line, width, enabledColor, "status")),
      ...transcript.map((line) => fitLine(line, width, false)),
      fitLine(scrollOffset
        ? `${activity || "ready"}  ·  scrollback (PgDn to return)`
        : (activity || "ready"), width, enabledColor, activity === "ready" ? "status" : "activity"),
      ...visibleInput.map((line) => fitLine(line, width, enabledColor)),
      ...helpLines.map((line) => fitLine(line, width, enabledColor, "status"))
    ];
    while (screen.length < height) screen.splice(height - 1, 0, "");
    screen.length = height;

    output.write("\u001b[?25l\u001b[H");
    for (let index = 0; index < screen.length; index += 1) {
      output.write(`\u001b[2K${screen[index]}`);
      if (index < screen.length - 1) output.write("\u001b[1B\r");
    }
    const inputFirstRow = headerRows + maxTranscriptRows + 1;
    cursorRow = Math.min(height, inputFirstRow + cursorRelativeRow + 1);
    cursorColumn = Math.min(columns(), Math.max(1, inputLayout.cursorColumn + 1));
    output.write(`\u001b[${cursorRow};${cursorColumn}H\u001b[?25h`);
  };

  return {
    enter() {
      if (active) return;
      active = true;
      output.write("\u001b[?1049h\u001b[?2004h\u001b[>1u\u001b[?25l\u001b[2J\u001b[H");
      draw();
    },
    exit() {
      if (!active) return;
      active = false;
      output.write("\u001b[?2004l\u001b[<u\u001b[0m\u001b[?25h\u001b[?1049l");
    },
    draw,
    writeLine(text = "") {
      append("text", String(text));
    },
    writeMarkdown(text = "") {
      append("markdown", String(text));
    },
    beginMarkdownStream() {
      const item = { kind: "markdown", text: "", cacheKey: null, renderedLines: [] };
      items.push(item);
      if (items.length > maxItems) items.splice(0, items.length - maxItems);
      draw();
      return item;
    },
    appendMarkdownStream(item, text = "") {
      if (!item || !items.includes(item)) return;
      item.text += stripTerminalControlSequences(text);
      item.cacheKey = null;
      draw();
    },
    replaceMarkdownStream(item, text = "") {
      if (!item || !items.includes(item)) return;
      item.text = stripTerminalControlSequences(text);
      item.cacheKey = null;
      draw();
    },
    finishMarkdownStream(item, { precedingText = "" } = {}) {
      const itemIndex = items.indexOf(item);
      if (itemIndex < 0) return;
      let start = itemIndex;
      if (precedingText && itemIndex > 0) {
        const preceding = items[itemIndex - 1];
        if (preceding.kind === "text" && preceding.text === precedingText) start -= 1;
      }
      const completed = items.splice(start, itemIndex - start + 1);
      items.push(...completed);
      if (items.length > maxItems) items.splice(0, items.length - maxItems);
      scrollOffset = 0;
      draw();
    },
    clearHistory() {
      items.length = 0;
      scrollOffset = 0;
      draw();
    },
    setStatus(value = "") {
      status = stripTerminalControlSequences(value);
      draw();
    },
    setUsage(value = "") {
      usage = stripTerminalControlSequences(value);
      draw();
    },
    setBusy(value) {
      status = status.replace(/state: (?:ready|running)/u, `state: ${value ? "running" : "ready"}`);
      draw();
    },
    setActivity(value = "") {
      activity = stripTerminalControlSequences(value) || "ready";
      draw();
    },
    setInput(state = {}, label = promptLabel) {
      input = {
        value: stripTerminalControlSequences(state.value ?? ""),
        cursor: Math.max(0, Math.min(String(state.value ?? "").length, Number(state.cursor) || 0))
      };
      promptLabel = String(label || "pyash> ");
      draw();
    },
    scrollBy(amount) {
      const contentRows = renderHistory(items, columns() - 1, enabledColor).length;
      const width = columns() - 1;
      const headerRows = 1 + statusDisplayLines(status, width, rows(), usage).length;
      const helpLines = footerHelpLines(width);
      const inputRows = Math.max(1, Math.min(layoutSaddleInput({ value: input.value, cursor: input.cursor, label: promptLabel, columns: columns() }).rowCount, 5, rows() - headerRows - 2 - helpLines.length));
      const page = Math.max(1, rows() - headerRows - 1 - inputRows - helpLines.length);
      const maxOffset = Math.max(0, contentRows - page);
      scrollOffset = Math.max(0, Math.min(maxOffset, scrollOffset + Number(amount || 0)));
      draw();
    },
    scrollToBottom() {
      scrollOffset = 0;
      draw();
    },
    getState() {
      return { active, status, usage, activity, itemCount: items.length, scrollOffset, cursorRow, cursorColumn };
    },
    getVisibleLength: visibleLength
  };
}
