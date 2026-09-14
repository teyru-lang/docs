# Teyru 文件

這個倉庫是 <https://docs.teyru.dev> 的來源：一個以 Next.js 與 Fumadocs 建置的靜態文件站，
內容是 Teyru 語言、編譯器與標準程式庫的參考文件（繁體中文）。

Teyru 編譯器本身在 [teyru-lang/Teyru](https://github.com/teyru-lang/Teyru)，這個倉庫只放文件與網站，
不含編譯器原始碼。

## 內容

`content/docs/` 底下的頁面搬遷自編譯器倉庫的文件，技術內容逐字保留：

| 頁面 | 來源檔案 |
| --- | --- |
| `/docs` | `README.md` |
| `/docs/language` | `docs/language.md` |
| `/docs/diagnostics` | `docs/diagnostics.md` |
| `/docs/lombok` | `docs/lombok.md` |
| `/docs/json` | `docs/json.md` |
| `/docs/framework` | `docs/framework.md` |
| `/docs/modules` | `docs/modules.md` |
| `/docs/native` | `docs/native.md` |
| `/docs/architecture` | `docs/architecture.md` |
| `/docs/other-languages/en` | `README.en.md` |
| `/docs/other-languages/ja` | `README.ja.md` |
| `/docs/other-languages/zh-cn` | `README.zh-CN.md` |
| `/docs/legal` | `THIRD-PARTY-NOTICES.md` |

搬遷時只做了三件事：補上 `title`／`description` frontmatter、把指向倉庫檔案的相對連結改成站內路徑，
以及把 `teyru` 程式碼區塊對到 Java 語法（Shiki 沒有 Teyru 的語法，見 `source.config.ts`）。
內文的段落、表格與程式碼沒有改寫、刪減或翻譯。

側邊欄的順序與名稱寫在 `content/docs/meta.json` 與 `content/docs/other-languages/meta.json`。

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

## 語言

這個站沒有 i18n 層：文件本體是繁體中文，站台的導覽與區塊名稱也使用繁體中文。
fumadocs 自己的介面字串大多已在 `lib/i18n.ts` 翻成繁體中文，沒翻到的部分維持英文原樣。

多語系（英文／日文／簡體中文的介紹頁）屬於 `teyru-lang/website` 的範圍，不在這裡做。
英文、日文與簡體中文的總覽仍然以頁面形式收在「其他語言版本」底下，但那是文件內容，不是介面語系。
