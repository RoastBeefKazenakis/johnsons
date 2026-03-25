const BOOK_JSON = "./book.json";

const viewer = document.getElementById("viewer");
const titleEl = document.getElementById("bookTitle");
const tocList = document.getElementById("tocList");
const tocPanel = document.getElementById("tocPanel");
const tocToggle = document.getElementById("tocToggle");
const tocClose = document.getElementById("tocClose");
const themeToggle = document.getElementById("themeToggle");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const fontSizeInput = document.getElementById("fontSize");
const progressLabel = document.getElementById("progressLabel");
const progressBar = document.getElementById("progressBar");
const searchInput = document.getElementById("searchInput");
const searchClear = document.getElementById("searchClear");

let bookData;
let chapterIndex = 0;
let flatEntries = [];
let isSearchMode = false;

function updateProgress() {
  if (!bookData || !bookData.chapters || bookData.chapters.length === 0) {
    return;
  }
  const pct = chapterIndex / Math.max(1, bookData.chapters.length - 1);
  const rounded = Math.max(0, Math.min(100, Math.round(pct * 100)));
  progressLabel.textContent = `Progress: ${rounded}%`;
  progressBar.style.width = `${rounded}%`;
}

function setTheme(isDark) {
  document.body.classList.toggle("dark", isDark);
  localStorage.setItem("reader-theme", isDark ? "dark" : "light");
}

function applyFontSize(scale) {
  viewer.style.fontSize = `${scale}%`;
  localStorage.setItem("reader-font-size", String(scale));
}

function renderChapter() {
  if (!bookData || !bookData.chapters || bookData.chapters.length === 0) {
    viewer.innerHTML = "<p>No chapters found in book.json.</p>";
    return;
  }

  const chapter = bookData.chapters[chapterIndex];
  isSearchMode = false;
  viewer.innerHTML = chapter.html || `<p>${chapter.text || ""}</p>`;
  updateProgress();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeForSearch(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function buildSearchIndex() {
  if (!bookData || !bookData.letters) {
    flatEntries = [];
    return;
  }

  flatEntries = [];
  Object.entries(bookData.letters).forEach(([letter, entries]) => {
    entries.forEach((entry) => {
      const headword = entry.headword || "";
      const definition = entry.definition || "";
      flatEntries.push({
        letter,
        headword,
        definition,
        headwordLower: headword.toLowerCase(),
        definitionLower: definition.toLowerCase(),
        headwordSearch: normalizeForSearch(headword),
        definitionSearch: normalizeForSearch(definition),
      });
    });
  });
}

function searchEntries(query) {
  const raw = query.trim();
  const normalized = raw.toLowerCase();
  const normalizedCompact = normalizeForSearch(raw);
  if (!normalized || !normalizedCompact) {
    renderChapter();
    return;
  }

  const exactHeadwordMatches = [];
  const prefixHeadwordMatches = [];
  const containsHeadwordMatches = [];
  const definitionMatches = [];

  const maxHeadwordResults = 40;
  const maxDefinitionResults = 40;

  for (const entry of flatEntries) {
    if (entry.headwordSearch === normalizedCompact) {
      exactHeadwordMatches.push(entry);
    } else if (entry.headwordSearch.startsWith(normalizedCompact)) {
      prefixHeadwordMatches.push(entry);
    } else if (entry.headwordSearch.includes(normalizedCompact)) {
      containsHeadwordMatches.push(entry);
    } else if (
      entry.definitionLower.includes(normalized) ||
      entry.definitionSearch.includes(normalizedCompact)
    ) {
      definitionMatches.push(entry);
    }
  }

  const headwordMatches = [
    ...exactHeadwordMatches,
    ...prefixHeadwordMatches,
    ...containsHeadwordMatches,
  ].slice(0, maxHeadwordResults);

  const matchedHeadwordSet = new Set(
    headwordMatches.map((entry) => `${entry.letter}::${entry.headword}`)
  );
  const filteredDefinitionMatches = definitionMatches
    .filter((entry) => !matchedHeadwordSet.has(`${entry.letter}::${entry.headword}`))
    .slice(0, maxDefinitionResults);

  const totalMatches = headwordMatches.length + filteredDefinitionMatches.length;
  isSearchMode = true;
  progressLabel.textContent = `Search: ${totalMatches} result${totalMatches === 1 ? "" : "s"}`;

  if (totalMatches === 0) {
    viewer.innerHTML = `<p class="search-meta">No entries found for <strong>${escapeHtml(query)}</strong>.</p>`;
    return;
  }

  const cardsFor = (entries) =>
    entries
    .map((entry) => {
      const snippet = escapeHtml(entry.definition.slice(0, 320));
      return `
        <article class="search-card">
          <h3>${escapeHtml(entry.headword)}</h3>
          <p class="search-snippet">${snippet}${entry.definition.length > 320 ? "..." : ""}</p>
          <button type="button" class="search-jump" data-letter="${entry.letter}">Open letter ${entry.letter}</button>
        </article>
      `;
    })
    .join("");

  const headwordSection = headwordMatches.length
    ? `
      <section class="search-results">
        <h2>Headword matches</h2>
        ${cardsFor(headwordMatches)}
      </section>
    `
    : "";

  const definitionSection = filteredDefinitionMatches.length
    ? `
      <section class="search-results">
        <h2>Definition matches</h2>
        ${cardsFor(filteredDefinitionMatches)}
      </section>
    `
    : "";

  viewer.innerHTML = `
    <p class="search-meta">Showing ${totalMatches} results for <strong>${escapeHtml(query)}</strong>.</p>
    ${headwordSection}
    ${definitionSection}
  `;

  viewer.querySelectorAll(".search-jump").forEach((button) => {
    button.addEventListener("click", () => {
      const letter = button.getAttribute("data-letter");
      const nextIndex = (bookData.chapters || []).findIndex((chapter) => chapter.title === letter);
      if (nextIndex >= 0) {
        chapterIndex = nextIndex;
        renderChapter();
        viewer.scrollTop = 0;
      }
    });
  });
}

function renderToc(chapters) {
  tocList.innerHTML = "";
  chapters.forEach((chapter, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toc-item";
    btn.textContent = chapter.label || "Untitled section";
    btn.addEventListener("click", () => {
      chapterIndex = idx;
      renderChapter();
      tocPanel.classList.add("hidden");
    });
    tocList.appendChild(btn);
  });
}

async function initReader() {
  try {
    if (window.location.protocol === "file:") {
      throw new Error("LOCAL_FILE_PROTOCOL");
    }

    const response = await fetch(BOOK_JSON, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not fetch ${BOOK_JSON}`);
    }
    bookData = await response.json();

    const metadata = bookData.metadata || {};
    titleEl.textContent = metadata.title
      ? `${metadata.title}${metadata.creator ? ` - ${metadata.creator}` : ""}`
      : "Book metadata unavailable";

    if (bookData.chapters && bookData.chapters.length > 0) {
      const tocFromLetters = (bookData.chapters || []).map((chapter) => {
        const letter = chapter.title || "";
        const entries = (bookData.letters && bookData.letters[letter]) || [];
        const count = entries.length;
        const firstWord = count > 0 ? entries[0].headword : "";
        const lastWord = count > 0 ? entries[count - 1].headword : "";
        const range =
          firstWord && lastWord ? ` - ${firstWord} ... ${lastWord}` : "";
        return {
          label: `${letter} (${count} entries)${range}`,
        };
      });
      renderToc(tocFromLetters);
    } else {
      tocList.innerHTML = "<p>No table of contents found.</p>";
    }

    buildSearchIndex();
    renderChapter();

    prevBtn.addEventListener("click", () => {
      if (isSearchMode) {
        return;
      }
      chapterIndex = Math.max(0, chapterIndex - 1);
      renderChapter();
    });
    nextBtn.addEventListener("click", () => {
      if (isSearchMode) {
        return;
      }
      chapterIndex = Math.min((bookData.chapters?.length || 1) - 1, chapterIndex + 1);
      renderChapter();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        if (isSearchMode) {
          return;
        }
        chapterIndex = Math.max(0, chapterIndex - 1);
        renderChapter();
      } else if (event.key === "ArrowRight") {
        if (isSearchMode) {
          return;
        }
        chapterIndex = Math.min((bookData.chapters?.length || 1) - 1, chapterIndex + 1);
        renderChapter();
      }
    });

    tocToggle.addEventListener("click", () => tocPanel.classList.toggle("hidden"));
    tocClose.addEventListener("click", () => tocPanel.classList.add("hidden"));

    const savedTheme = localStorage.getItem("reader-theme");
    setTheme(savedTheme === "dark");

    const savedFont = Number(localStorage.getItem("reader-font-size")) || 100;
    fontSizeInput.value = String(savedFont);
    applyFontSize(savedFont);

    fontSizeInput.addEventListener("input", () => {
      applyFontSize(Number(fontSizeInput.value));
    });

    let searchTimer;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const query = searchInput.value;
      searchClear.classList.toggle("hidden", query.trim() === "");
      searchTimer = setTimeout(() => searchEntries(query), 130);
    });

    searchClear.addEventListener("click", () => {
      searchInput.value = "";
      searchClear.classList.add("hidden");
      renderChapter();
    });

    themeToggle.addEventListener("click", () => {
      const nextThemeIsDark = !document.body.classList.contains("dark");
      setTheme(nextThemeIsDark);
    });
  } catch (error) {
    titleEl.textContent = "Failed to load JSON book.";
    if (String(error?.message) === "LOCAL_FILE_PROTOCOL") {
      viewer.innerHTML = `
        <div style="max-width: 720px;">
          <h2>Run this page from a local web server</h2>
          <p>This reader uses <code>fetch()</code> for <code>book.json</code>, which does not work over <code>file://</code>.</p>
          <p>From this folder, run:</p>
          <pre style="padding: 12px; border: 1px solid #b9aa95; border-radius: 8px; overflow:auto;">python3 -m http.server 8080</pre>
          <p>Then open <code>http://localhost:8080</code>.</p>
        </div>
      `;
    } else {
      viewer.innerHTML = `<p>Could not load <code>${BOOK_JSON}</code>. Make sure the file exists and you are using a web server.</p>`;
    }
    console.error(error);
  }
}

initReader();
