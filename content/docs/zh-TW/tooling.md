---
title: "工具鏈"
description: "格式化、語言伺服器、除錯資訊與測試執行器——四個讓 Teyru 能日常使用的工具。"
---

編譯器本身只有一個執行檔，工具都在裡面：`fmt`、`lsp`、`test` 與 `-g` 不是外掛，
是同一支 `teyru` 的子命令。這一頁說每個工具做什麼、怎麼用，以及它**不做**什麼。

## 格式化：`teyru fmt`

```sh
teyru fmt -w src/            # 就地改寫
teyru fmt src/Main.teyru     # 印到 stdout
```

規則固定：兩格縮排、一個敘述一行、運算子與逗號前後留一個空白、大括號留在宣告那一行。
格式化是**冪等**的——`fmt(fmt(x)) == fmt(x)`，整個 `lib/` 與測試程式都在驗這件事。

**註解會保留**：格式化器不是從語法樹重新產生程式碼（那會丟掉註解，因為剖析器不保留
trivia），而是走詞法單元並在原本的位移重新插入註解。`lib/*.teyru` 的 4,189 則註解在
格式化前後逐字相同，這是測試的一部分。

格式化不改行為：同一個程式格式化前後編出來的執行檔輸出相同。

## 語言伺服器：`teyru lsp`

```sh
teyru lsp        # stdin/stdout 上的 JSON-RPC 2.0，Content-Length 框架
```

支援的能力：

| 能力 | 說明 |
|---|---|
| `textDocument/publishDiagnostics` | 每次開啟與修改都跑完整的詞法、語法與語意分析，診斷帶 `TY-*` 代碼與範圍 |
| `textDocument/definition` | 跳到同一個檔案裡的宣告：型別、方法、欄位、區域變數、參數、catch 變數 |
| `textDocumentSync` | 全文同步（`Full`）——編輯器每次送整份內容，不做增量 |

解析不到的識別字回 `null`，不猜。伺服器只做同檔案的定義跳轉；跨檔案需要模組圖，
目前沒有。

編輯器只要支援 LSP 就能接：VS Code 用一般 LSP client 擴充，Neovim 用
`vim.lsp.start({ cmd = { "teyru", "lsp" } })`。

## 除錯資訊：`-g`

```sh
teyru build -g -O0 -o hello hello.teyru
```

`-g` 讓產生的 C 帶 `#line` 指令指回 `.teyru`，並把 `-g` 交給 C 編譯器，所以 DWARF 裡的
檔案與行號就是 Teyru 原始碼：

```sh
readelf --debug-dump=decodedline hello | head
# hello.teyru    2    0x4007b0
addr2line -e hello 0x4007b0
# /path/hello.teyru:2
```

變數、欄位與方法宣告也有 `DW_AT_decl_file`／`DW_AT_decl_line`，所以 `gdb` 的
`break hello.teyru:7`、`info line`、`list` 都停在原始碼那一行。

**不加 `-g` 時輸出逐位元組不變**：指令只在開啟時產生，預設建置與以前相同。

LLVM 後端目前不產生除錯資訊，`--backend llvm -g` 以 `TY-INT-0103` 明確拒絕，
不會安靜地忽略。

## 測試：`teyru test`

```sh
teyru test            # 目前目錄（遞迴）
teyru test ./...      # 模組的所有套件
```

測試就是一般的方法，加上標註：

```teyru
import teyru.test.*

class CalculatorTest {
  private Calculator calc

  @BeforeEach
  public void setUp() {
    calc = new Calculator()
  }

  @Test
  public void adds() {
    Assert.assertEquals(5, calc.add(2, 3))
  }

  @Test
  public void subtracts() {
    Assert.assertEquals(3, calc.subtract(5, 2))
  }
}
```

生命週期照 JUnit 的形狀：每個測試一個新實例，`@BeforeEach` → 測試 → `@AfterEach`
（失敗也跑）；`@BeforeAll`／`@AfterAll` 可以是靜態或實例方法。

可用的斷言在 `teyru.test.Assert`：`assertEquals`（`Object`、`int`、`long`、`char`、
`boolean`、`double`）、`assertTrue`、`assertFalse`、`assertNull`、`assertNotNull`、
`assertThrows(Class, Runnable)`、`fail(String)`。失敗訊息同時寫出期望值與實際值。

輸出是一行一個測試，最後一行是總結：

```
PASS CalculatorTest.adds
FAIL CalculatorTest.subtracts: expected 3, but was 4
java.lang.AssertionError: expected 3, but was 4
1 passed, 1 failed
```

結束碼：`0` 全過、`1` 有失敗、`2` 編譯或診斷錯誤。套件自己的 `main` 不會被呼叫，
所以測試專案可以同時是一支程式。

方法形狀不對（`@Test` 是靜態、有參數、私有、沒有主體）是 `TY-TYP-0117`；
類別不能當測試（巢狀、沒有無參數建構子、抽象）是 `TY-TYP-0118`。

## 持續整合

倉庫的 `.github/workflows/ci.yml` 在每次 push 到 `main` 與每個 pull request 上跑
`go build ./...`、`go vet ./...` 與整套 `go test ./...`，第二個 job 用 `tests/run.sh`
再跑一次資料驅動的測試。`nightly.yml` 每天以 `CC=gcc` 跑同一套，盯住第二個 C 編譯器
那條腿。
