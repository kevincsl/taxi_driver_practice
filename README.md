# 計程車執業登記證模擬測驗

靜態模擬測驗網站，題庫來源為 `files/` 內的 PDF。

## 使用方式

直接開啟 `index.html`，選擇「交通法令」或「地理環境」縣市後開始測驗。

每份考卷固定抽題：

- 是非題 25 題
- 選擇題 25 題

## 重新產生題庫

PDF 有更新時執行：

```powershell
python .\scripts\build_question_bank.py
```

腳本會輸出：

- `data/questions.json`
- `data/questions.js`
- `data/markdown/*.md`
