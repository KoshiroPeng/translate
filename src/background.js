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

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "TRANSLATE_STREAM") {
    return;
  }

  port.onMessage.addListener(async (message) => {
    if (message?.type !== "START_TRANSLATE_STREAM") {
      return;
    }

    try {
      await handleTranslateStream(message, port);
    } catch (error) {
      port.postMessage({
        type: "STREAM_ERROR",
        error: error instanceof Error ? error.message : "Unknown translation error"
      });
    }
  });
});

async function handleTranslateRequest(message) {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const normalizedText = normalizeText(message.text);
  const apiKey = settings.apiKey || LOCAL_CONFIG.deepseekApiKey;

  validateRequest(settings, normalizedText, apiKey);

  const cacheKey = buildCacheKey(settings, normalizedText);
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

async function handleTranslateStream(message, port) {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const normalizedText = normalizeText(message.text);
  const apiKey = settings.apiKey || LOCAL_CONFIG.deepseekApiKey;

  validateRequest(settings, normalizedText, apiKey);

  const cacheKey = buildCacheKey(settings, normalizedText);
  const cache = await getCache();

  if (cache[cacheKey]) {
    port.postMessage({
      type: "STREAM_CHUNK",
      chunk: cache[cacheKey].translatedText
    });
    port.postMessage({
      type: "STREAM_DONE",
      result: {
        ...cache[cacheKey],
        cached: true
      }
    });
    return;
  }

  const streamResult = await translateWithDeepSeekStream({
    apiBaseUrl: settings.apiBaseUrl,
    apiKey,
    model: settings.model,
    text: normalizedText,
    sourceLang: settings.sourceLang,
    targetLang: settings.targetLang,
    onChunk: (chunk) => {
      port.postMessage({
        type: "STREAM_CHUNK",
        chunk
      });
    }
  });

  cache[cacheKey] = {
    ...streamResult,
    cached: false,
    createdAt: Date.now()
  };
  await trimAndSaveCache(cache);

  port.postMessage({
    type: "STREAM_DONE",
    result: cache[cacheKey]
  });
}

function validateRequest(settings, normalizedText, apiKey) {
  if (!settings.enabled) {
    throw new Error("Extension is disabled in settings.");
  }

  if (!normalizedText) {
    throw new Error("No valid English text was provided.");
  }

  if (!apiKey) {
    throw new Error("Missing DeepSeek API key.");
  }
}

function buildCacheKey(settings, normalizedText) {
  return [
    settings.provider,
    settings.model,
    settings.sourceLang,
    settings.targetLang,
    normalizedText.toLowerCase()
  ].join(":");
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
      messages: buildTranslationMessages(sourceLang, targetLang, text),
      thinking: {
        type: "disabled"
      },
      stream: false,
      max_tokens: 220,
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

  const studyNotes = shouldAnalyzeText(text)
    ? await analyzeSentenceWithDeepSeek({
        apiBaseUrl,
        apiKey,
        model,
        text
      })
    : null;

  return {
    sourceText: text,
    translatedText,
    studyNotes
  };
}

async function translateWithDeepSeekStream({
  apiBaseUrl,
  apiKey,
  model,
  text,
  sourceLang,
  targetLang,
  onChunk
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
      messages: buildTranslationMessages(sourceLang, targetLang, text),
      thinking: {
        type: "disabled"
      },
      stream: true,
      max_tokens: 220,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API error (${response.status}): ${errorText.slice(0, 240)}`);
  }

  if (!response.body) {
    throw new Error("DeepSeek stream body is not available.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let translatedText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) {
        continue;
      }

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        continue;
      }

      const parsed = JSON.parse(payload);
      const chunk = extractDeltaText(parsed);
      if (!chunk) {
        continue;
      }

      translatedText += chunk;
      onChunk(chunk);
    }
  }

  const trailingLine = buffer.trim();
  if (trailingLine.startsWith("data:")) {
    const payload = trailingLine.slice(5).trim();
    if (payload && payload !== "[DONE]") {
      const parsed = JSON.parse(payload);
      const chunk = extractDeltaText(parsed);
      if (chunk) {
        translatedText += chunk;
        onChunk(chunk);
      }
    }
  }

  translatedText = translatedText.trim();
  if (!translatedText) {
    throw new Error("DeepSeek returned an empty translation.");
  }

  const studyNotes = shouldAnalyzeText(text)
    ? await analyzeSentenceWithDeepSeek({
        apiBaseUrl,
        apiKey,
        model,
        text
      })
    : null;

  return {
    sourceText: text,
    translatedText,
    studyNotes
  };
}

function buildTranslationMessages(sourceLang, targetLang, text) {
  return [
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
  ];
}

function shouldAnalyzeText(text) {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return wordCount >= 3;
}

async function analyzeSentenceWithDeepSeek({
  apiBaseUrl,
  apiKey,
  model,
  text
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
            "You are an English learning assistant for native Chinese speakers.",
            "Analyze the user's English sentence for Chinese learners.",
            "Return strict JSON only.",
            "Schema:",
            '{"grammar":[{"name":"", "explanation":""}], "phrases":[{"text":"", "meaning":"", "usage":""}]}',
            "Keep grammar names and phrase text in English when appropriate.",
            "All explanations, meanings, and usage notes must be in Simplified Chinese.",
            "Explain in a practical, learner-friendly way for someone reading English materials in a browser.",
            "Focus on useful grammar points and fixed expressions that help learning.",
            "If nothing is notable, return empty arrays."
          ].join(" ")
        },
        {
          role: "user",
          content: `Sentence: ${text}`
        }
      ],
      thinking: {
        type: "disabled"
      },
      stream: false,
      max_tokens: 320,
      temperature: 0.2,
      response_format: {
        type: "json_object"
      }
    })
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const content = extractTranslationText(data);
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content);
    return {
      grammar: Array.isArray(parsed.grammar) ? parsed.grammar.slice(0, 4) : [],
      phrases: Array.isArray(parsed.phrases) ? parsed.phrases.slice(0, 4) : []
    };
  } catch (_error) {
    return null;
  }
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

function extractDeltaText(data) {
  const delta = data?.choices?.[0]?.delta?.content;

  if (typeof delta === "string") {
    return delta;
  }

  if (Array.isArray(delta)) {
    return delta
      .map((item) => (typeof item?.text === "string" ? item.text : ""))
      .join("");
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
