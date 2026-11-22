---
title: "還沒有的東西"
description: "標準程式庫之外、一個真實程式會撞到的整層能力：哪些在做、哪些沒有，以及沒有的那一層現在用什麼替代。"
---

這一頁回答一個問題：**拿 Teyru 寫一個真的服務或工具，會在哪裡停下來？**
它不列語言缺口的細節（那在[語言參考](/docs/language) §13），也不列單一 API 的
差異（在 §11 的套件表）；它列的是**整層**——一層能力不存在時，不是少一個方法，
是那個工作得換做法。

每一列都寫「現在有什麼」，因為「沒有 JDBC」不等於「不能連資料庫」，它等於
「連資料庫的那一段要自己寫」。沒有實測支撐的敘述不寫在這裡。

## 資料與互通

| 能力 | 現況 | 現在怎麼做 |
|---|---|---|
| SQL 存取（JDBC、連線池、ORM、migration） | **沒有**。標準程式庫裡沒有任何 SQL 字串、沒有任何 driver 掛鉤 | 透過 `ProcessBuilder` 呼叫 `psql`／`sqlite3`，自己解析輸出；或寫一個 `native` 方法接上 C 的 client library |
| XML、YAML、TOML、CSV | **有**（`lib/56`–`lib/59`）：四個讀寫器，各自拒絕未實作的建構，XML 的 `DOCTYPE` 是防 XXE 的具名拒絕 | 直接用；規範在[語言參考](/docs/language) §11 |
| Java 序列化（`Serializable`／`ObjectStream`） | **沒有**，也不會加：那是把 JVM 的類別描述寫進位元組，與原生執行檔的模型不相容 | 自己的格式（JSON 綁定已經有）或 `DataOutputStream` 的明確格式 |
| JAR、JDK 類別庫、JNI | **具名拒絕**。這是產品契約的取捨（沒有 JVM），不是待辦 | 原生互通用 C 的 `native` 方法，見[原生互通](/docs/native) |
| 子行程 | **有**：`ProcessBuilder`／`Process`，三個串流、目錄、環境、結束碼 | 直接用；沒有 shell 介入，要 shell 就寫 `sh -c` |

## 密碼學

| 能力 | 現況 |
|---|---|
| 雜湊 | **有**：MD5、SHA-1／224／256／384／512，純 Teyru。SHA-3 是**具名拒絕**（寧可 `NoSuchAlgorithmException`，也不要給一個不是呼叫者指名的那種雜湊） |
| 對稱式加密 | **有**：AES-128／192／256 於 ECB／CBC／CTR／GCM，PKCS#5 填充，GCM 的 tag 先驗過才回明文 |
| 非對稱 | **一半**：RSA PKCS#1 v1.5 的**驗證**與 `Cipher` 的公開金鑰運算；**沒有簽章產生**（私鑰操作的取捨寫在 `lib/53_rsa.teyru` 開頭） |
| HMAC、CSPRNG | **有**：`Mac`（六種 Hmac*）、`SecureRandom`（`getrandom`／`/dev/urandom`／`BCryptGenRandom`，沒有來源時拋例外而不是回零） |
| X.509 憑證解析、`KeyStore` | **沒有**。TLS 把整包交給 OpenSSL，語言層看不到憑證內容；要驗憑證欄位得自己寫 DER 解析（`KeyFactory` 的 DER 讀取是起點） |

## 網路

| 能力 | 現況 |
|---|---|
| 同步 socket、TLS、HTTP/1.1 客戶端與伺服器、WebSocket | **有** |
| 非阻塞 I/O 與 `Selector` | **有**（`java.nio` 的 heap `ByteBuffer`、三個 channel、`poll`／`WSAPoll` 的 selector） |
| HTTP/2、HTTP/3、SSE | **沒有**。HTTP/1.1 的 keep-alive、chunked 與 gzip 有，這三個協定沒有 |
| 非同步 channel、`FileChannel`、`Charset` | **沒有**（字串的編碼在執行期只有 UTF-8 一條路） |
| 執行緒池與同步器 | **有**：`Executors`、`CountDownLatch`、`Semaphore`、`CyclicBarrier`、`ReentrantLock`、`Atomic*`、`ConcurrentHashMap`；**沒有** `CompletableFuture`、`ForkJoinPool`、`ReadWriteLock`、`Exchanger`；`parallelStream()` 回的是循序 stream |

## 文字、資料與地區

| 能力 | 現況 |
|---|---|
| 正則表達式 | **有**：前後視、反向參考、具名群組、佔有量詞、原子群組、旗標、`\p{...}`；`\G`／`\R`／`\X`／POSIX 類別是具名拒絕 |
| JSON | **有**：樹狀 API、Gson 形狀的綁定、串流的 `JsonReader`／`JsonWriter` |
| 地區化 | **有**：`Locale` 帶著每個 locale 的數字、貨幣、日期 pattern 與名稱（讀自 OpenJDK 21）；**沒有** `Collator`、`BreakIterator`、`ResourceBundle`——那三個是各自的資料集 |
| Base64 | **有**：基本、URL-safe、MIME 三種編碼與解碼 |
| 日期時間 | **有**：`Instant`、`LocalDate` 家族、`ZoneId`（讀主機 tzdata）；**沒有** `java.util.Date`／`Calendar`，也沒有閏秒 |

## 工具與可觀測性

| 能力 | 現況 |
|---|---|
| 測試 | **有**：`teyru test`，見[測試規範](/docs/testing) |
| 日誌 | **有**：`java.util.logging` 形狀（等級、handler、formatter、JSON 格式） |
| 堆疊追蹤 | **沒有**。例外只有類別名與訊息；失敗的座標是方法名，這也是[測試規範](/docs/testing)要求「一個方法一個行為」的原因 |
| 指標、trace、profiler | **沒有內建**。`-g` 的 DWARF 讓 `perf` 之類的外部工具看得到原始碼行 |
| 套件生態 | **有**：`teyru.mod` 與 `teyru get`（見[模組](/docs/modules)）；**沒有**一個公開的中央索引站，取用靠 import path |

## 平台

| 目標 | 現況 |
|---|---|
| linux/amd64 | **完整**：整套測試 |
| linux/arm64 | **在 qemu 下有整套的結果**（2026-09-17 量的 250 項，0 不符） |
| windows/amd64 | **交叉編譯並在 Wine 下跑**（2026-10-20 量的 318 支，0 不符）；碰 TLS 的程式是具名拒絕（mingw-w64 沒有 OpenSSL） |
| darwin/* | **只到「編譯並連結」**：這裡沒有 macOS，**沒有任何一行程式在它上面跑過**。這是本頁唯一「不知道」而不是「沒有」的一格 |
