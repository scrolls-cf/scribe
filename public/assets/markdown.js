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
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');
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
  let listType = null;
  let listDepth = 0;

  function closeList() {
    if (listType) {
      out.push(listType === "ol" ? "</ol>" : "</ul>");
      listType = null;
      listDepth = 0;
    }
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
      closeList();
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
      closeList();
      const table = renderTable(lines, i);
      out.push(table.html);
      i = table.next - 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      const tag = level === 1 ? "h2" : `h${Math.min(level, 6)}`;
      const cls = level === 1 ? ' class="prose-title"' : "";
      out.push(`<${tag}${cls}>${inline(heading[2])}</${tag}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      closeList();
      out.push("<hr>");
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeList();
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
      if (listType !== "ul" || listDepth !== depth) {
        closeList();
        out.push('<ul class="prose-tasks">');
        listType = "ul";
        listDepth = depth;
      }
      const itemClass = done ? "prose-task prose-task--done" : "prose-task";
      const label = done ? "Completed" : "Incomplete";
      out.push(
        `<li class="${itemClass}" aria-label="${label}: ${escapeHtml(task[3])}"><span class="prose-task-box" aria-hidden="true">${done ? "✓" : "○"}</span>${inline(task[3])}</li>`,
      );
      continue;
    }

    const ul = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (ul) {
      const depth = Math.floor(ul[1].length / 2);
      if (listType !== "ul" || listDepth !== depth) {
        closeList();
        out.push("<ul>");
        listType = "ul";
        listDepth = depth;
      }
      out.push(`<li>${inline(ul[2])}</li>`);
      continue;
    }

    const ol = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (ol) {
      const depth = Math.floor(ol[1].length / 2);
      if (listType !== "ol" || listDepth !== depth) {
        closeList();
        out.push("<ol>");
        listType = "ol";
        listDepth = depth;
      }
      out.push(`<li>${inline(ol[2])}</li>`);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }

  flushCode();
  closeList();
  return out.join("\n");
}
