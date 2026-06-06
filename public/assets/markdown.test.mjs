import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderMarkdown, stripFrontmatter } from "./markdown.js";

describe("stripFrontmatter", () => {
  it("removes yaml frontmatter", () => {
    const body = stripFrontmatter("---\nname: foo\n---\n\n# Title\n");
    assert.match(body, /^# Title/);
  });
});

describe("renderMarkdown", () => {
  it("renders tables", () => {
    const html = renderMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    assert.match(html, /<table class="prose-table"/);
    assert.match(html, /<th scope="col">A<\/th>/);
    assert.match(html, /<td>2<\/td>/);
  });

  it("demotes h1 to prose-title h2", () => {
    const html = renderMarkdown("# Spec title");
    assert.match(html, /<h2 class="prose-title">Spec title<\/h2>/);
  });

  it("renders task lists", () => {
    const html = renderMarkdown("- [x] Done\n- [ ] Todo");
    assert.match(html, /prose-task--done/);
    assert.match(html, /aria-label="Completed: Done"/);
    assert.match(html, /aria-label="Incomplete: Todo"/);
  });

  it("strips frontmatter before render", () => {
    const html = renderMarkdown("---\ntitle: x\n---\n\n## Body");
    assert.doesNotMatch(html, /title: x/);
    assert.match(html, /<h2>Body<\/h2>/);
  });
});
