const ROOT_ID = "ctd-root";
const MAX_SELECTION_LENGTH = 600;

let activeTarget = null;
let dotEl = null;
let cardEl = null;

initialize();

function initialize() {
  document.addEventListener("mouseup", handleMouseUp, true);
  document.addEventListener("mousedown", handleMouseDown, true);
  window.addEventListener("scroll", dismissUI, true);
  window.addEventListener("resize", dismissUI, true);
}

async function handleMouseUp() {
  const settings = await chrome.storage.sync.get({
    enabled: true
  });

  if (!settings.enabled) {
    dismissUI();
    return;
  }

  window.setTimeout(() => {
    const target = getSelectionTarget();
    dismissUI();

    if (!target) {
      return;
    }

    activeTarget = target;
    renderDot(target.rect);
  }, 0);
}

function handleMouseDown(event) {
  const root = ensureRoot();
  if (root.contains(event.target)) {
    return;
  }

  dismissUI();
}

function getSelectionTarget() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const text = normalizeSelectionText(selection.toString());
  if (!text || text.length > MAX_SELECTION_LENGTH) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rect = getBestRectFromRange(range);
  if (!rect) {
    return null;
  }

  return {
    text,
    rect
  };
}

function normalizeSelectionText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getBestRectFromRange(range) {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width || rect.height);
  if (rects.length > 0) {
    return rects[rects.length - 1];
  }

  const rect = range.getBoundingClientRect();
  if (rect.width || rect.height) {
    return rect;
  }

  return null;
}

function ensureRoot() {
  let root = document.getElementById(ROOT_ID);

  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    document.documentElement.appendChild(root);
  }

  return root;
}

function renderDot(rect) {
  const root = ensureRoot();
  dotEl = document.createElement("button");
  dotEl.type = "button";
  dotEl.className = "ctd-dot";
  dotEl.title = "Translate selected text";
  dotEl.style.top = `${Math.max(8, rect.top + window.scrollY - 10)}px`;
  dotEl.style.left = `${rect.right + window.scrollX + 6}px`;
  dotEl.addEventListener("click", handleDotClick, { once: true });
  root.appendChild(dotEl);
}

async function handleDotClick(event) {
  event.preventDefault();
  event.stopPropagation();

  if (!activeTarget) {
    return;
  }

  showCard({
    title: truncateText(activeTarget.text, 60),
    body: "Translating..."
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRANSLATE_TEXT",
      text: activeTarget.text
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Translation failed.");
    }

    const { translatedText, note, provider, model, cached } = response.result;
    showCard({
      title: truncateText(activeTarget.text, 60),
      body: translatedText,
      meta: `${provider}${model ? ` | ${model}` : ""}${cached ? " | cache" : ""}`,
      note
    });
  } catch (error) {
    showCard({
      title: truncateText(activeTarget.text, 60),
      body: "Translation failed. Please try again.",
      note: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

function showCard({ title, body, meta = "", note = "" }) {
  const root = ensureRoot();

  if (cardEl) {
    cardEl.remove();
  }

  cardEl = document.createElement("div");
  cardEl.className = "ctd-card";
  cardEl.innerHTML = `
    <div class="ctd-card-title">${escapeHtml(title)}</div>
    <div class="ctd-card-body">${escapeHtml(body)}</div>
    ${meta ? `<div class="ctd-card-meta">${escapeHtml(meta)}</div>` : ""}
    ${note ? `<div class="ctd-card-note">${escapeHtml(note)}</div>` : ""}
  `;

  const top = dotEl ? parseFloat(dotEl.style.top) + 18 : window.scrollY + 24;
  const left = dotEl ? parseFloat(dotEl.style.left) - 140 : window.scrollX + 24;

  cardEl.style.top = `${top}px`;
  cardEl.style.left = `${Math.max(window.scrollX + 8, left)}px`;
  root.appendChild(cardEl);
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function dismissUI() {
  if (dotEl) {
    dotEl.remove();
    dotEl = null;
  }

  if (cardEl) {
    cardEl.remove();
    cardEl = null;
  }

  activeTarget = null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
