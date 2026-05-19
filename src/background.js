import { LOCAL_CONFIG } from "./local-config.js";

const DEFAULT_SETTINGS = {
  enabled: true,
  sourceLang: "en",
  targetLang: "zh-CN",
  provider: "deepseek",
  model: "deepseek-v4-flash",
  apiBaseUrl: "https://api.deepseek.com",
  apiKey: ""
};

const MAX_CACHE_SIZE = 100;
const CACHE_KEY = "translationCache";

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set({
    ...DEFAULT_SETTINGS,
    ...current
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "TRANSLATE_TEXT") {
    return false;
  }

  handleTranslateRequest(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown translation error"
      });
    });

  return true;
});

async function handleTranslateRequest(message) {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const normalizedText = normalizeText(message.text);
  const apiKey = settings.apiKey || LOCAL_CONFIG.deepseekApiKey;

  if (!settings.enabled) {
    throw new Error("Extension is disabled in settings.");
  }

  if (!normalizedText) {
    throw new Error("No valid English text was provided.");
  }

  if (!apiKey) {
    throw new Error("Missing DeepSeek API key.");
  }

  const cacheKey = [
    settings.provider,
    settings.model,
    settings.sourceLang,
    settings.targetLang,
    normalizedText.toLowerCase()
  ].join(":");

  const cache = await getCache();
  if (cache[cacheKey]) {
    return {
      ...cache[cacheKey],
      cached: true
    };
  }

  const result = await translateWithDeepSeek({
    apiBaseUrl: settings.apiBaseUrl,
    apiKey,
    model: settings.model,
    text: normalizedText,
    sourceLang: settings.sourceLang,
    targetLang: settings.targetLang
  });

  cache[cacheKey] = {
    ...result,
    cached: false,
    createdAt: Date.now()
  };
  await trimAndSaveCache(cache);

  return cache[cacheKey];
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function translateWithDeepSeek({
  apiBaseUrl,
  apiKey,
  model,
  text,
  sourceLang,
  targetLang
}) {
  const endpoint = `${apiBaseUrl.replace(/\/+$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: [
            "You are a translation engine.",
            "Translate the user text into concise natural Simplified Chinese.",
            "Return only the translation text.",
            "Do not add quotes, labels, explanations, or extra commentary."
          ].join(" ")
        },
        {
          role: "user",
          content: `Source language: ${sourceLang}\nTarget language: ${targetLang}\nText: ${text}`
        }
      ],
      thinking: {
        type: "disabled"
      },
      stream: false,
      max_tokens: 120,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API error (${response.status}): ${errorText.slice(0, 240)}`);
  }

  const data = await response.json();
  const translatedText = extractTranslationText(data);

  if (!translatedText) {
    throw new Error("DeepSeek returned an empty translation.");
  }

  return {
    sourceText: text,
    translatedText,
    provider: "deepseek",
    model,
    note: "Translated by DeepSeek in real time."
  };
}

function extractTranslationText(data) {
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item?.text === "string" ? item.text : ""))
      .join("")
      .trim();
  }

  return "";
}

async function getCache() {
  const data = await chrome.storage.local.get(CACHE_KEY);
  return data[CACHE_KEY] || {};
}

async function trimAndSaveCache(cache) {
  const entries = Object.entries(cache).sort((a, b) => {
    const aTime = a[1]?.createdAt || 0;
    const bTime = b[1]?.createdAt || 0;
    return bTime - aTime;
  });

  const trimmed = Object.fromEntries(entries.slice(0, MAX_CACHE_SIZE));
  await chrome.storage.local.set({
    [CACHE_KEY]: trimmed
  });
}
