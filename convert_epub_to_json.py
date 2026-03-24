#!/usr/bin/env python3
"""Convert source documents into a static JSON payload for the reader.

Supported inputs:
- HTML full-text dictionary (preferred for this project)
"""

from __future__ import annotations

import json
import re
import sys
from html import unescape
from pathlib import Path
from typing import Dict, List, Tuple


ALPHABET = [chr(code) for code in range(ord("A"), ord("Z") + 1)]


def sanitize_text(text: str) -> str:
    text = unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_headword(headword: str) -> str:
    cleaned = headword.upper()
    cleaned = cleaned.replace("TO ", "")
    cleaned = re.sub(r"[^A-Z]", "", cleaned)
    return cleaned


def letter_for_headword(headword: str) -> str:
    normalized = normalize_headword(headword)
    if normalized and normalized[0] in ALPHABET:
        return normalized[0]
    return "#"


def parse_entries_from_html(raw_html: str) -> List[Tuple[str, str]]:
    # The dictionary text is mainly inside p3/s1 paragraphs.
    paragraph_pattern = re.compile(
        r'<p[^>]*class="p3"[^>]*>\s*<span[^>]*class="s1"[^>]*>(.*?)</span>\s*</p>',
        re.IGNORECASE | re.DOTALL,
    )
    paragraphs = [sanitize_text(re.sub(r"<[^>]+>", " ", item)) for item in paragraph_pattern.findall(raw_html)]
    combined = " ".join(item for item in paragraphs if item)

    # Normalize obvious OCR separators/noise.
    combined = combined.replace("■", " ")
    combined = re.sub(r"\s+", " ", combined).strip()

    # Entry boundaries usually appear as:
    # "WORD, ...", "WORD*, ...", "WORD §*, ...", or "To WORD, ..."
    # Johnson/OCR often puts a space before §* (e.g. "SIMULATE §*, slm'-u-latc.").
    _hw = r"[A-Z][A-Z' \-]{1,40}"
    _marks = r"(?:(?:\*)|(?:\s*§\*?))?"
    boundary = re.compile(rf"(?=(?:^|\s)(?:To\s+)?{_hw}{_marks},\s)")
    chunks = [chunk.strip() for chunk in boundary.split(combined) if chunk.strip()]

    entries: List[Tuple[str, str]] = []
    headword_pattern = re.compile(rf"^(?:To\s+)?({_hw}){_marks},\s*(.+)$")
    for chunk in chunks:
        chunk = re.sub(r"\s+", " ", chunk).strip()
        match = headword_pattern.match(chunk)
        if not match:
            continue
        headword = sanitize_text(match.group(1))
        definition = sanitize_text(match.group(2))
        if len(headword) < 2 or len(definition) < 8:
            continue
        entries.append((headword, definition))

    return entries


def build_dictionary_payload(in_html: Path) -> Dict[str, object]:
    raw_html = in_html.read_text(encoding="utf-8", errors="replace")
    entries = parse_entries_from_html(raw_html)

    by_letter: Dict[str, List[Dict[str, str]]] = {letter: [] for letter in ALPHABET}
    by_letter["#"] = []

    for headword, definition in entries:
        letter = letter_for_headword(headword)
        by_letter.setdefault(letter, []).append({"headword": headword, "definition": definition})

    chapters = []
    for letter in ALPHABET:
        letter_entries = by_letter[letter]
        if not letter_entries:
            continue
        entry_html = []
        for item in letter_entries:
            entry_html.append(
                "<article class=\"dict-entry\">"
                f"<h3>{item['headword']}</h3>"
                f"<p>{item['definition']}</p>"
                "</article>"
            )
        chapters.append(
            {
                "id": f"letter-{letter}",
                "title": letter,
                "html": "".join(entry_html),
                "text": f"{letter} ({len(letter_entries)} entries)",
                "entryCount": len(letter_entries),
            }
        )

    payload: Dict[str, object] = {
        "metadata": {
            "title": "A Dictionary of the English Language",
            "creator": "Samuel Johnson",
            "language": "en",
            "sourceFile": in_html.name,
        },
        "stats": {
            "entryCount": len(entries),
            "letterCount": len([letter for letter in ALPHABET if by_letter[letter]]),
            "chapterCount": len(chapters),
        },
        "chapters": chapters,
        "letters": {letter: by_letter[letter] for letter in ALPHABET if by_letter[letter]},
    }
    return payload


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: python3 convert_epub_to_json.py <input.html> <output.json>")
        return 1

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    if not input_path.exists():
        print(f"Input not found: {input_path}")
        return 1

    if input_path.suffix.lower() not in {".html", ".htm", ".xhtml"}:
        print("This converter currently expects an HTML dictionary source.")
        return 1

    payload = build_dictionary_payload(input_path)
    output_path.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
    print(
        "Wrote dictionary JSON:",
        f"{payload['stats']['entryCount']} entries,",
        f"{payload['stats']['chapterCount']} letter sections -> {output_path}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
