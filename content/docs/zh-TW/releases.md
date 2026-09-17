---
title: "版本與變更"
description: "Teyru 的版本：0.4.0 是正確性版本——改了什麼、量到什麼、還沒實作什麼，以及這一版刻意不宣稱什麼。"
---

這一頁描述 **0.4.0**：這個專案第一個以「正確性」為主題的版本。它處理的是外部審查與實測
找出來的一批問題（計畫的 W1–W12），不是速度——速度是下一個階段的事。

這一頁在 0.4.0 發佈前寫成，所以每一項都標了狀態：**已合入 main** 的項目就是讀者現在裝得到
的行為；**部分進行中**、**尚未合入 main** 與**尚未開始**的項目各自附上 PR 或工作項，合入之後
才改標記。發佈時整頁不該再有前三種以外的狀態。

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

### 字串與 Unicode（W5，**尚未合入 main**）

這一項**不在** 0.4.0 目前的主線上：第一部分的 PR 還是 draft，其餘部分還在後面。目標是讓
字串的儲存與索引語意對齊 Java——`length`／`charAt`／`substring`／`indexOf`／`compareTo`／
`hashCode` 以 UTF-16 code unit 計算（`"中文".length()` 是 2），`Character` 的分類與大小寫
映射改用 Unicode 15.0 的資料與完整大小寫映射（`ß` → `SS`、希臘語詞尾 sigma），`strip` 認得
全角空白，邊界上的非法 UTF-8 以 U+FFFD 取代、沒有夥伴的代理以 `?` 編出。內部儲存是
WTF-8 加麵包屑（`tystr` 仍是 24 位元組），「改用 JDK 式 compact strings」那個備案還需要
基準數據才能比較，所以這一版不下結論。

在它合入之前，**今天的**行為與 JDK 的差別（含實測數字）寫在
[docs/language.md](/docs/language) §12 第 12 條，缺的 API 在 §13；位元組邊界的測試
（`t196_string_bytes`）在測試倉庫裡。

### 裝箱、容器順序與例外名稱（W6，部分進行中）

- **裝箱快取**（已合入）：`Integer`／`Short`／`Byte`／`Long` 快取 −128..127、`Character`
  快取 0..127、`Boolean` 只有兩個實例，所以 `Integer.valueOf(127) == Integer.valueOf(127)`
  與 Java 一樣是 `true`；跨過一次呼叫也不會壞（`t242_box_identity_across_call`，期望值由
  javac 產生）。
- **越界訊息**（已合入）：`Index 5 out of bounds for length 3`（大寫 `I`，JDK 的句子）。
- **還沒做的兩項**：`HashMap`／`HashSet` 的迭代順序對齊 JDK 21，以及例外的全限定名
  （`java.lang.*` 而不是 `teyru.*`）。兩者都列在 §13，迭代順序的實測寫在 §13 那一條，
  類別名的差異寫在 §12 第 14 條。

### Java 原始碼相容（W7，**尚未合入 main**）

**main 上還沒有東西，但分支上有一半量得到的東西**：`w7-java-compat` @ `be050f0` 的語料
（`tests/java-compat/`）是 **45 支**未經修改的 Java 程式、**45 支全綠**，而**推論的那一半回來了**
（子型別走訪會終止，所以把巢狀呼叫的引數對著參數檢查不再讓既有程式退步）。覆蓋到的推論現在包含
**collector 鏈**（`collect(Collectors.toList())`、`groupingBy(…, counting())`、`partitioningBy`）與
**經過接收者的鏈**（`Comparator.comparing(f).thenComparing(g)`、`nullsFirst(nat)` 放在另一個呼叫裡），
所以下面清單不再把那兩族列成沒做。**這一頁仍然不宣稱那句話**，因為它在分支上，不在 main。

目標是讓「Java 原始碼不改就能編」在一個可測試的子集上成立：分號可選、接受 `.java` 副檔名、
依 JLS §14.22 與第 16 章做可達性與明確指派（修掉 `switch` 結尾方法的 `TY-TYP-0020` 誤報）、
補齊缺的 API 與常見的泛型推論。在它合入之前，這一頁不宣稱那句話——今天的差異在
[docs/language.md](/docs/language) §12 與 §13，而 [docs/index.md](/docs) 的〈支援的語言特性〉
寫的是「Java 開發者一看就懂」，不是「不改就能編」。

### 兩個後端的語意一致性（W8，**矩陣已合入 main，語意統整還沒開始**）

**矩陣先落地了（#122）**：`scripts/backend-matrix.sh` 與 `make backend-matrix` 把 `tests/programs`
的每一支程式在**六個格子**裡建置並執行——{C＋clang、C＋gcc、LLVM} × {`-O0`、`-O2`}——每一格與
`.expected`／`.exit`／`.experr` 比，格子之間再互相比；被驅動具名拒絕的建置（例如 LLVM 的
`TY-INT-0100`）算「拒絕」而不是「編錯」。發佈的工作流程會呼叫它，與 `make ci`／`make jdk-diff`／
`make notices` 並列。允許的跨格差異寫在 `scripts/backend-matrix-allow.txt`：沒有工作項與原因的
條目不收，而已經不再分歧的條目會讓它失敗。

跑了一半的數字（為了 W10 的量測窗口暫停）：**1572 格裡記下 406 格、66 支程式六格齊全**；clang
那兩格 68/68 與 67/67 都符合套件，LLVM 44/44 符合而每格有 25 支被具名拒絕，gcc 那兩格 61/66 與
62/67。這些是**停止點**的數字，不是總數。

矩陣已經找到兩個真實缺陷，都在 W8 點名的家族裡：**裝箱目標的複合指定兩個後端都不降階**
（C 後端把運算子交給包裝參考：不合法的 C 或段錯誤；LLVM 後端對位元運算產生 `and ptr` 這種不合法
的 IR，而 `1L <<= 33` 得到 2，JDK 是 8589934592——紅先測是 `t246`／`t247`／`t248`，列為 W8 的已知
失敗）；以及 **`a + b + c` 的求值順序**：C 後端把它摺成同一個 C 運算式，而 C 沒有指定順序，所以
gcc 由右而左、clang 由左而右，`f(1)+f(2)+f(3)` 在 javac 21 與 clang 是 `1(1)2(2)3(3)`、在 gcc 是
`1(3)2(2)3(1)`，五支既有程式看得到——它還不能寫成 `tests/programs` 的案例，因為
`known-failures.txt` 表達不了「只在 gcc 下失敗」。

語意統整本身（把數值提升、複合賦值、移位、串接、裝箱與檢查的規則下沉成共享的降階）**還沒
開始**。
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
| 執行檔大小（hello world，`-O2`） | **66,808 B**（`-O1` 85,440、`-O3` 70,248） | `wc -c`；比 0.2 時代的 55,920 大，三次成長是裝箱快取（+6,016）、堆疊檢查（+2,256）與 W9 的 TLS 連結（+120），量在 [docs/index.md](/docs) |
| LLVM 後端的邊界 | `tests/programs`（`34584f2`）256 支裡 159 支建得起來、153 支輸出相同、93 支具名拒絕 | 2026-09-17，`teyru build --backend=llvm` 逐支跑並與 `.expected` 比（[docs/index.md](/docs) 有完整分類） |
| `linux/arm64` 的整套 | **250 項全過、0 項不符**（qemu-aarch64，容器裡的 sysroot 自建）；W9 之後用 `TEYRU_TARGET` 重測：**286 項裡 271 過、5 失敗、10 已知失敗**，而 5 個失敗**原生也一樣失敗** | `sh tests/run.sh` 與 `TEYRU_TARGET=linux/arm64 … sh run.sh`，見 [docs/index.md](/docs) 的平台表 |
| Windows 目標 | 195 支裡 179 支逐位元組相同（Wine 下跑） | 同上 |
| macOS 兩列 | **只到「編譯並連結」**：257 支裡 240 支建得起來、9 支因 TLS 被具名拒絕、8 支那個版本的編譯器還不接受；產物是 Mach-O，**沒有任何一行被執行過** | `teyru build --cc <zig 包裝>`（`zig cc -target aarch64-macos`），見平台表 |
| 遞迴過深的代價 | `bench_fib` 長跑回退約 32% | `scripts/bench.sh` 長跑前後，owner 已裁決接受 |

（macOS 那一列是 W9 之後重量的（2026-09-17，`tests` @ `e4268a6`，編譯器 `5ac017b`）；
`linux/arm64` 那一列 W9 之後的 `TEYRU_TARGET` 重測已經跑完，兩個數字都寫在上面。）

---

## 3. 還沒實作

完整的清單在 [docs/language.md](/docs/language) §13，與標準程式庫的缺口在同頁 §11；
執行期與執行緒的已知限制在 `AGENTS.md` §10。這一頁不複製它們，只說方向：

- checked exception 沒有編譯期檢查；
- `sealed` 的 `permits` 子句沒有被驗證（switch 窮盡性因此要求 `default`）；
- 反射沒有泛型型別參數，所有的陣列共用一個類別；
- 與 Java 生態互通（JAR、JDK 類別庫、JNI）沒有，這是刻意的取捨。

## 4. 這一版不宣稱什麼

- **速度**。0.4.0 是正確性版本：計畫的第 5 階段（W13 編譯速度、W14 執行期性能）不在這一版，
  而且 W14 在計畫裡本來就是選用的。已經量到的**回退**如實寫在上面（`bench_fib` 長跑 32%），
  而 W10 的長跑表就是這個立場的證據：六列裡 Teyru 一列都沒贏。唯一的例外是啟動、執行檔
  大小與尖峰記憶體——那三項是量到的，也是這一版真正贏的地方。
- **精確或分代收集器**。owner 的順序是「先把這些修好、切 0.4，再談把伺服器的執行期換成
  精確或分代的收集器」，所以那是下一個版本的事；0.4 的收集器仍然是保守式標記清除。
- **macOS 可以跑**。那兩列只到「編譯並連結」：沒有任何 Mach-O 執行檔被執行過（這裡沒有
  一台 macOS），而「編譯成功」不等於「跑得起來」。
- **Java 原始碼不改就能編**（W7 尚未開始）。
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
