# Shopee Print Admin（展示版）

此 Repository 為「展示版」：提供前端 Admin UI 與系統架構/介面說明，用於作品集展示與商務洽談。
- 不包含：爬蟲抓取、訂單判定規則、列印模板/驅動、資料庫連線細節等商業核心
- 不提供任何 Cookie、Session、API Key、資料庫密碼等敏感資訊

## 系統架構

請見：`docs/architecture.md`

## Demo（不需後端）

1. 開啟 `admin.html`
2. 點「Demo 假資料」即可看到 UI 展示

## 對接私有後端（可選）

若你有私有後端（不在此 repo），可在頁面上填入：
- API Base：`http://YOUR_HOST:8000`
- API Key：你的 `X-API-Key`

然後點「刷新」測試連線。

## 檔案結構

- `admin.html`：展示版前端入口
- `assets/admin.js`：展示版前端（已移除 .env/Cookie/Session 更新功能）
- `assets/admin.css`：樣式
- `docs/architecture.md`：系統架構圖（Mermaid）

## 安全與授權

本展示版不含可運行之商業核心；請勿在公開 repo 提交任何 `.env`、Cookie、Session、帳密、真實訂單資料或日誌。
