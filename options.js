const DEFAULT_SETTINGS = {
  enabled: true,
  sourceLang: "en",
  targetLang: "zh-CN",
  provider: "deepseek",
  model: "deepseek-v4-flash",
  apiBaseUrl: "https://api.deepseek.com",
  apiKey: ""
};

const enabledEl = document.getElementById("enabled");
const sourceLangEl = document.getElementById("sourceLang");
const targetLangEl = document.getElementById("targetLang");
const providerEl = document.getElementById("provider");
const modelEl = document.getElementById("model");
const apiKeyEl = document.getElementById("apiKey");
const saveButtonEl = document.getElementById("saveButton");
const statusEl = document.getElementById("status");

initialize();

async function initialize() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  enabledEl.checked = settings.enabled;
  sourceLangEl.value = settings.sourceLang;
  targetLangEl.value = settings.targetLang;
  providerEl.value = settings.provider;
  modelEl.value = settings.model;
  apiKeyEl.value = settings.apiKey;
}

saveButtonEl.addEventListener("click", async () => {
  await chrome.storage.sync.set({
    enabled: enabledEl.checked,
    sourceLang: sourceLangEl.value,
    targetLang: targetLangEl.value,
    provider: providerEl.value,
    model: modelEl.value,
    apiBaseUrl: "https://api.deepseek.com",
    apiKey: apiKeyEl.value.trim()
  });

  statusEl.textContent = "Settings saved.";
  window.setTimeout(() => {
    statusEl.textContent = "";
  }, 2000);
});
