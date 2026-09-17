---
title: "版本與變更"
description: "Teyru 的版本：0.4.0 是正確性版本——改了什麼、量到什麼、還沒實作什麼，以及這一版刻意不宣稱什麼。"
---

這一頁描述 **0.4.0**：這個專案第一個以「正確性」為主題的版本。它處理的是外部審查與實測
找出來的一批問題（計畫的 W1–W12），不是速度——速度是下一個階段的事。

這一頁在 0.4.0 發佈前寫成，所以每一項都標了狀態：**已合入 main** 的項目就是讀者現在裝得到
的行為；其餘的附上 PR 或工作項。**還沒收尾的只有 §3 與 §5 明列的那幾項。**

**這一版的關卡第一次真的跑起來。** `.github/workflows/release.yml` 是這個倉庫**唯一**的
工作流程，只在有 release 發佈時跑，而 0.4.0 是**第一次**有 release 讓它跑：它在 tag 上
建置、跑整套測試、把執行檔附上 release，並依序呼叫六個檢查——`make build`、`make ci`、
`make java-compat`、`make jdk-diff`、`make backend-matrix`、`make notices`。這一頁引用的
數字就是那些指令在同一個 tag 上的輸出，每一列都註明它是怎麼量的。

---

## 1. 改了什麼

### 測試基礎設施與 JDK 差分（W1、W2，已合入 main）

- **JDK 差分測試**：`teyru emit-java` 把 Teyru 的 AST 印成等價的 Java（補分號、`for` 標頭
  換回分號、`val` 換成 `final var`、`java.*` 與標準程式庫對照），翻譯不了的 Teyru 專屬特性
  以 `TY-INT-0102` 具名拒絕並說明原因。`TEYRU_JDK=<JDK 21>` 時 `go test` 會編譯並執行那些
  程式、比對 stdout 與結束狀態；期望值是**真的 JDK 跑出來的**，不是手寫的。
- **已知失敗清單**：`tests/known-failures.txt` 一行一個 `<案例> <工作項> <原因>`；列出的案例
  失敗不算失敗，**列出卻通過**才會讓整次跑失敗，所以條目不會活得比它描述的 bug 久。
  與 JDK 的差異另外由 `tests/jdk-diff-allow.txt` 決定接受，平台差異由 `.skip` 檔決定。
- **兩個診斷開關**：`TEYRU_GC_STRESS=N`（每 N 次配置強制收集一次）、`TEYRU_GCTRACE=1`
  （每次收集印出觸發原因、停頓時間與前後堆積大小）。
- **`make ci`／`make jdk-diff`／`make notices`**：一次 CI job 會跑的東西，在這裡由人跑；這個
  倉庫**只有一個** workflow（`.github/workflows/release.yml`），在發佈 release 時呼叫它們。
- **一條流程規則，因為它真的發生過**：測試比它要驗的程式碼先推上 main，會讓整道關卡在一個
  小時後變紅（`t196_string_bytes` 與 `t180_http_gzip` 就是這樣）。規則現在寫在測試倉庫的
  `README.md`：先推的測試必須在同一個提交裡帶一條 `known-failures.txt` 條目，程式碼到了再
  把條目刪掉。

### HTTP 伺服器加固（W3，已合入 main）

一台伺服器現在是「一條執行緒 accept、一串 cached 工作執行緒回答」，並發有三個上限（工作
執行緒 64、等待佇列 100、WebSocket 工作階段 256），超過的連線得到 503 而不是把伺服器拖住。
請求行、標頭、標頭數與主體都有上限（414／431／413），逾時是**總時長**而不是單次讀取；
解析器對 RFC 9112 的不一致（`Content-Length` 與 `Transfer-Encoding` 同時出現、多個不一致的
長度、obs-fold、冒號前空白、非十六進位的 chunk…）一律拒絕並關閉連線；WebSocket 的協議上限
是 1002／1007／1009／1001。全部十三個設定鍵——十二個 `server.teyru.*`，加上 Spring Boot
自己的 `server.max-http-request-header-size`——與預設值見
[docs/framework.md](/docs/framework) 的〈並發模型〉與〈客戶端的限制〉。

證據是那兩個外部重現腳本在修好後得到的相反結果：慢速用戶端（一條連線每 4 秒送 1 個位元組）
連著時，另一個用戶端連續 5 次請求全部 `200`（修正前 5 次全部逾時）；一個
`Content-Length: 1000000000` 的請求讓 RSS 成長 **36 kB**（修正前 983 MB）。測試是
`t220`（位元組主體）、`t221`（上限與嚴格性）、`t222`（解析器 fuzz）、`t223`（慢速用戶端與
100 個並行客戶端）、`t224`（WebSocket 關閉碼）、`t225`（`serve()`／`close()`）。

**這一版不宣稱兩件事。** 伺服器的每一個等待都以 **250 毫秒**為上限，所以「沒有任何服務
執行緒會阻塞超過 250 毫秒」是被證明的（`t223`）；「一條阻塞在 `recv()` 的執行緒不會拖住
停止世界收集」是執行期的性質（`internal/runtime/src`），文件把它寫成上限而不是修好的性質。
而計畫裡「64 條閒置 keep-alive 連線不影響停頓時間」那一條驗收沒有量測支撐（它需要
`TEYRU_GCTRACE` 的數據），所以這一頁不引用它。

### 遞迴過深是 `StackOverflowError`，不是行程死亡（W4，已合入 main）

每個產生的函式開頭拿自己的框架位址跟執行緒的 `ty_stack_limit`（堆疊底端加 256 KB）比一次，
低於就丟出該執行緒預先配置的 `StackOverflowError`——可攔截，執行緒與行程繼續跑；原生程式碼
真的把堆疊寫壞時由 `sigaltstack` 上的 SIGSEGV 處理器印出訊息後 `abort()`（不做 longjmp）。
在伺服器裡，處理函式的深遞迴是那一個請求得到 500，伺服器繼續服務下一個。代價是量到的：
每個函式多一次檢查，`bench_fib` 長跑因此回退約 32%（owner 已裁決接受）。

### 字串與 Unicode（W5，**已合入 main**）

**字串的索引語意現在是 Java 的。** `length`／`charAt`／`substring`／`indexOf`／`compareTo`／
`hashCode`、`codePoint` 家族、`toCharArray`／`getChars`／`chars`／`codePoints`，以及
`char[]` 與 `int[]` 建構子，全部以 **UTF-16 code unit** 計算；儲存仍是 WTF-8（ASCII 走快速
路徑、麵包屑表首次用到才建，非法位元組以 U+FFFD 取代、沒有夥伴的代理以 `?` 編出）。
讀者最常踩到的三件事：`substring` **可以切開一對代理**（那是 Java 的語意，不是缺陷）、
`hashCode` 是 JDK 的，所以 `HashMap<String, …>` 走的是 JDK 的順序。計畫裡「改用 JDK 式
compact strings」那個備案**由量測結案**：與位元組索引的版本相比 `bench_string` 0.994×、
`bench_string_cjk` 0.949×，都在 10% 預算內，所以不換。

**`Character` 與大小寫映射改用 Unicode 15.0**，資料是入庫的產生查表（產生器
`internal/tools/genunicode`，`make unicode-tables` 重跑；重跑不會改動任何檔案）：
`isLetter`／`isDigit`／`isAlphabetic`／`isWhitespace`／`isSpaceChar`／`getType`／`digit`／
`getNumericValue`／代理判斷／`toCodePoint`／`charCount`；完整大小寫映射（`ß` → `SS`、
希臘語詞尾 sigma）；`strip`／`isBlank` 走 `Character.isWhitespace`，所以 **U+3000 會被去掉**，
而 `trim` 仍然只認 ≤ U+0020；`parseInt`／`parseLong` 收全角與其他 Nd 數字
（`Integer.parseInt("１２３")` 是 `123`）。`StringBuilder`／`StringBuffer` 與 Java 一致，
包括 `delete(start,end)` 的夾取與 `replace` 的 `NullPointerException`。

**兩件要說出來而不是埋起來的事。** 詞尾 sigma 的「詞」判定是這個執行期自己的：對 JDK 量過
8,000 個產生的字串與每個測到的形狀都一致，AGENTS.md §10 記下那**一個**已知不同的形狀。
locale 相關的映射（`tr`、`az`、`lt`）**沒有實作**。

**這一項留下了兩條與 JDK 的差異**（都是刻意的，寫在
[docs/language.md](/docs/language) §12）：regex 引擎逐 **code unit** 比對，所以
`"😀a".matches(".a")` 在這裡是 `false`（JDK 的 `.` 吃一個 code point，是 `true`）；
`String.offsetByCodePoints` 走出兩端時丟 `StringIndexOutOfBoundsException`（JDK 丟
`IndexOutOfBoundsException`；前者是後者的子類別，所以 `catch (IndexOutOfBoundsException)`
仍然攔得到）。

**我怎麼驗的。** 在 `adf58e7`（`tests` 指標 `10ef6b2`）上，同一支程式寫兩次——`.teyru` 與
Java——用 OpenJDK 21 跑再逐行比對：寫的那一半 **32 項逐位元組相同**；讀的那一半 41 項裡
**39 項相同**，其餘兩項就是上面那兩條已聲明的差異（`ß`→`SS`、詞尾 sigma、`strip` 的
U+3000、全角 `parseInt` 的接受與拒絕都在 39 項裡面）。語料
`sh tests/run.sh java-compat` 是 **45 過、0 失敗**（我自己跑的，兩次）。

### 裝箱、容器順序與例外名稱（W6，**已合入 main**）

- **裝箱快取**（已合入）：`Integer`／`Short`／`Byte`／`Long` 快取 −128..127、`Character`
  快取 0..127、`Boolean` 只有兩個實例，所以 `Integer.valueOf(127) == Integer.valueOf(127)`
  與 Java 一樣是 `true`；跨過一次呼叫也不會壞（`t242_box_identity_across_call`，期望值由
  javac 產生）。
- **越界訊息**（已合入）：`Index 5 out of bounds for length 3`（大寫 `I`，JDK 的句子）。
- **容器順序**（已合入）：`HashMap`／`HashSet` 的迭代順序照 JDK 21 的版面（決策 D7）。
  實測程式是測試倉庫的 `t250_map_order`，期望值由 JDK 跑 `t250_map_order.java.ref` 產生：
  五個字串鍵（依序放入 `banana`、`apple`、`cherry`、`date`、`elderberry`）迭代出
  `banana, date, apple, cherry, elderberry`，與 JDK 逐字相同；同一桶保持插入序、第 13 個鍵
  擴容到 32 桶、複製建構子與 `putAll` 的事先定量、負載因子 0.6 的門檻加倍（9 → 18）各有一行。
- **例外名稱與訊息**（已合入）：`Class.getName()` 報告 JDK 的全限定名（決策 D8），
  未捕捉的例外因此印 `Exception in thread "main" java.lang.IllegalStateException: boom`，
  與 JDK 相同（`t251_exception_names`、`t79_uncaught`）；`System.arraycopy` 的型別不符訊息
  也是 JDK 的 `arraycopy: type mismatch: can not copy long[] into byte[]`（`t65_arraycopy`）。
  還沒對齊的三條訊息（cast 的 module／loader 括號、有幫助的 NullPointerException 訊息、
  `ArrayStoreException` 的元素類別）寫在測試倉庫的 `known-failures.txt`。

### Java 原始碼相容（W7，**已合入 main**）

**合入了**：main `07ce0a3`（PR [#124](https://github.com/teyru-lang/Teyru/pull/124)，8 個 commit）。
main 上的行為我自己重跑過：`.teyru` 的敘述寫了分號也編得過、`.java` 檔可以直接當輸入、
`xs.sort(naturalOrder())` 與 `Comparator.comparing(f).thenComparing(g)` 不再需要型別見證、
`String.join` 解析得到。這一節寫的時候 W5 還沒合入（那時缺的是 `new String(char[])`、
`String.codePointAt`），現在兩個都在了（見上面 W5 那一節）；仍然缺的是巢狀的泛型推論
（主體本身是需要目標型別的泛型呼叫時還是要先把型別寫出來）。

**語料現在從 main 就重現得出來。** `teyru-lang/tests` 的 main 是 `af41a7d`（45 支未修改的 Java
程式），而 Teyru main 的指標在 PR [#128](https://github.com/teyru-lang/Teyru/pull/128) 合入後
（`0e8e592`）指到它。我在 main 的那個內容上自己跑過 `sh tests/run.sh java-compat`：
**45 過、0 失敗、0 已知失敗、0 跳過**——PR 描述的 45 支全過是重現得出來的，不是只有分支上成立。
**整套測試在 main 上的那一行是 `324 過、1 失敗、10 已知失敗、0 跳過`**（同一個內容：Teyru
`0e8e592` → `tests` `af41a7d`；由 W7 的收尾者跑完，log 貼在 PR
[#128](https://github.com/teyru-lang/Teyru/pull/128) 的留言裡）。唯一的失敗是 `native/net_c_test`
那個連結失敗（`go test` 不跑那個檔案），而 10 個已知失敗**正好**是 `known-failures.txt` 現在的
十條（`t230`、`t231`、`t234`–`t237`、`t239`、`t246`–`t248`，我核對過名單），所以「列出的都失敗、
沒列出的都沒漏」成立；45 支 java-compat 在 324 裡面。

**兩組數字為什麼不同，原因要寫清楚**：PR 描述裡的 `320 過、1 失敗、9 已知失敗、0 跳過` 量的是
分支那一對——`tests` main 多了 W8 的裝箱賦值探針（`t246`–`t248`，三個都是已知失敗），而且不再列
`t180`／`t196`（W5 的測試工作把它們拿掉了）。這一頁引用 main 的那一組；語料那 45 支我自己重跑過，
整套那一行依照上面標的來源。

**在語料進來之前，這一頁宣稱的是子集，不是那句話。** 適用範圍是
[docs/language.md](/docs/language) §12（語法層）與 §13（缺的 API 與被誤拒的寫法），
而它們不是空的。

### 兩個後端的語意一致性（W8，**已合入 main**）

**矩陣先落地（`#122`）**：`scripts/backend-matrix.sh` 與 `make backend-matrix` 把 `tests/programs`
的每一支程式在**六個格子**裡建置並執行——{C＋clang、C＋gcc、LLVM} × {`-O0`、`-O2`}——每一格與
`.expected`／`.exit`／`.experr` 比，格子之間再互相比；被驅動具名拒絕的建置（例如 LLVM 的
`TY-INT-0100`）算「拒絕」而不是「編錯」。發佈的工作流程會呼叫它，與 `make ci`／`make jdk-diff`／
`make notices` 並列。允許的跨格差異寫在 `scripts/backend-matrix-allow.txt`：沒有工作項與原因的
條目不收，而已經不再分歧的條目會讓它失敗。矩陣量到的停止點數字（406 格、66 支程式六格齊全）
留在 §2。

**它找到的兩個真實缺陷，兩個都修好了（`#129`、`#131`）。**

- **裝箱目標的複合指定**：兩個後端現在共用同一個降階（JLS 15.26.2 的拆箱→運算→裝箱），所以
  `1L <<= 33` 是 `8589934592`（JDK 的答案），紅先測的 `t246`／`t247`／`t248` 現在通過——那三條
  `known-failures.txt` 條目已經刪掉，這是它要求刪的。
- **`a + b + c` 的求值順序**：C 後端不再把運算式摺成單一 C 運算式，所以 gcc 與 clang 都印
  `1(1)2(2)3(3)=6`，與 javac 21 相同（我兩個 `--cc` 各建一次驗的）。

**一件仍然不宣稱的事實說出來**：Java 的 `HashMap` 在表長到 64 格之後，同一個桶超過 8 個元素時
會把它樹化，而樹化後的次序由 `System.identityHashCode` 決勝——那個值原則上不可重現。所以那個
形狀的迭代順序我們**不宣稱**與 JDK 相同。**64 格以下不會樹化**，所以任何更小的表在任何鍵集合上
都走 Java 的順序（我對照 JDK 驗過：六個字串鍵，以及 20 個只有 `hashCode` 的自訂鍵型別）。

### TLS 可達性與平台（W9，已合入 main）

TLS 現在由**程式的呼叫圖**決定要不要連結，不再因為反射表而自動可達：一個不呼叫 `ssl()` 的
web 程式在沒有 OpenSSL 標頭的機器上照樣建置與服務，Gson 形狀的程式能編給 windows/amd64，
而真的呼叫 `ssl()` 的程式行為不變（連結的內容與輸出都一樣）。透過反射到達 TLS 的呼叫得到
一個具名、可攔截的 `UnsupportedOperationException`，而不是跳到 `NULL`。`tests/run.sh` 與
`go test` 都讀 `TEYRU_TARGET`，`resolveTarget` 也接受呼叫端給的 `--cc`，所以
`darwin/amd64` 與 `darwin/arm64` 可以用 `zig cc` 透過 `teyru build` 建置。

### 基準與宣稱一致（W10）

`examples/bench_*.teyru` 與對應的 `.java` 改成從命令列讀規模，`scripts/bench.sh` 因此輸出
**短跑與長跑兩組表**，並新增 `bench_string_cjk`（非 ASCII 的拼接、`charAt` 走訪、`substring`）
與尖峰 RSS；量測窗口跑完了（`RUNS=5 JAVA=1`、`-O2`、樹 `130565a`，進入與離開時的 1 分鐘
負載都低於 1）。**長跑那一組是唯一能支持吞吐結論的，而它說的是 Teyru 一項都沒贏**
（`fib` 平手，其餘 Java 快 1.13～6.8 倍）；短跑那組的優勢是啟動，不是吞吐。這一頁不重述
數字，因為它們必須連著量測方法讀：見 [docs/index.md](/docs) 的〈為什麼比 JVM 快〉。
GraalVM 的 `native-image` 對照**未測**（這台機器上沒有 GraalVM），如實寫成未測。

### 第三方聲明與文件規範（W11、W12，已合入 main）

- `THIRD-PARTY-NOTICES.md` 補上 OpenSSL（版本下限 1.1，動態連結）、Windows 目標靜態連結的
  mingw-w64 執行期、主機自己的 IANA tzdata（不散布、不內建）與 W5 的 Unicode 資料（Unicode
  License v3）；執行期不再逐檔列名，而是按目錄宣告，清單由 `scripts/check-notices.sh`
  （`make notices`）產生、也由同一個腳本核對。
- `AGENTS.md` 增補三條規則：Java 語意的改動必須附 JDK 差分測試、面向外部輸入的程式碼必須附
  對抗測試、文件裡的每一條能力聲明都要指得到測試。
- **GPL-2.0 with Classpath Exception 與 OpenSSL 3（Apache-2.0）的相容性**列為需要 owner 決定，
  文件只敘述事實、不下結論（見 [docs/legal.md](/docs/legal) §9）。

---

## 2. 量到什麼

數字都連著方法與環境讀；這一頁只放幾個這一版特有的：

| 量到的東西 | 數字 | 怎麼量的 |
|---|---|---|
| 執行檔大小（hello world，`-O2`） | **67,240 B**（`-O0` 118,608、`-O1` 90,352、`-O3` 70,672） | `wc -c`；比 0.2 時代的 55,920 大，三次成長是裝箱快取（+6,016）、堆疊檢查（+2,256）與 W9 的 TLS 連結（+120），量在 [docs/index.md](/docs) |
| LLVM 後端的邊界 | `tests/programs`（`34584f2`）256 支裡 159 支建得起來、153 支輸出相同、93 支具名拒絕 | 2026-09-17，`teyru build --backend=llvm` 逐支跑並與 `.expected` 比（[docs/index.md](/docs) 有完整分類） |
| `linux/arm64` 的整套 | **250 項全過、0 項不符**（qemu-aarch64，容器裡的 sysroot 自建）；W9 之後用 `TEYRU_TARGET` 重測：**286 項裡 271 過、5 失敗、10 已知失敗**，而 5 個失敗**原生也一樣失敗** | `sh tests/run.sh` 與 `TEYRU_TARGET=linux/arm64 … sh run.sh`，見 [docs/index.md](/docs) 的平台表 |
| Windows 目標 | 195 支裡 179 支逐位元組相同（Wine 下跑） | 同上 |
| macOS 兩列 | **只到「編譯並連結」**：257 支裡 240 支建得起來、9 支因 TLS 被具名拒絕、8 支那個版本的編譯器還不接受；產物是 Mach-O，**沒有任何一行被執行過** | `teyru build --cc <zig 包裝>`（`zig cc -target aarch64-macos`），見平台表 |
| 遞迴過深的代價 | `bench_fib` 長跑回退約 32% | `scripts/bench.sh` 長跑前後，owner 已裁決接受 |
| W7 的語料 | **45 支全過、0 失敗**（`tests/java-compat`；Teyru main `9be8159` → `tests` `4ac49a7`） | `sh tests/run.sh java-compat`，在 main 上的那個內容跑（我自己跑的；`make java-compat` 是同一件事） |
| 字串與 Unicode（W5）的 JDK 差分 | 寫的一半 **32/32 逐位元組相同**；讀的一半 **39/41**，其餘兩項是已聲明的差異 | 同一支程式寫兩次（`.teyru` 與 Java），`/opt/jdk21/jdk-21.0.11+10` 跑 Java 那一半再逐行 diff；於 `9be8159` 上跑 |
| W8 的兩個缺陷 | 裝箱複合指定 `1L <<= 33` → `8589934592`；`f(1)+f(2)+f(3)` 在 clang 與 gcc 都印 `1(1)2(2)3(3)=6` | `t246`–`t248`（已從 `known-failures.txt` 拿掉）與一支 `--cc` 各建一次的程式；與 javac 21 比對 |
| 整套測試 | **324 過、1 失敗、10 已知失敗、0 跳過**——量在 `0e8e592` → `tests` `af41a7d` 的內容上（比現在的主線舊：`known-failures.txt` 當時有 10 條，現在是 4 條），唯一的失敗是 `native/net_c_test` 的連結失敗 | `sh tests/run.sh`；log 與名單見 PR [#128](https://github.com/teyru-lang/Teyru/pull/128) 的留言（這一列不是我自己跑的；重測會在 tag 的那個 commit 上跑，之後補上） |

（macOS 那一列是 W9 之後重量的（2026-09-17，`tests` @ `e4268a6`，編譯器 `5ac017b`）；
`linux/arm64` 那一列 W9 之後的 `TEYRU_TARGET` 重測已經跑完，兩個數字都寫在上面。）

---

## 3. 還沒實作

完整的清單在 [docs/language.md](/docs/language) §13，與標準程式庫的缺口在同頁 §11；
執行期與執行緒的已知限制在 `AGENTS.md` §10。這一頁不複製它們，只說方向：

- checked exception 沒有編譯期檢查；
- `sealed` 的 `permits` 子句沒有被驗證（switch 窮盡性因此要求 `default`）；
- 反射沒有泛型型別參數，所有的陣列共用一個類別；
- 與 Java 生態互通（JAR、JDK 類別庫、JNI）沒有，這是刻意的取捨；
- locale 相關的大小寫映射（`tr`、`az`、`lt`）沒有實作，`String.toUpperCase()` 一律走 root locale 的規則。

## 4. 這一版不宣稱什麼

- **速度**。0.4.0 是正確性版本：計畫的第 5 階段（W13 編譯速度、W14 執行期性能）不在這一版，
  而且 W14 在計畫裡本來就是選用的。已經量到的**回退**如實寫在上面（`bench_fib` 長跑 32%），
  而 W10 的長跑表就是這個立場的證據：六列裡 Teyru 一列都沒贏（`bench_alloc` 那一列要排除在外——
  它量的是「Teyru 真的配置」對上「Java 把配置最佳化掉」，關掉 JIT 之後同一支程式 Teyru 反而快
  約 20 倍，見 [docs/index.md](/docs) 的說明）。唯一的例外是啟動、執行檔
  大小與尖峰記憶體——那三項是量到的，也是這一版真正贏的地方。
- **精確或分代收集器**。owner 的順序是「先把這些修好、切 0.4，再談把伺服器的執行期換成
  精確或分代的收集器」，所以那是下一個版本的事；0.4 的收集器仍然是保守式標記清除。
- **macOS 可以跑**。那兩列只到「編譯並連結」：沒有任何 Mach-O 執行檔被執行過（這裡沒有
  一台 macOS），而「編譯成功」不等於「跑得起來」。
- **`HashMap` 在那個形狀上的迭代順序**。表長到 64 格以後、同一個桶超過 8 個元素時 Java 會
  樹化，而樹化後的次序由 `System.identityHashCode` 決勝——那個值原則上不可重現，所以那個
  形狀我們不宣稱與 JDK 相同（64 格以下不會樹化，見 W8 那一節）。
- **「Java 原始碼不改就能編」當成一句沒有範圍的話**。W7 已合入 main，未修改的 Java 在**測過的
  子集**上編得過（見上），但語料還沒進 main 的 submodule 指標，而 §12／§13 的差別也還在——
  所以這一版宣稱的是那個子集，不是那句話。
- **與 javac 一致**。我們不是一致的：`'😀'` 在這裡是 `TY-SYN-0008`（一個 `char` 字面值只收一個
  UTF-16 code unit），而 JDK 21 **接受**它並取 55357——這一條是我們比較嚴，不是我們對。
- **checked exception 有被追蹤**。完全沒有：`throws` 只被解析，JDK 差分裡 javac 拒絕的 16 個
  案例有 8 個是這個原因（`tests/jdk-diff-allow.txt` 逐條寫著）。owner 決定把這條留成文件化的
  差異，不是待辦事項。
- **靜態初始化的急切程度與 Java 相同**。這個編譯器在 `main` 之前先初始化程式自己的類別，
  Java 是第一次使用時才初始化；語意差異與它的測試寫在 `AGENTS.md` §10。
- **LLVM 後端與 C 後端同等**。它**不是**發佈建置預設用的後端（預設是 C），而且兩者還不同等：
  2026-09-17 實測 256 支測試程式，159 支建得起來、其中 153 支輸出與期望完全相同、6 支不同
  （JDK 探針，列在 `known-failures.txt`）、93 支被具名拒絕、0 個模組 clang 不收；lambda 與
  方法參照現在不在拒絕名單裡，排在最前面的是要靠註解的宣告（38）。完整的拒絕分類見
  [docs/index.md](/docs) 的〈後端與平台〉。
- **有 CI**。這個專案沒有在 push 或 PR 上跑的 CI（owner 的決定），關卡是人在這台機器上跑
  `make ci`；唯一的工作流程是發佈 release 時那一個。

## 5. 需要 owner 操作或決定

- **授權**：GPL-2.0 with Classpath Exception 與 OpenSSL 3（Apache-2.0）的相容性，以及散布
  「靜態連結了 mingw-w64 執行期」的 windows/amd64 產物時的義務（[docs/legal.md](/docs/legal) §9）。
- **文件站的自動部署**：把 Vercel 的 GitHub App 授權給 `teyru-lang` 組織，在那之前每次文件
  改動都要有人手動 `vercel deploy --prod`。
