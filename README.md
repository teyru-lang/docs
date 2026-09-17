# Teyru 文件

這個倉庫是 <https://docs.teyru.dev> 的來源：一個以 Next.js 與 Fumadocs 建置的靜態文件站，
內容是 Teyru 語言、編譯器與標準程式庫的參考文件。

Teyru 編譯器本身在 [teyru-lang/Teyru](https://github.com/teyru-lang/Teyru)，這個倉庫只放文件與網站，
不含編譯器原始碼。

## 語言與網址

網站有三個 locale，與 <https://teyru.dev> 首頁提供的是同一組。繁體中文是預設 locale，
也是文件原本撰寫的語言：

| locale | 首頁 | 文件 |
| --- | --- | --- |
| `zh-TW`（預設） | `/` | `/docs` |
| `zh-CN` | `/zh-CN` | `/zh-CN/docs` |
| `en` | `/en` | `/en/docs` |

預設 locale 不帶網址前綴（fumadocs 的 `hideLocale: 'default-locale'`，見 `lib/i18n.ts`），
所以原本的 `/docs/...` 網址維持不變，只有另外兩個 locale 需要前綴。
三個 locale 都有完整的十頁，導覽列上的語言選單切換時會停在同一個頁面。

`lib/i18n.ts` 是 locale 設定，`lib/translations.ts` 是 fumadocs 自己介面字串的三個 locale 對照表
（繁體中文與簡體中文取自官方 `@fumadocs/language` 套件，英文直接用 fumadocs 的預設字串）。

## 內容

內容放在 `content/docs/<locale>/`，一個 locale 一個資料夾（`lib/i18n.ts` 的 `parser: 'dir'`）。
繁體中文那十頁搬遷自編譯器倉庫的文件，技術內容逐字保留：

| 頁面 | 繁體中文 | 簡體中文 | English | 來源檔案 |
| --- | --- | --- | --- | --- |
| 總覽 | `/docs` | `/zh-CN/docs` | `/en/docs` | `README.md`／`README.zh-CN.md`／`README.en.md` |
| 語言參考 | `/docs/language` | `/zh-CN/docs/language` | `/en/docs/language` | `docs/language.md` |
| 診斷碼一覽 | `/docs/diagnostics` | `/zh-CN/docs/diagnostics` | `/en/docs/diagnostics` | `docs/diagnostics.md` |
| Lombok 相容層 | `/docs/lombok` | `/zh-CN/docs/lombok` | `/en/docs/lombok` | `docs/lombok.md` |
| JSON 與 Gson | `/docs/json` | `/zh-CN/docs/json` | `/en/docs/json` | `docs/json.md` |
| 框架 | `/docs/framework` | `/zh-CN/docs/framework` | `/en/docs/framework` | `docs/framework.md` |
| 模組系統 | `/docs/modules` | `/zh-CN/docs/modules` | `/en/docs/modules` | `docs/modules.md` |
| 原生互通 | `/docs/native` | `/zh-CN/docs/native` | `/en/docs/native` | `docs/native.md` |
| 編譯器架構 | `/docs/architecture` | `/zh-CN/docs/architecture` | `/en/docs/architecture` | `docs/architecture.md` |
| 授權 | `/docs/legal` | `/zh-CN/docs/legal` | `/en/docs/legal` | `THIRD-PARTY-NOTICES.md` |

搬遷時只動了這幾件事：補上 `title`／`description` frontmatter、把指向倉庫檔案的相對連結改成站內路徑、
把 `teyru` 程式碼區塊對到 Java 語法（Shiki 沒有 Teyru 的語法，見 `source.config.ts`），
以及把另外兩個 locale 的頁面翻出來。側邊欄的順序與名稱寫在 `content/docs/<locale>/meta.json`。

### 翻譯

`content/docs/zh-TW/` 是正本：它逐字來自編譯器倉庫，不翻譯也不改寫。
`en` 與 `zh-CN` 是翻譯，其中總覽頁直接使用作者自己寫的 `README.en.md` 與 `README.zh-CN.md`。

技術頁只翻散文。程式碼區塊、識別字、型別名稱、診斷碼、檔案路徑、命令列旗標、API 名稱一律照抄；
程式碼區塊裡的註解、ASCII 流程圖裡的字，以及 `<...>` 這種描述性佔位字會跟著翻，
因為那些是給人讀的文字而不是符號。翻譯不增添原文沒有的行為、數字或功能。

### 未翻譯 / Untranslated

無。三個 locale 的十頁都是完整翻譯；唯一保留原文的地方是正本本身，
以及程式碼裡屬於符號的識別字與字面值。

## 開發

```sh
npm install
npm run dev
```

開啟 <http://localhost:3000>。首頁是 `/`，文件在 `/docs`。

型別檢查：

```sh
npm run types:check
```

## 建置

```sh
npm run build
```

網站設定了 Next.js 的靜態匯出（`output: 'export'`，見 `next.config.mjs`），
所以 `next build` 會把所有頁面預先產生成 `out/`，不需要任何伺服器執行期。
要本機預覽產物：

```sh
npm run start   # serve out
```

## 部署

Vercel 上不需要任何環境變數，也不需要額外設定：framework preset 選 Next.js，
build command 是 `npm run build`，輸出目錄交給 Vercel 自動判斷即可。
網域為 `docs.teyru.dev`。

搜尋索引會在建置時產生（`app/api/search/route.ts` 使用 `staticGET`），
因此搜尋是純前端的，不需要外部搜尋服務。
`app/sitemap.ts` 同樣在建置時產生 `sitemap.xml`，列出三個 locale 的所有頁面；
每頁的 `alternates`（`hreflang` 與 `x-default`）由 `lib/shared.ts` 的 `pageAlternates()` 組出來。

實際的設定：

- Vercel 專案 `teyru-docs`（team `langyas-projects`），production 部署就是線上版本。
- **今天（2026-09-17）是手動部署的**：專案的 `link` 欄位是空的，也就是**沒有接 Git**；
  每一筆 production 部署的來源都是 `cli`、建立者是 owner 的帳號（`vercel ls teyru-docs`
  可見）。所以 **push 到這個倉庫不會部署任何東西**，線上站會停在最後一次手動部署的版本
  ——實際落後過：`main` 上已有的「窄化轉換」、「越界繼承階層」、「TLS」三節當時線上還沒有。
  改了文件就要跑下面的 `vercel deploy --prod`，編譯器倉庫的 `AGENTS.md` §9 與送出前檢查
  清單也寫了這一步。
- 網域 `docs.teyru.dev` 在 Cloudflare 的 zone 裡是一筆 **DNS-only** 的
  `CNAME docs.teyru.dev -> cname.vercel-dns.com`：不要開代理，憑證交給 Vercel 簽。
- **每次 push 自動部署**要把 Vercel 的 GitHub App 授權給 `teyru-lang` 組織
  （Vercel → Add New → Project，或 <https://github.com/apps/vercel/installations/new>），
  授權之後 `vercel git connect https://github.com/teyru-lang/docs.git` 就能成功。
  在那之前用 CLI 手動部署：

  ```sh
  vercel link            # 選專案 teyru-docs
  vercel deploy --prod   # 建置並發佈；完成後 docs.teyru.dev 就是它
  ```


