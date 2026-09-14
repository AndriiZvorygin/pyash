function escapeHtml(value = "") {
  return String(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

/** Render one agenda item per top-level TOC row with its Stage 3 children nested below it. */
export function renderAgendaPreviewToc({ utilityRows = [], sections = [] } = {}) {
  const utilityHtml = utilityRows
    .filter((row) => String(row?.href || "").trim() && String(row?.label || "").trim())
    .map((row) => `<li><a href="${escapeHtml(row.href)}">${escapeHtml(row.label)}</a></li>`)
    .join("");
  const sectionHtml = sections
    .filter((section) => String(section?.id || "").trim() && String(section?.heading || "").trim())
    .map((section) => {
      const children = (Array.isArray(section.subsections) ? section.subsections : [])
        .filter((child) => String(child?.id || "").trim())
        .map((child) => `<li><a href="#${escapeHtml(child.id)}">${escapeHtml(child.title || "Subsection")}</a></li>`)
        .join("");
      const childList = children ? `<ol class="toc-children">${children}</ol>` : "";
      return `<li><a href="#${escapeHtml(section.id)}">${escapeHtml(section.heading)}</a>${childList}</li>`;
    })
    .join("");
  return `<nav class="toc" aria-label="Transcript topics and sections"><ol>${utilityHtml}${sectionHtml}</ol></nav>`;
}

