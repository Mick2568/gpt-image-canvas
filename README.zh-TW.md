# GPT Image Canvas

[English](README.md) | [繁體中文](README.zh-TW.md)

GPT Image Canvas 是一個本機優先的 AI 圖片畫布，支援文生圖、參考圖生成和多步驟 Agent 規劃。專案基於 tldraw、Hono、SQLite 和 GPT Image 2 建置，適合在本機完成創作、管理歷史和儲存生成資產。

## 效果圖

![GPT Image Canvas 效果圖](docs/assets/app-preview.png)

## 能做什麼

- 在 tldraw 畫布上生成、擺放和管理 AI 圖片。
- 支援文字提示詞生成，也支援選中畫布圖片作為參考圖生成。
- 預設將專案快照、生成歷史和生成資產儲存在本機。
- 支援從 `.env`、應用程式內設定對話框或 Codex 登入中選擇生成服務。
- 右側 Agent Tab 可以把多圖需求規劃成計劃節點，再按依賴關係執行生圖任務。
- 可選啟用騰訊雲 COS 或 Cloudflare R2 / S3-compatible，將新生成圖備份到雲端。
- Gallery 支援檢視本機作品，並提供定位、重跑、下載和上傳狀態。

## 環境要求

- Node.js `24.15.0`。儲存庫包含 `.nvmrc` 和 `.node-version`。
- pnpm `9.14.2`。版本已固定在 `package.json`。
- 可存取 `gpt-image-2` 的 OpenAI API key、OpenAI 相容圖片端點，或在應用程式內完成的 Codex 登入。
- Docker Desktop 或相容 Docker Engine，僅 Docker 工作流需要。

如果需要啟用固定 pnpm 版本：

```sh
corepack prepare pnpm@9.14.2 --activate
```

## 快速開始

Windows PowerShell：

```powershell
pnpm install
Copy-Item .env.example .env
pnpm dev
```

macOS/Linux：

```sh
pnpm install
cp .env.example .env
pnpm dev
```

開啟 [http://localhost:5173](http://localhost:5173) 使用 Web 應用程式。

`pnpm dev` 會同時啟動兩個本機服務：

- API：[http://127.0.0.1:8787](http://127.0.0.1:8787)
- Web：[http://localhost:5173](http://localhost:5173)，並將 `/api` 代理到 API 服務

應用程式可以在沒有憑證的情況下啟動。沒有可用 provider 時，`/` 會顯示憑證感知首頁，生圖請求會回傳 `missing_provider`，直到你設定好生成服務。

## 設定生成服務

預設 provider 優先順序是：

1. `.env` 或執行時環境變數中的 OpenAI 相容設定。
2. 應用程式內儲存的本機 OpenAI 相容設定。
3. Codex 登入備援。

最簡單的 API Key 設定方式是編輯 `.env`：

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_TIMEOUT_MS=1200000
CODEX_RESPONSES_MODEL=gpt-5.5
```

使用官方 OpenAI API 時留空 `OPENAI_BASE_URL`。如果使用其他 OpenAI 相容服務，將它設定為相容的 `/v1` 端點；如果該端點需要不同的圖片模型名，修改 `OPENAI_IMAGE_MODEL`。
使用 Codex 登入時，`CODEX_RESPONSES_MODEL` 控制 ChatGPT OAuth 橋接使用的主 Responses 模型；`OPENAI_IMAGE_MODEL` 仍然是傳給圖片生成工具的圖片模型。

也可以開啟右上角 `設定` 對話框，儲存一個本機 OpenAI 相容 provider。本機 key 會儲存在 `DATA_DIR` 下的 SQLite 資料庫中，讀取時只回傳遮罩值，並會一直保留到你輸入新 key 替換它。

## 路由說明

- `/` 是憑證感知首頁。沒有 provider 時會提供 `Codex 登入` 和 `連線 API`。
- `/canvas` 是畫布工作區。沒有 provider 時會回傳 `/`。
- `/pool` 是內建提示池，用於瀏覽、搜尋、收藏、複製和重複使用精選提示詞。
- `/gallery` 始終可存取，方便在沒有憑證時檢視本機作品。

Provider 對話框中的環境變數是隻讀的。修改 `.env` 後，需要重新啟動 API 或 Docker 容器。

## 使用畫布

右側面板有兩個主要流程：

- `Manual`：輸入提示詞，選擇尺寸、品質和格式後生成。選中一張圖片形狀時，會切換到參考圖生成。
- `Agent`：描述一個多圖任務，可選中最多 3 張畫布圖片作為參考；確認生成的計劃節點後執行。

Agent 規劃使用獨立於圖片 provider 的 OpenAI 相容聊天設定。請在 Agent LLM 設定中儲存 API Key、Base URL、模型、逾時和 `supportsVision`。

開啟 `supportsVision` 時，選中的圖片會作為多模態輸入傳給規劃模型。關閉時，選中圖片只作為後續生圖的 reference handle，Agent 不應聲稱自己看過圖片內容。目前版本不持久化 Agent 對話訊息；重新整理頁面會清空對話，但已經落在畫布上的計劃節點會隨一般 canvas snapshot 儲存。

計劃執行按 DAG 排程。互不依賴的 job 可以併發執行；引用上游生成圖的 job 會等待依賴完成；`Retry failed` 會只重跑失敗或被擋住的 job，並保留已成功的上游輸出。單一計劃最多生成 16 張圖，包含中間錨點圖。

## 雲端備份

生成圖始終先儲存到本機。啟用應用程式內騰訊雲 COS 或 Cloudflare R2 / S3-compatible 設定後，新生成圖還會上傳到：

```text
<key-prefix>/YYYY/MM/<assetId>.<ext>
```

COS 欄位預設值來自：

- `COS_DEFAULT_BUCKET`
- `COS_DEFAULT_REGION`
- `COS_DEFAULT_KEY_PREFIX`

R2 / S3 欄位預設值來自：

- `S3_DEFAULT_BUCKET`
- `S3_DEFAULT_REGION`
- `S3_DEFAULT_KEY_PREFIX`
- `R2_DEFAULT_ACCOUNT_ID`
- `S3_DEFAULT_ENDPOINT`

儲存雲端儲存設定前會執行一次測試上傳和刪除。provider secret 會儲存在本機 SQLite 中，讀取設定時只回傳遮罩值。雲端上傳失敗不會導致生圖失敗；圖片仍可從本機讀取，歷史記錄會顯示上傳失敗狀態。

## 專案結構

```text
apps/api         Hono API、SQLite 儲存、provider 選擇、Agent 規劃與執行
apps/web         Vite + React + tldraw Web 應用程式
packages/shared  共享契約和常量
docs             專案文件和預覽素材
data             本機執行時資料，已被 Git 忽略
```

## 常用腳本

| 命令 | 說明 |
| --- | --- |
| `pnpm dev` | 同時啟動 API 和 Web 開發服務。 |
| `pnpm api:dev` | 啟動 API 開發流程。 |
| `pnpm web:dev` | 啟動 Vite Web 開發流程。 |
| `pnpm typecheck` | 檢查 shared、web 和 API 的 TypeScript。 |
| `pnpm build` | 建置 shared、web 和 API 包。 |
| `pnpm start` | 啟動建置後的 API 包。 |
| `pnpm --filter @gpt-image-canvas/api smoke:planner` | 檢查 Agent plan 校驗 fixture。 |
| `pnpm --filter @gpt-image-canvas/api smoke:agent` | 檢查 Agent 設定和 WebSocket 基礎行為。 |
| `pnpm --filter @gpt-image-canvas/api smoke:executor` | 用 fake image provider 檢查 Agent DAG 執行器。 |

完成程式碼改動前請執行：

```sh
pnpm typecheck
pnpm build
```

涉及 UI 改動時，請執行 `pnpm dev`，並在瀏覽器中驗證 [http://localhost:5173](http://localhost:5173)。

如果切換 Node 版本後 `better-sqlite3` 報 `NODE_MODULE_VERSION` 不相符，重新建置原生依賴：

```sh
pnpm --filter @gpt-image-canvas/api rebuild better-sqlite3 --stream
```

## Docker

Docker Compose 會把共享契約、Web 應用程式和 API 建置到同一個映像檔中。API 在同一個本機連接埠同時提供 `/api` 和建置後的 Web bundle。SQLite 資料和生成資產會持久化到主機 `./data`。

Windows PowerShell：

```powershell
Copy-Item .env.example .env
docker compose config --quiet --no-env-resolution
docker compose up --build
```

macOS/Linux：

```sh
cp .env.example .env
docker compose config --quiet --no-env-resolution
docker compose up --build
```

預設開啟 [http://localhost:8787](http://localhost:8787)。如需使用其他本機連接埠，請在啟動 Compose 前設定 `.env` 中的 `PORT`。

真實憑證存在時，請使用 `docker compose config --quiet --no-env-resolution` 做校驗。一般 `docker compose config` 會展開 env 檔案，可能列印金鑰。

Compose 預設設定 `SQLITE_JOURNAL_MODE=DELETE` 和 `SQLITE_LOCKING_MODE=EXCLUSIVE`，用於避開 Docker Desktop 綁定掛載目錄時常見的 SQLite shared-memory 錯誤。不要讓 `pnpm dev` 和 Docker 同時使用同一個 `data/` 目錄。

### 預先建置 GHCR 映像檔

發版 workflow 會把多架構映像檔推送到 GHCR，升級時可以直接拉儲存庫映像檔，不需要本機重新建置：

```sh
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

預設映像檔是 `ghcr.io/mrslimslim/gpt-image-canvas:latest`。如需固定某個版本，請在執行 Compose 前設定 `IMAGE`，例如 `ghcr.io/mrslimslim/gpt-image-canvas:v0.4.0`。

釋出標籤會生成 `vX.Y.Z`、`X.Y.Z` 和 `X.Y` 映像檔標籤；非 prerelease 的 GitHub Release 還會更新 `latest`。公開 GHCR package 可以匿名拉取；如果 GitHub 顯示 package 是私有的，請先執行 `docker login ghcr.io`，或在儲存庫 package 設定裡改為公開。

Compose 建置支援這些網路相關 build args：

- `NODE_IMAGE`
- `NPM_CONFIG_REGISTRY`
- `APT_MIRROR`
- `APT_SECURITY_MIRROR`

預設 `NODE_IMAGE` 是 `node:24.15.0-bookworm-slim`。

## 本機資料與金鑰

`DATA_DIR` 本機預設是 `./data`，Docker 中預設是 `/app/data`。其中包含：

- `gpt-image-canvas.sqlite`：專案狀態、生成歷史、資產元資料、provider 設定、Agent LLM 設定、可選雲端儲存設定，以及 Codex OAuth token 記錄。
- `assets/`：生成的圖片檔案。

不要提交 `.env`、`.ralph/`、`.codex-temp/`、`data/`、生成圖片、SQLite 資料庫或建置輸出。

儲存本機 provider key、Agent LLM key、雲端儲存 secret 或 Codex token 後，請把 `data/gpt-image-canvas.sqlite` 視為敏感檔案。目前應用程式面向本機工作站使用；如果沒有自行增加認證和網路隔離，不要把它公開暴露。

如果真實 API key 曾經被提交過，請先輪換該 key。Git ignore 只能防止之後繼續洩露，不能從已有 Git 歷史中刪除金鑰。

## 故障排查

- 缺少 provider：在 `.env` 加入 `OPENAI_API_KEY` 並重新啟動，或從 `設定` 儲存本機 provider，或完成 `Codex 登入`。
- Codex 登入失敗：確認機器可以存取 `https://auth.openai.com`，保持登入對話框開啟；使用者驗證碼過期後重新開始流程。
- 自訂端點失敗：確認 `OPENAI_BASE_URL` 指向 OpenAI 相容 `/v1` 端點，並支援目前圖片模型。
- Agent 無法規劃：Agent LLM 設定需要獨立於圖片 provider 儲存。如果開啟 `supportsVision` 後失敗，減少選中圖片數量或尺寸。
- Agent 計劃無法執行：確認一般圖片 provider 已設定；Agent 規劃和實際生圖使用的是兩套設定。
- 連接埠衝突：為 API/Docker 設定 `PORT`。Web 開發連接埠衝突時，停止佔用 `5173` 的行程，或執行 `pnpm web:dev -- --port 5174`。
- Docker 無法拉取基礎映像檔：恢復 Docker Hub 存取，或將 `NODE_IMAGE` 設定為本機快取的等價 Node `24.15.0` 映像檔。
- Docker 中出現 SQLite `SQLITE_IOERR_SHMOPEN`：保留 Compose 的 SQLite 預設值，重新建置，並確認沒有本機 API 行程同時佔用同一個資料庫。
- SQLite `SQLITE_CORRUPT`：停止所有應用程式行程，備份 `data/`，再從備份恢復，或刪除 SQLite 檔案讓應用程式建立新資料庫。`data/assets/` 下的圖片檔案可以保留。
- 本機狀態過期或不需要：停止應用程式並刪除 `data/` 下的檔案。這會刪除本機專案狀態、歷史記錄和生成資產。

## 升級

升級舊版本本機安裝前，先備份執行時資料：

Windows PowerShell：

```powershell
Copy-Item -Recurse data data-backup-before-upgrade
docker compose up --build
```

macOS/Linux：

```sh
cp -R data data-backup-before-upgrade
docker compose up --build
```

升級後請一起重建 Web 應用程式和 API。

## Codex 使用說明

Codex 可以直接在本儲存庫工作。先讓它讀取 `AGENTS.md`，再使用固定包管理器：

```sh
pnpm install
pnpm typecheck
pnpm build
```

不要把憑證寫進提示詞或日誌。Ralph 驅動的工作請先閱讀 `docs/ralph-execution.md`；PRD 放在 `.agents/tasks/`，執行狀態放在 `.ralph/`，臨時檔案放在 `.codex-temp/`。

## 許可證

MIT

## 友情連結

- [LINUX DO - 新的理想型社區](https://linux.do/)
