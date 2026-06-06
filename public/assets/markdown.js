function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Strip YAML frontmatter agents often paste from DESIGN.md-style specs. */
export function stripFrontmatter(source) {
  if (!source.startsWith("---")) return source;
  const end = source.indexOf("\n---", 3);
  if (end === -1) return source;
  return source.slice(end + 4).replace(/^\s+/, "");
}

function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const external = /^https?:\/\//i.test(href);
    const target = external ? ' target="_blank"' : "";
    return `<a href="${href}" rel="noopener noreferrer"${target}>${label}</a>`;
  });
  return s;
}

function isTableRow(line) {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.includes("|");
}

function isTableSeparator(line) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line.trim());
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderTable(lines, start) {
  const header = parseTableRow(lines[start]);
  const bodyRows = [];
  let i = start + 2;
  while (i < lines.length && isTableRow(lines[i]) && !isTableSeparator(lines[i])) {
    bodyRows.push(parseTableRow(lines[i]));
    i += 1;
  }
  const thead = `<thead><tr>${header.map((c) => `<th scope="col">${inline(c)}</th>`).join("")}</tr></thead>`;
  const tbody = bodyRows.length
    ? `<tbody>${bodyRows
        .map(
          (row) =>
            `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody>`
    : "";
  return { html: `<div class="prose-table-wrap"><table class="prose-table">${thead}${tbody}</table></div>`, next: i };
}

export function renderMarkdown(source) {
  const text = stripFrontmatter(source.replace(/\r\n/g, "\n"));
  const lines = text.split("\n");
  const out = [];
  let inCode = false;
  let codeLang = "";
  let codeBuf = [];
  /** @type {{ type: "ul" | "ol", depth: number, listClass?: string }[]} */
  let listStack = [];

  function finishOpenItem() {
    const frame = listStack[listStack.length - 1];
    if (frame?.openItem) {
      out.push("</li>");
      frame.openItem = false;
    }
  }

  function closeListLevel() {
    finishOpenItem();
    const frame = listStack.pop();
    if (!frame) return;
    out.push(frame.type === "ol" ? "</ol>" : "</ul>");
  }

  function closeAllLists() {
    while (listStack.length) closeListLevel();
  }

  function closeListsAbove(depth) {
    while (listStack.length && listStack[listStack.length - 1].depth > depth) {
      closeListLevel();
    }
  }

  function openListItem(type, depth, listClass, liAttrs, content) {
    closeListsAbove(depth);

    const top = listStack[listStack.length - 1];
    if (top && top.depth === depth) {
      if (top.type !== type || top.listClass !== listClass) {
        closeListLevel();
      } else {
        finishOpenItem();
      }
    }

    while (!listStack.length || listStack[listStack.length - 1].depth < depth) {
      const nextDepth = listStack.length ? listStack[listStack.length - 1].depth + 1 : 0;
      const tag = type === "ol" ? "ol" : "ul";
      const cls = listClass && nextDepth === depth ? ` class="${listClass}"` : "";
      out.push(`<${tag}${cls}>`);
      listStack.push({ type, depth: nextDepth, listClass: listClass || "", openItem: false });
    }

    out.push(`<li${liAttrs}>`);
    out.push(content);
    listStack[listStack.length - 1].openItem = true;
  }

  function flushCode() {
    if (!inCode) return;
    const langClass = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
    out.push(`<pre><code${langClass}>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
    codeBuf = [];
    codeLang = "";
    inCode = false;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (line.startsWith("```")) {
      closeAllLists();
      if (inCode) {
        flushCode();
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      closeAllLists();
      const table = renderTable(lines, i);
      out.push(table.html);
      i = table.next - 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeAllLists();
      const level = heading[1].length;
      const tag = level === 1 ? "h2" : `h${Math.min(level, 6)}`;
      const cls = level === 1 ? ' class="prose-title"' : "";
      out.push(`<${tag}${cls}>${inline(heading[2])}</${tag}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      closeAllLists();
      out.push("<hr>");
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeAllLists();
      const quoteLines = [quote[1]];
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1])) {
        i += 1;
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
      }
      out.push(`<blockquote><p>${quoteLines.map((l) => inline(l)).join("<br>")}</p></blockquote>`);
      continue;
    }

    const task = line.match(/^(\s*)[-*]\s+\[( |x|X)\]\s+(.+)$/);
    if (task) {
      const depth = Math.floor(task[1].length / 2);
      const done = task[2].toLowerCase() === "x";
      const itemClass = done ? "prose-task prose-task--done" : "prose-task";
      const label = done ? "Completed" : "Incomplete";
      openListItem(
        "ul",
        depth,
        "prose-tasks",
        ` class="${itemClass}" aria-label="${label}: ${escapeHtml(task[3])}"`,
        `<span class="prose-task-box" aria-hidden="true">${done ? "✓" : "○"}</span>${inline(task[3])}`,
      );
      continue;
    }

    const ul = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (ul) {
      const depth = Math.floor(ul[1].length / 2);
      openListItem("ul", depth, "", "", inline(ul[2]));
      continue;
    }

    const ol = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (ol) {
      const depth = Math.floor(ol[1].length / 2);
      openListItem("ol", depth, "", "", inline(ol[2]));
      continue;
    }

    if (!line.trim()) {
      closeAllLists();
      continue;
    }

    closeAllLists();
    out.push(`<p>${inline(line)}</p>`);
  }

  flushCode();
  closeAllLists();
  return out.join("\n");
}
