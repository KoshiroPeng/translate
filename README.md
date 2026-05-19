# Click Translate Dot

一个可运行的 Chrome 扩展 MVP：

- 点击网页中的英文单词
- 单词右侧出现一个小红点
- 点击小红点后显示中文翻译卡片
- 默认接入 DeepSeek API，直接返回实时翻译

## 目录结构

```text
translate/
├─ .gitignore
├─ manifest.json
├─ options.html
├─ options.js
├─ README.md
└─ src/
   ├─ background.js
   ├─ content.js
   ├─ local-config.js
   └─ styles.css
```

## 如何加载

1. 打开 Chrome。
2. 进入 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择目录 `D:\dev\workspace\translate`。

## 如何测试

1. 打开任意包含英文文本的网页。
2. 点击一个英文单词，例如 `hello`、`browser`、`translate`。
3. 单词旁边会出现一个红点。
4. 点击红点后，会显示 DeepSeek 返回的中文翻译。

## 当前实现

- `src/content.js`
  监听页面点击，识别英文单词，渲染红点和翻译卡片。
- `src/background.js`
  处理翻译请求、调用 DeepSeek `/chat/completions` 接口并做缓存。
- `src/local-config.js`
  保存本地开发使用的 DeepSeek API Key，已经被 `.gitignore` 忽略。
- `options.html` / `options.js`
  提供最小设置页，可切换模型和覆盖 API Key。

## 当前限制

- 目前更适合点击单个英文单词或短语。
- 不处理跨多个 DOM 节点的长句。
- 不处理图片、Canvas、PDF 里的文字。
- 当前仍然是浏览器扩展直连 API，不适合公开发布。

## 下一步建议

1. 改成“扩展 -> 你的后端 -> DeepSeek”，避免把正式 key 放在扩展本地。
2. 增加短语翻译、词性、音标、例句。
3. 增加划词翻译和右键翻译模式。
4. 增加请求节流、失败重试和术语表。
