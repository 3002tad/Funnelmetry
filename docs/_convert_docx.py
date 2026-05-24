#!/usr/bin/env python3
"""Convert docx in docs/ to markdown. Re-run after updating .docx sources."""
from __future__ import annotations

import re
import sys
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph


def iter_block_items(parent):
    from docx.document import Document as Doc

    parent_elm = parent.element.body if isinstance(parent, Doc) else parent._element
    for child in parent_elm.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, parent)
        elif child.tag == qn("w:tbl"):
            yield Table(child, parent)


def escape_cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ").strip()


def dedupe_row_cells(row) -> list[str]:
    seen: list[str] = []
    for cell in row.cells:
        t = escape_cell(cell.text)
        if seen and seen[-1] == t:
            continue
        seen.append(t)
    return seen


def table_to_md(table: Table) -> str:
    rows = [dedupe_row_cells(row) for row in table.rows]
    if not rows:
        return ""
  # Single-cell banner (common in these docs)
    if len(rows) == 1 and len(rows[0]) == 1 and rows[0][0]:
        return f"> {rows[0][0]}"
    ncol = max(len(r) for r in rows)
    rows = [r + [""] * (ncol - len(r)) for r in rows]
    lines = ["| " + " | ".join(r) + " |" for r in rows]
    if len(lines) < 2:
        return "\n".join(lines)
    sep = "| " + " | ".join(["---"] * ncol) + " |"
    return "\n".join([lines[0], sep, *lines[1:]])


def style_to_heading(style_name: str) -> int | None:
    if not style_name:
        return None
    m = re.search(r"Heading\s*(\d+)", style_name, re.I)
    return int(m.group(1)) if m else None


def para_to_md(p: Paragraph) -> str:
    text = p.text.strip()
    if not text:
        return ""
    level = style_to_heading(p.style.name if p.style else "")
    if level:
        return f"{'#' * level} {text}"
    if p.style and p.style.name == "List Bullet":
        return f"- {text}"
    return text


def docx_to_md(path: Path) -> str:
    doc = Document(path)
    title = path.stem.replace("_", " ")
    parts: list[str] = [f"# {title}\n"]
    for block in iter_block_items(doc):
        if isinstance(block, Paragraph):
            line = para_to_md(block)
            if line:
                parts.append(line)
        else:
            md = table_to_md(block)
            if md:
                parts.append(md)
    return "\n\n".join(parts) + "\n"


def main() -> None:
    docs = Path(__file__).parent
    for docx in sorted(docs.glob("*.docx")):
        try:
            md = docx_to_md(docx)
        except Exception as e:
            print(f"skip {docx.name}: {e}", file=sys.stderr)
            continue
        out = docs / f"{docx.stem}.md"
        out.write_text(md, encoding="utf-8")
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
