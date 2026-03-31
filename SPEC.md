# 磁磚場景模擬系統 - 規格書 (SPEC.md)

## 系統概述

| 項目 | 內容 |
|------|------|
| 系統名稱 | Tile Scene Simulator |
| 版本 | v4.0.0 |
| 用途 | 上傳磁磚圖片，AI 生成室內場景模擬圖 |
| 技術棧 | Node.js + Fastify + Replicate API |

---

## 功能規格

### 1. 上傳磁磚圖片
- 支援格式：JPG, PNG, WEBP
- 自動儲存到 `uploads/` 目錄
- 即時預覽功能

### 2. 輸入磁磚規格
| 欄位 | 選項說明 |
|------|----------|
| 尺寸 | 寬/高 + 單位 (cm / 平方尺 / 平方米) |
| 顏色 | 讓 AI 自動分析 或 手動選擇 |
| 材質 | 讓 AI 自動分析 或 手動選擇 |

### 3. AI 深度分析
- 使用 OpenAI Vision API 進行全面分析
- 識別顏色、材質、紋理類型、風格
- 計算 AI 信心度
- 自動推薦適用房間與場景風格

### 4. 生成場景模擬圖
- 使用 Replicate API (ControlNet Canny 模型)
- 磁磚圖片作為 ControlNet 控制輸入
- 根據磁磚邊緣結構生成室內場景
- 支援房間類型：客廳、臥室、浴室、廚房、餐廳、陽台

### 5. 搜尋相似場景
- 使用 Unsplash API 搜尋真實場景圖片
- 基於顏色、材質、房間類型關鍵字

---

## API 接口

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/status` | 檢查服務狀態 |
| POST | `/api/upload` | 上傳磁磚圖片 |
| POST | `/api/analyze` | 分析磁磚特徵 |
| POST | `/api/generate` | 生成場景模擬圖 |
| POST | `/api/search-scenes` | 搜尋相似場景 |

---

## 環境變數

```
REPLICATE_API_TOKEN=xxx    # Replicate API 金鑰
OPENAI_API_KEY=xxx         # OpenAI API 金鑰 (用於顏色分析)
UNSPLASH_ACCESS_KEY=xxx   # Unsplash API 金鑰 (可選)
```

---

## 版本歷史

### v4.0.0 (2026-03-31)
**重大重構：智慧分析 + 場景推薦 + ControlNet**
- 新增深度磁磚分析 (OpenAI Vision JSON 格式)
- 新增場景推薦系統 (基於顏色/材質/紋理)
- 支援 6 種場景風格 (現代簡約/北歐/工業/奢華/日式/地中海)
- 新增進階控制面板 (ControlNet 強度/生成步數)
- 重構前端 UI (Tailwind CSS)
- 新增 API: /api/analyze, /api/recommend, /api/generate-multiple

### v3.0.0 (2026-03-29)
**重大升級：ControlNet 方案實施**
- 更換 AI 模型為 ControlNet Canny (jagilley/controlnet-canny)
- 磁磚圖片現在作為 ControlNet 控制輸入
- 生成結果與磁磚高度相關
- 修復 base64 圖片傳輸問題
- 修復 API 參數類型錯誤 (num_samples, image_resolution 需為字串)

**差異說明：**
- v2.x: 使用 FLUX 純文字 prompt，生成結果與磁磚無關
- v3.x: 使用 ControlNet，磁磚圖片直接影響場景生成

### v2.1.0 (2026-03-26)
**修復問題：**
- 修復 `buildScenePrompt` 函數：prompt 中加入偵測到的顏色 (`detectedColor`)
- 修復 `detectPattern` 函數：從隨機改為基於「材質 + 顏色」推斷圖案類型
- 前端 `savedFeatures` 增加 `detectedColor` 欄位

**差異說明：**
- 之前：prompt 完全不包含顏色，導致生成的場景與磁磚無關
- 之後：prompt 包含顏色 (如 "米白 純色 現代簡約")，生成結果更準確

### v2.0.0 (2026-03-25)
- 新增多語系支援 (繁中/英文/緬甸文)
- 新增 Unsplash 搜尋功能
- 重構前端 UI

### v1.0.0 (2026-03-24)
- 初始版本
- 基本上下傳、分析、生成功能
