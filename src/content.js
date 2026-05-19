const ROOT_ID = "ctd-root";
const MAX_SELECTION_LENGTH = 600;
const CARD_WIDTH = 420;
const VIEWPORT_GAP = 12;

let activeTarget = null;
let activeAnchorRect = null;
let dotEl = null;
let cardEl = null;
let cardTitleEl = null;
let cardBodyEl = null;
let cardNoteEl = null;
let cardActionsEl = null;
let stopButtonEl = null;
let copyButtonEl = null;
let studySectionEl = null;
let grammarListEl = null;
let phraseListEl = null;
let streamPort = null;
let streamState = null;
let preserveUiUntilMouseUp = false;

initialize();

function initialize() {
  document.addEventListener("mouseup", handleMouseUp, true);
  document.addEventListener("mousedown", handleMouseDown, true);
  window.addEventListener("scroll", handleWindowScroll);
  window.addEventListener("resize", dismissUI, true);
}

function handleWindowScroll() {
  dismissUI();
}

async function handleMouseUp(event) {
  const root = ensureRoot();
  if (root.contains(event.target)) {
    preserveUiUntilMouseUp = false;
    return;
  }

  if (preserveUiUntilMouseUp) {
    preserveUiUntilMouseUp = false;
    return;
  }

  const settings = await chrome.storage.sync.get({
    enabled: true
  });

  if (!settings.enabled) {
    dismissUI();
    return;
  }

  window.setTimeout(() => {
    const target = getSelectionTarget();
    dismissUiElements();

    if (!target) {
      activeTarget = null;
      activeAnchorRect = null;
      return;
    }

    activeTarget = target;
    activeAnchorRect = target.rect;
    renderDot(target.rect);
  }, 0);
}

function handleMouseDown(event) {
  const root = ensureRoot();
  if (root.contains(event.target)) {
    preserveUiUntilMouseUp = true;
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
  const position = getDotPosition(rect);

  dotEl = document.createElement("button");
  dotEl.type = "button";
  dotEl.className = "ctd-dot";
  dotEl.title = "Translate selected text";
  dotEl.style.top = `${position.top}px`;
  dotEl.style.left = `${position.left}px`;
  dotEl.addEventListener("click", handleDotClick, { once: true });
  root.appendChild(dotEl);
}

function getDotPosition(rect) {
  const absoluteTop = Math.max(VIEWPORT_GAP, rect.top + window.scrollY - 10);
  const preferredLeft = rect.right + window.scrollX + 6;
  const maxLeft = window.scrollX + window.innerWidth - VIEWPORT_GAP - 14;
  const minLeft = window.scrollX + VIEWPORT_GAP;

  return {
    top: absoluteTop,
    left: clamp(preferredLeft, minLeft, maxLeft)
  };
}

async function handleDotClick(event) {
  event.preventDefault();
  event.stopPropagation();
  preserveUiUntilMouseUp = true;

  if (!activeTarget) {
    return;
  }

  closeStream();
  renderOrUpdateCard({
    title: truncateText(activeTarget.text, 60),
    body: "Translating",
    note: ""
  });
  renderStudyNotes(null);
  setCardLoading(true);
  setCopyButtonEnabled(false);

  try {
    await startStreamingTranslation(activeTarget.text);
  } catch (error) {
    setCardLoading(false);
    setCopyButtonEnabled(Boolean(cardBodyEl?.textContent?.trim()));
    renderOrUpdateCard({
      title: truncateText(activeTarget.text, 60),
      body: "Translation failed. Please try again.",
      note: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

function startStreamingTranslation(text) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({
      name: "TRANSLATE_STREAM"
    });

    streamPort = port;
    streamState = {
      resolved: false,
      body: "",
      canceled: false
    };

    port.onMessage.addListener((message) => {
      if (!streamState) {
        return;
      }

      if (message?.type === "STREAM_CHUNK") {
        streamState.body += message.chunk;
        updateCardBody(streamState.body || "Translating");
        setCopyButtonEnabled(Boolean(streamState.body.trim()));
        return;
      }

      if (message?.type === "STREAM_DONE") {
        const { translatedText, studyNotes } = message.result;
        renderOrUpdateCard({
          title: truncateText(text, 60),
          body: translatedText || streamState.body || "Translation completed.",
          note: ""
        });
        renderStudyNotes(studyNotes);
        setCardLoading(false);
        setCopyButtonEnabled(Boolean((translatedText || streamState.body || "").trim()));
        streamState.resolved = true;
        closeStream();
        resolve();
        return;
      }

      if (message?.type === "STREAM_ERROR") {
        streamState.resolved = true;
        const error = new Error(message.error || "Translation failed.");
        closeStream();
        reject(error);
      }
    });

    port.onDisconnect.addListener(() => {
      if (streamState && !streamState.resolved && !streamState.canceled) {
        const disconnectError = chrome.runtime.lastError?.message || "Translation stream disconnected.";
        closeStream();
        reject(new Error(disconnectError));
      }
    });

    port.postMessage({
      type: "START_TRANSLATE_STREAM",
      text
    });
  });
}

function renderOrUpdateCard({ title, body, note = "" }) {
  ensureCardStructure();
  updateCardTitle(title);
  updateCardBody(body);
  updateCardNote(note);
}

function ensureCardStructure() {
  const root = ensureRoot();

  if (cardEl) {
    return;
  }

  cardEl = document.createElement("div");
  cardEl.className = "ctd-card";

  cardTitleEl = document.createElement("div");
  cardTitleEl.className = "ctd-card-title";

  cardBodyEl = document.createElement("div");
  cardBodyEl.className = "ctd-card-body";

  cardActionsEl = document.createElement("div");
  cardActionsEl.className = "ctd-card-actions";

  copyButtonEl = document.createElement("button");
  copyButtonEl.type = "button";
  copyButtonEl.className = "ctd-copy-button";
  copyButtonEl.textContent = "Copy";
  copyButtonEl.disabled = true;
  copyButtonEl.addEventListener("click", handleCopyClick);

  stopButtonEl = document.createElement("button");
  stopButtonEl.type = "button";
  stopButtonEl.className = "ctd-stop-button";
  stopButtonEl.textContent = "Stop";
  stopButtonEl.addEventListener("click", handleStopClick);

  studySectionEl = document.createElement("div");
  studySectionEl.className = "ctd-study-section";

  grammarListEl = document.createElement("div");
  grammarListEl.className = "ctd-study-block";

  phraseListEl = document.createElement("div");
  phraseListEl.className = "ctd-study-block";

  cardNoteEl = document.createElement("div");
  cardNoteEl.className = "ctd-card-note";

  studySectionEl.appendChild(grammarListEl);
  studySectionEl.appendChild(phraseListEl);
  cardActionsEl.appendChild(copyButtonEl);
  cardActionsEl.appendChild(stopButtonEl);
  cardEl.appendChild(cardTitleEl);
  cardEl.appendChild(cardBodyEl);
  cardEl.appendChild(cardActionsEl);
  cardEl.appendChild(studySectionEl);
  cardEl.appendChild(cardNoteEl);

  root.appendChild(cardEl);
  positionCard();
}

async function handleCopyClick(event) {
  event.preventDefault();
  event.stopPropagation();

  const text = cardBodyEl?.textContent?.trim() || "";
  if (!text || text === "Translating") {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    updateCardNote("Copied to clipboard.");
  } catch (_error) {
    updateCardNote("Copy failed. Clipboard permission may be unavailable.");
  }
}

function handleStopClick(event) {
  event.preventDefault();
  event.stopPropagation();

  if (!streamState) {
    return;
  }

  streamState.canceled = true;
  setCardLoading(false);
  setCopyButtonEnabled(Boolean(cardBodyEl?.textContent?.trim()));
  updateCardNote("You can click the red dot again to restart.");
  closeStream();
}

function setCardLoading(isLoading) {
  ensureCardStructure();

  if (cardEl) {
    cardEl.classList.toggle("ctd-card--loading", isLoading);
  }

  if (stopButtonEl) {
    stopButtonEl.disabled = !isLoading;
  }
}

function setCopyButtonEnabled(enabled) {
  if (!copyButtonEl) {
    return;
  }

  copyButtonEl.disabled = !enabled;
}

function updateCardTitle(title) {
  if (cardTitleEl) {
    cardTitleEl.textContent = title;
  }
}

function updateCardBody(body) {
  if (cardBodyEl) {
    cardBodyEl.textContent = body;
  }
}

function updateCardNote(note) {
  if (cardNoteEl) {
    cardNoteEl.textContent = note;
    cardNoteEl.style.display = note ? "block" : "none";
  }
}

function renderStudyNotes(studyNotes) {
  if (!studySectionEl || !grammarListEl || !phraseListEl) {
    return;
  }

  if (!studyNotes || (!studyNotes.grammar?.length && !studyNotes.phrases?.length)) {
    studySectionEl.style.display = "none";
    grammarListEl.innerHTML = "";
    phraseListEl.innerHTML = "";
    return;
  }

  studySectionEl.style.display = "grid";
  grammarListEl.innerHTML = renderStudyBlockHtml("语法要点", studyNotes.grammar, (item) => `
    <div class="ctd-study-item">
      <div class="ctd-study-item-title">${escapeHtml(item.name || "")}</div>
      <div class="ctd-study-item-body">${escapeHtml(item.explanation || "")}</div>
    </div>
  `);

  phraseListEl.innerHTML = renderStudyBlockHtml("固定短语", studyNotes.phrases, (item) => `
    <div class="ctd-study-item">
      <div class="ctd-study-item-title">${escapeHtml(item.text || "")}</div>
      <div class="ctd-study-item-body">${escapeHtml(item.meaning || "")}</div>
      ${item.usage ? `<div class="ctd-study-item-extra">${escapeHtml(item.usage)}</div>` : ""}
    </div>
  `);

  positionCard();
}

function renderStudyBlockHtml(title, items = [], renderItem) {
  if (!items.length) {
    return "";
  }

  return `
    <div class="ctd-study-heading">${title}</div>
    ${items.map(renderItem).join("")}
  `;
}

function positionCard() {
  if (!cardEl) {
    return;
  }

  const anchorRect = activeAnchorRect || activeTarget?.rect;
  const baseTop = dotEl ? parseFloat(dotEl.style.top) + 18 : window.scrollY + VIEWPORT_GAP;
  const preferredLeft = dotEl ? parseFloat(dotEl.style.left) - 140 : window.scrollX + VIEWPORT_GAP;
  const minLeft = window.scrollX + VIEWPORT_GAP;
  const maxLeft = window.scrollX + window.innerWidth - VIEWPORT_GAP - Math.min(CARD_WIDTH, window.innerWidth - VIEWPORT_GAP * 2);
  let top = baseTop;
  let left = clamp(preferredLeft, minLeft, Math.max(minLeft, maxLeft));

  if (anchorRect) {
    const cardHeight = cardEl.offsetHeight || 180;
    const maxTop = window.scrollY + window.innerHeight - VIEWPORT_GAP - cardHeight;
    top = clamp(baseTop, window.scrollY + VIEWPORT_GAP, Math.max(window.scrollY + VIEWPORT_GAP, maxTop));

    const roomOnRight = window.innerWidth - anchorRect.right;
    const roomOnLeft = anchorRect.left;
    if (roomOnRight < 220 && roomOnLeft > roomOnRight) {
      const leftSide = anchorRect.left + window.scrollX - CARD_WIDTH - 14;
      left = clamp(leftSide, minLeft, Math.max(minLeft, maxLeft));
    }
  }

  cardEl.style.top = `${top}px`;
  cardEl.style.left = `${left}px`;
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function dismissUI() {
  closeStream();
  dismissUiElements();
  activeTarget = null;
  activeAnchorRect = null;
  preserveUiUntilMouseUp = false;
}

function dismissUiElements() {
  if (dotEl) {
    dotEl.remove();
    dotEl = null;
  }

  if (cardEl) {
    cardEl.remove();
    cardEl = null;
    cardTitleEl = null;
    cardBodyEl = null;
    cardNoteEl = null;
    cardActionsEl = null;
    stopButtonEl = null;
    copyButtonEl = null;
    studySectionEl = null;
    grammarListEl = null;
    phraseListEl = null;
  }
}

function closeStream() {
  if (streamPort) {
    streamPort.disconnect();
    streamPort = null;
  }

  streamState = null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
