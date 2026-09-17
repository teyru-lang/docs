---
title: "框架：Spring 形狀的容器與 web 層"
description: "依賴注入與請求綁定都在編譯期做完，而不是像 Spring 那樣在啟動時用反射掃描。"
---

`lib/17_container.teyru`、`lib/18_web.teyru` 加上 `internal/sema/framework*.go` 構成
一個應用程式框架，介面照 Spring 抄，實作方式不同。

## 為什麼不是反射

Spring 在啟動時掃描 classpath、讀註解、用反射建立與注入 bean、把請求綁到方法。
這裡的容器也讀註解、也用反射建立與注入（`lib/28_container_reflect.teyru`）——
差別在 bean 清單：沒有 classpath 可以掃，所以清單是編譯器列出來的，其餘每一件事
都是啟動時從類別本身讀出來的。

兩邊的差別是具體的：

| | Spring | Teyru |
|---|---|---|
| bean 從哪來 | 執行期掃描 classpath | 編譯器列出帶 `@Component` 等標註的類別（沒有 classpath 可掃） |
| 讀註解與注入 | 執行期反射 | 執行期反射，讀的是類別本身 |
| 缺少 bean | `NoSuchBeanDefinitionException`，啟動時 | `IllegalStateException`，`refresh()` 時 |
| 循環相依 | `BeanCurrentlyInCreationException`，啟動時 | `IllegalStateException`，`refresh()` 時，訊息裡有環 |
| 執行期新增 bean | 可以 | 不行（清單來自編譯器） |
| 啟動成本 | 掃描與反射 | 反射，沒有掃描 |

代價是明確的：bean 清單在編譯期就固定，執行期加不了；而缺少 bean、兩個候選、
相依成環這些錯誤也從編譯錯誤變成 `refresh()` 時的例外——那是 Spring 的取捨，也是
改用反射之後換到的東西。

## 容器

```teyru
import teyru.*

@Repository
class UserRepo {
  String find(String id) { return "user " + id }
}

@Service
class UserService {
  @Autowired UserRepo repo
  @Value("${app.name:unnamed}") String appName
  private boolean ready = false

  @PostConstruct
  void start() { ready = true }

  String describe() { return appName + ": " + repo.find("7") }
}

class Main {
  public static void main(String[] args) {
    ApplicationContext ctx = new ApplicationContext()
    ctx.setProperty("app.name", "demo")
    ctx.refresh()
    UserService s = (UserService) ctx.getBean(UserService.class)
    System.out.println(s.describe())
  }
}
```

### 支援的註解

| 註解 | 意思 |
|---|---|
| `@Component`／`@Service`／`@Repository`／`@Controller`／`@RestController` | 這個類別是 bean；名稱預設是首字母小寫的類別名，`@Component("x")` 可改 |
| `@Configuration` + `@Bean` | 這個類別本身也是 bean，它的 `@Bean` 方法各產生一個 bean |
| `@Autowired` | 欄位、建構子參數或 `@Bean` 方法參數由容器提供 |
| `@Qualifier("name")` | 同型別有多個時指名 |
| `@Primary` | 同型別有多個時的預設選擇 |
| `@Value("${key}")`／`@Value("${key:default}")` | 注入屬性 |
| `@PostConstruct` | 建好並注入後呼叫（無參、回 void） |
| `@Scope("prototype")` | 每次查詢都建新的；預設 singleton |

### 建構子選擇

Spring 4.3 起的規則：只有一個建構子就用它，否則找標了 `@Autowired` 的，否則用無參
的那個。被選上的建構子，每個參數都要自己標 `@Autowired`（或 `@Value`）才會被注入：
沒標的參數不會被填，產生的工廠就用少掉的引數呼叫它，編譯以 `TY-TYP-0072` 失敗。
標了多個 `@Autowired`，或都沒有而有多個又沒有無參建構子時，是 `TY-TYP-0105`。

### 生命週期

`refresh()` 會把每個 singleton 都建起來，所以建構與注入的失敗會在啟動時（而不是
第一次請求時）報出來——**缺 bean、同一型別有兩個候選、相依成環都是這個時候才失敗**，
不是編譯期：`@Service class Needs { Needs(NoAnno other) }` 這種寫法編得過，`refresh()` 時
以 `parameter 0 of Needs is neither @Value nor @Autowired` 停下來（Spring 也是啟動時才
發現，所以 `TY-TYP-0103` 已經移除）。bean 的建立是遞迴的：要 A 就先建它需要的 B，
`creating` 旗標擋住環。

`@PostConstruct` 由產生的注入器在注入完成後呼叫。`@PreDestroy` 已宣告但**沒有**
執行——Teyru 沒有行程關閉鉤子，容器也沒有 `close()`。

## Web 層

```teyru
import teyru.*

@RestController
@RequestMapping("/pets")
class PetController {
  @Autowired PetStore store

  @GetMapping("/{id}")
  Pet one(@PathVariable("id") int id) { return store.find(id) }

  @GetMapping("")
  String list(@RequestParam(value = "q", defaultValue = "all") String q) {
    return "q=" + q
  }

  @PostMapping("")
  Pet create(@RequestBody String body) { return new Pet(body, 1) }
}
```

| 註解 | 意思 |
|---|---|
| `@RequestMapping`（類別上） | 路徑前綴 |
| `@RequestMapping`（方法上） | 路徑與 `method`（不寫是任何動詞） |
| `@GetMapping`／`@PostMapping`／`@PutMapping`／`@DeleteMapping`／`@PatchMapping` | 路徑與動詞 |
| `@PathVariable` | 路徑裡 `{name}` 的值，會轉成參數的型別 |
| `@RequestParam` | 查詢參數，`defaultValue` 可給預設 |
| `@RequestHeader` | 請求標頭（名稱不分大小寫）；`defaultValue` 是沒有這個標頭時的值，沒給就是空字串 |
| `@RequestBody` | 請求主體；參數是 `String` 就原樣拿到，是類別（或 record）就以 Gson 綁定解析 |
| `@ResponseBody` | 已宣告；`@RestController` 本來就隱含，所以有沒有都一樣 |

**參數轉型**：路徑與查詢參數都是字串，所以 `int`、`long`、`double`、`float`、
`short`、`byte`、`boolean` 的參數會經由對應的 `parseX` 轉換（`int` 用
`Integer.parseInt`）。

**請求主體**：`@RequestBody` 的參數是 `String` 時拿到原樣的主體（想自己看的
payload 就是這樣接），是類別或 record 時由**編譯器為該型別產生的 Gson 綁定**解析
——Spring 依 `Content-Type` 挑訊息轉換器，這裡型別在編譯期就知道了，轉換器就是那
個綁定。解析失敗丟的是同一個 `JsonSyntaxException`。沒有 JSON 映射的型別是編譯
錯誤，不是第一次請求時的例外。

**回應**：回傳 `HttpResponse` 就完全自己決定；回傳 `String` 是 `text/plain`；回傳
`void` 是空主體；其他一律由 Gson 綁定寫成 `application/json`（見 `docs/json.md`）
——record、enum（寫成常數名稱的字串）、陣列、`List`、`Map` 都一樣。原本「基本型別
沒有映射」的 `TY-TYP-0111` 已經移除，綁定現在收得下所有型別。

**處理函式的參數**：型別是 `HttpRequest` 的參數就是這個請求本身（名字不拘），
Spring 把 `HttpServletRequest` 交給處理函式也是這樣；其餘沒有標註的參數照舊當成
同名查詢參數。

**路由**：`Router.match` 取最特定的符合——字面片段勝過變數片段，所以
`/pets/mine` 不會被 `/pets/{id}` 吃掉，與註冊順序無關。路徑存在但動詞不對是 405，
路徑不存在是 404。

### 伺服器

```teyru
ApplicationContext ctx = Application.boot(args)
Router router = Application.routerFrom(ctx)
HttpServer server = new HttpServer(port, router, ctx)
```

`HttpServer.handle(HttpRequest)` 是請求進來後唯一的入口——它與 socket 迴圈分開，
所以不需要連線就能測：`tests/programs/t102_web.teyru` 與
`tests/programs/t141_web_param_errors.teyru` 就是這樣測的，後者涵蓋轉型失敗的 400、
enum 參數與回傳值、`defaultValue`。

**TLS。** `server.ssl(certificate, privateKey)` 收的是 PEM 憑證鏈與其私鑰的**路徑**
（就是 Spring 的 `server.ssl.certificate` 與 `server.ssl.certificate-private-key`），
給了之後這個伺服器接到的每一個連線都是 TLS，`server.isSecure()` 回答它是不是。那組
檔案在設定時就讀取與檢查，所以用不了的憑證在這裡失敗——程式還說得出哪裡錯——而不是
讓每一個進來的客戶端失敗。自己建 `HttpServer` 的程式（下面〈伺服器跑在自己的執行緒
上〉那一節、以及 `Application.boot` ＋ `routerFrom` 那條路）就是自己呼叫它；
`Application.serve(ctx, port, idleMs)` 會讀上面那兩個屬性，有
`server.ssl.certificate` 時自己呼叫 `ssl()`——`SpringApplication.run` 不會。

這一層是 OpenSSL，所以只有 POSIX 的目標有；windows 與 macOS 是具名拒絕，而且在寫出
任何輸出檔之前（見 [docs/native.md](/docs/native)），不碰 TLS 的程式則不會被連結
OpenSSL。W9 之後「碰得到」算的是**程式自己的呼叫圖**（反射的成員表不算），所以一個不呼叫
`ssl()` 的 web 程式在**沒有 OpenSSL 標頭**的機器上也建得起來並照常服務——實測是把 `cc`
換成一個假裝沒有 `openssl/err.h` 的包裝之後，`web.teyru` 建置成功，`GET /ok` 得到
`fine [200]`。伺服器與客戶端在同一個程式裡往返的測試是
`tests/programs/t163_https_roundtrip.teyru`，一次 TLS 連線上的兩個請求與交握逾時是
`t191_tls_keepalive.teyru` 與 `t192_tls_handshake_timeout.teyru`。

**處理函式自己壞掉不會帶走伺服器。** 遞迴過深（見 [docs/index.md](/docs) 的〈執行期
模型〉）在處理函式裡是該請求得到 500，伺服器繼續服務下一個請求，服務執行緒還活著——
`tests/programs/t241_http_stack_overflow.teyru`。

### 並發模型

伺服器有一條執行緒負責 accept，另一串執行緒負責回答。`accept()` 只屬於接收執行緒，別的
都不做：連線（含 TLS 交握）交給工作執行緒之後，接收執行緒在對方還沒送出第一個位元組之前
就回到 `accept()` 了。一個慢的、沉默的、或話沒說完的客戶端佔住的是一個工作執行緒，
listener 照樣收下一個連線。

工作者是 **cached** 形狀（`lib/37_executor.teyru`）：閒下來一秒就結束，工作來了而沒有
閒置的就再開一條。這是執行期的性質，不是調校選擇——這裡沒有 daemon 執行緒，所以固定
大小的池子會讓「服務一個連線就從 `main` 回來的程式」永遠結束不了。

並發有三個上限，三個都是客戶端碰得到的數字：

| 什麼 | 預設 | 超過時 |
|---|---|---|
| 同時回答連線的工作執行緒 | 64 | 連線在佇列裡等 |
| 等工作的連線 | 100 | 接收執行緒回 503（帶 `Retry-After: 1`）然後關閉 |
| WebSocket 工作階段 | 256 | 在 101 之前回 503，連線關閉 |

WebSocket 不由請求的池子服務：工作階段交給它自己的執行緒（`SocketSessionTask`），所以
一條開一下午的工作階段佔的是一個工作階段的額度，不是一個回答請求的工作者。

`stop()`（以及呼叫它的 `close()`）停止接收與收件，把「還沒開始讀請求」的連線直接結束
而不是陪它等，給正在處理的請求 **2 秒**（`SHUTDOWN_GRACE_MS`）完成，然後關掉剩下的。
工作者在 **0.25 秒**（`READ_POLL_MS`）內就會察覺，因為每一個等待都是一次至多那麼長的
輪詢；同一個上限也是「卡在 `recv()` 的工作者不會拖住停止世界收集」的原因。

這一節的行為有測試：`tests/programs/t223_http_concurrency.teyru`（一條連線每 2 秒送
1 個位元組，期間另一個客戶端連 20 個 GET 都在 1 秒內完成；100 個並行客戶端各發 10 個
keep-alive 請求全部 200；2 個工作者／1 個佇列的伺服器回 503）與
`tests/programs/t225_http_serve_loop.teyru`（`serve()` 會回答、`close()` 會結束它、
執行緒會結束）。

### 客戶端的限制

從設定讀出來，預設值如下；屬性的名字就是鍵，讀它們的地方是
`Application.configureLimits`（`Application.configureServer` 的最後一步）：

| 屬性 | 預設 | 意思 | 拒絕 |
|---|---|---|---|
| `server.teyru.max-request-line-bytes` | 8192 | 請求行，以位元組計 | 414 |
| `server.max-http-request-header-size` | 8192 | 整個標頭區塊，以位元組計 | 431 |
| `server.teyru.max-header-count` | 100 | 標頭（與 trailer）個數 | 431 |
| `server.teyru.max-body-bytes` | 10485760 | 請求主體，以位元組計 | 413 |
| `server.teyru.header-timeout-ms` | 10000 | 標頭，從第一個位元組到空行 | 408 |
| `server.teyru.body-timeout-ms` | 30000 | 主體，整體 | 408 |
| `server.teyru.keep-alive-idle-ms` | 15000 | 兩個請求之間的連線 | 連線關閉 |
| `server.teyru.max-requests-per-connection` | 100 | 一條連線上的請求數 | 回應帶 `Connection: close` |
| `server.teyru.worker-threads` | 64 | 同時回答的連線數 | 503 |
| `server.teyru.accept-queue` | 100 | 等工作的連線數 | 503 |
| `server.teyru.websocket.max-connections` | 256 | 開啟的工作階段 | 101 之前回 503 |
| `server.teyru.websocket.max-message-bytes` | 1048576 | 一則訊息，含分片 | 1009 |
| `server.teyru.websocket.idle-timeout-ms` | 60000 | 什麼都不說的工作階段 | 1001 |

`server.max-http-request-header-size` 是 Spring Boot 自己的鍵，其餘在 `server.teyru.*`
底下，形狀照 `server.tomcat.*`。**交握是例外：它有自己的上限，而且沒有鍵**——TLS 交握固定
10 秒（`handshakeTimeoutMs`，`s.setSoTimeout` 用它），與 `header-timeout-ms` 是同一個時鐘上
的兩個常數，所以調那兩個屬性不會動到交握。不是數值的值等於用預設值，而不是拒絕啟動：預設值在
建構上就是安全的數字，而一個因為打錯一個上限就開不起來的伺服器，是沒有人在手機上修得
好的伺服器。

每一個上限都在位元組**到達時**檢查，不是等收完才檢查，所以拒絕發生在成本之前：一個
`Content-Length: 1000000000` 的請求在 1 秒內得到 413，而行程的常駐集不會因為客戶端喊了
一個數字就長大 1 GB（RSS 成長小於 16 MB，在 Linux 上讀 `/proc/self/status` 量的）。
主體讀進的緩衝區跟著實際到達的資料長大。

截止時間是**總時長**，不是單次讀取的逾時。每一次讀取拿到的是「剩餘截止時間」與 0.25 秒
之中較小的一個，所以每 2 秒送 1 個位元組的客戶端在截止時間到達時被拒絕，而不是每一個
位元組都換到一次新的逾時。

限制的測試是 `tests/programs/t221_http_limits.teyru`；位元組主體（`Content-Length` 是
UTF-8 的位元組數、256 個位元組值的 multipart 逐位元組往返）是
`tests/programs/t220_http_body_bytes.teyru`。

### 解析器拒絕什麼（RFC 9112）

`Content-Length` 與 `Transfer-Encoding` 同時出現（400）、`Content-Length` 宣告兩次而值
不同、不是數字、負數、或大到放不下（400）、`Transfer-Encoding` 的最後一個編碼不是
`chunked`（400）、或指名一個這裡沒有實作的編碼（501）、標頭名稱與冒號之間有空白
（400）、延續上一行的標頭（obs-fold，400）、標頭名稱不是 token（400）、HTTP 版本不是
1.0 或 1.1（505）、chunk 大小不是十六進位或溢位（400）、chunk 超過主體上限（413），
以及 `Expect` 指名 `100-continue` 以外的東西（417）。absolute-form 的請求目標依它的
路徑路由。

被拒絕的請求會關閉連線：它宣告的位元組可能還在路上，而一個只有客戶端知道讀到哪裡的
串流，不是下一個請求可以接上去讀的串流。

而這件事有以行為驗的測試，不是只有清單：`tests/programs/t222_http_parser_fuzz.teyru`
（4000 個變異過的請求，0 次崩潰）與 `tests/programs/t221_http_limits.teyru` 的那張表。

### 啟動與設定

```teyru
class Main {
  public static void main(String[] args) {
    SpringApplication.run(Main.class, args)
  }
}
```

`SpringApplication.run` 等同於 `new ApplicationContext()` ＋
`SpringApplication.loadConfig(ctx, args)` ＋ `ctx.refresh()`，設定來源依序是：
工作目錄的 `application.properties`（`--spring.config.name=路徑` 可以換一份），
再疊上 `--key=value` 形式的命令列參數。讀回來用 `ctx.getProperty("app.name")` 與
`ctx.getProperty("app.name", "預設")`，問有沒有用 `ctx.hasProperty(...)`。

`@ConfigurationProperties(prefix = "app")` 標在 bean 上，`app.*` 就會綁進它的欄位，
鍵名比對是寬鬆的：`app.max-size` 綁 `maxSize`、`app.max_size` 也綁。`@Profile("prod")`
的 bean 只在該 profile 生效（`--spring.profiles.active=prod`）。`@PreDestroy` 的方法
在 `ctx.close()` 時執行。

### 跨請求的關注點

| 東西 | 怎麼宣告 | 行為 |
|---|---|---|
| `@ControllerAdvice` ＋ `@ExceptionHandler(X.class)` | 類別上的 advice、方法上的處理 | controller 拋出的 `X`（含子類別）由這個方法回答；回傳值就是回應，可以是 `HttpResponse`、`ResponseEntity` 或主體 |
| `HandlerInterceptor` | 實作介面的 bean | 每個請求都會 `preHandle`，回 `false` 就是 403（由 interceptor 決定內容）；`afterCompletion` 在回應送出前跑 |
| 靜態檔案 | `spring.web.static=目錄` | 沒有路由認領的路徑就找該目錄裡的檔案，Content-Type 依副檔名；路徑含 `..` 一律 404 |
| CORS | `spring.web.cors=來源,來源` | 預檢由伺服器直接回答，不進 controller；標頭蓋在**最後真正送出的**回應上 |

反射呼叫會把例外包成 `InvocationTargetException`，但 advice 看到的是 controller
真正想拋的那個：這層包裝在比對之前先拆掉。

### 會話

```teyru
@GetMapping("/cart")
String cart(HttpRequest req) {
  HttpSession s = Sessions.of(req)
  Object n = s.getAttribute("count")
  int v = n == null ? 0 : ((Integer) n).intValue()
  s.setAttribute("count", Integer.valueOf(v + 1))
  return "count=" + s.getString("count")
}
```

`Sessions.of(req)` 找出這個請求的 cookie 指到的會話，沒有就建一個，並在**伺服器要
送出的回應**上補 `Set-Cookie`（`TEYRUSSESSIONID`，帶 `HttpOnly`）。這裡是唯一能蓋
cookie 的地方：路由的回應是處理函式回傳後才產生的，這也是為什麼處理函式拿到的是
請求而不是注入的回應。

`isNew()` 只在建立它的那個請求為 true，下一個請求起就是 false；`find(req)` 只找不建
（登入頁讀既有會話就是這個）；`invalidate()` 把 id 從 store 拿掉，客戶端手上的舊
cookie 就指不到東西，下一個請求會拿到新的會話；`attributeNames()` 保持首次設定的
順序；`Sessions.count()`／`clear()` 是給測試用的。

**逾時。** `setMaxInactiveInterval(秒)` 給單一會話一個閒置上限，`Sessions.setTimeout(秒)`
給整個 store 一個預設；`0`（或負數）是**沒有限制**，會話自己設了就以自己的為準，否則
用 store 的預設。設定檔寫 Boot 的 `server.servlet.session.timeout`，值是 `30m`、`2h`、
`1d`、`45s` 這種長度或直接寫秒數；`spring.web.session.timeout` 是同一件事的短寫法，
Boot 的那個鍵優先。讀不出來的值當成 `0`（沒有限制）而不是猜一個數字。

逾時的會話等於不存在：`find(req)` 把它從 store 拿掉並回答 `null`，客戶端手上的 cookie
就指不到東西，下一個想要會話的請求會拿到新的（`tests/programs/t181_session_timeout.teyru`）。

**刻意沒有背景清理執行緒。** 這個執行期在行程結束時會 join 每一條執行緒，一條無限迴圈
的清理執行緒會讓程式結束不了；改成每個請求順手檢查幾個會話（游標前進，一次八個），
所以成本攤在流量上而不是交給一條 reaper；`Sessions.prune()` 一次掃完整個 store，給
測試或空閒的時候用。要注意的是：**沒有設 store 預設值時那個游標不做事**——只有自己設
了區間的會話，是靠 `find()` 或 `prune()` 才會被發現。

### 驗證

`lib/36_validation.teyru` 是 Bean Validation 的那一小塊：類別在自己的欄位上宣告約束，
一個呼叫檢查它們。

| 註解 | 意思 |
|---|---|
| `@NotNull` | 欄位不能是 `null` |
| `@Size(min = …, max = …)` | `String` 欄位的長度落在 `[min, max]` 內，兩端都含 |
| `@Min(value = …)`／`@Max(value = …)` | 數值欄位的下界／上界 |

四個都有 `String message() default …`，沒寫就用預設訊息。`Validation.check(bean)` 讀
物件自己宣告的欄位（走的是 JSON 綁定也在讀的那套反射），碰到**第一個**違反約束的欄位
就丟 `ValidationException`，訊息是 `欄位: 訊息`——Spring 會一次報完所有違反，這裡只報
第一個，要看到其餘的可以再問一次。

web 層對**綁定產生的每一個物件**都呼叫它，所以請求主體違反自己型別的約束時，回應是
400，主體是 `bad request: 欄位: 訊息`：客戶端做錯的事，說得出是哪個欄位。`@Min`／
`@Max` 標在非數值欄位、`@Size` 標在非 `String` 欄位時也是 violation，訊息說明那個約束
讀不了這個欄位——那是類別寫錯，但不該讓伺服器崩潰。`tests/programs/t160_validation.teyru`
涵蓋了這些。

**這四個名字是佔走的。** Teyru 的簡單名稱在同一個平坦命名空間裡，所以 `NotNull`、
`Size`、`Min`、`Max` 已經是約束註解的名字，程式不能拿它們當自己型別的名字：自己宣告
一個 `class Size` 之後，`@Size` 就指到那個類別，約束不再被檢查（安靜地不檢查）。

### 上傳（multipart）

`HttpRequest.multipart(String name)` 回答 `multipart/form-data` 請求裡以該欄位名送出的
那個部分，型別是 `MultipartFile`：`name`、`originalFilename`、`contentType`、`content`
（請求主體本來就是字串，所以檔案的內容是以送出的那些字元抵達），加上 `isEmpty()` 與
`size()`；沒有這個欄位時是 `null`。

不是 multipart、`Content-Type` 沒有 boundary、或主體不是它宣稱的那個 multipart 時，
答案也是 `null`，不是例外——要不要回 400 是處理函式的決定。urlencoded 表單不受影響，
照舊由 `@RequestParam` 綁定（見 `tests/programs/t161_multipart.teyru`）。

### 壓縮的回應

回應要壓縮是**處理函式說了算**：把 `HttpResponse.gzipBody` 設成 `true`，連線迴圈在
送出前讀 `Accept-Encoding`，只有下面每一項都成立才真的壓：

- 請求的 `Accept-Encoding` 收 gzip（`gzip`、`*`；`gzip;q=0` 是拒絕，不是接受）；
- 主體至少 1024 位元組——gzip 自己的標頭與結尾就 18 位元組，已經是一個封包的主體不會
  因為多一個標頭而更好；
- 壓完**真的比較短**。

壓縮的來源是 `lib/44_zip.teyru`（見 [docs/language.md](/docs/language) §11），
`Content-Encoding: gzip` 只在真的壓了才寫；只要處理函式要過壓縮，回應就會帶
`Vary: Accept-Encoding`，**無論這一個請求最後有沒有壓**——快取不能把壓過的答案交給
一個沒說自己能解壓的客戶端。`Content-Length` 由伺服器在送出時依（壓完的）主體重算。

客戶端那一半是 opt-in：`HttpClientRequest.acceptGzip()` 才會送 `Accept-Encoding: gzip`，
而答案寫了 `Content-Encoding: gzip` 時客戶端會自己解開，標頭（含 `Content-Length`）
保持連線上原樣的數字。壓壞的 gzip 不會被吞掉：`ZipException`／`EOFException` 會從
`send` 傳出來（`tests/programs/t180_http_gzip.teyru`）。

### 測試

`MockServer` 不開 socket，直接問 `HttpServer.handle`：

```teyru
MockServer server = new MockServer(ctx)
server.get("/pets")                                  // 主體
server.request("POST", "/pets", body, "application/json")
server.handle(req)                                   // 自己組的請求，看標頭
```

理由與 Spring 的 MockMvc 相同：測路由不該需要一個埠、一個客戶端或第二條執行緒。
`server.handle(req)` 收的是**已經準備好**的請求，cookie 要自己 `readCookies()`。

### 伺服器跑在自己的執行緒上

接收迴圈也做成了 `Runnable`（`lib/18_web.teyru` 的 `ServerTask`），所以客戶端與伺服器
可以活在同一個程式裡：

```teyru
HttpServer server = new HttpServer(0, Application.routerFrom(ctx), ctx)
server.bind()                                  // 先綁，埠才是已知的
ServerTask task = new ServerTask(server)
Thread serving = new Thread(task, "server")
serving.start()
// …送請求…
task.stop()
serving.join()
```

`server.bind()` 要在執行緒啟動前做：埠（`server.getPort()`）是組 URL 要用的，而已經綁好
的 listener 也答得掉在執行緒走到 accept 之前抵達的連線。`stop()` 停止接收，結束還沒開始
讀請求的連線（不陪它等），給進行中的請求 2 秒完成，然後關掉剩下的，`isRunning()` 回答
它還在不在跑。`port` 傳 0
是請核心挑一個空埠，`tests/programs/t162_http_roundtrip.teyru` 就是讓伺服器跑在一條
執行緒上、主執行緒當客戶端，在同一個程式裡往返。

## 已知限制

1. **連線數是有限的，滿了就回 503。** 同時回答的連線預設 64 條，等的預設 100 條，超過
   就由接收執行緒直接回 503 並關閉（上面的〈並發模型〉）。這是刻意的界線：沒有上限的
   thread-per-connection 會讓一個客戶端決定這個行程要用多少執行緒。要服務更多連線就
   調高那兩個數字，代價是記憶體與排程。
2. **沒有 HTTP/2，也沒有 HTTP/3。** 版本不是 1.0 或 1.1 一律 505；沒有 TLS 之上的
   ALPN 協商，所以 HTTPS 也只講 HTTP/1.1。
3. **幾乎沒有內容協商。** 只看方法的宣告型別，不看 `Accept`；唯一的例外是
   `Accept-Encoding` 與 gzip——而且那要處理函式先把 `gzipBody` 打開。brotli、deflate
   等其他人編碼沒有。
4. **會話活在行程裡。** 兩個行程後面接同一個服務時，請求要回到產生會話的那一個；
   會話 id 是 `java.util.Random` 的 128 位元，對單一伺服器夠用，不是密碼學來源。
5. **沒有 SSE。** multipart 上傳與驗證註解都有了，見上面兩節；伺服器推送沒有。
6. **沒有 `@Conditional`、`@Import`、`@Lazy`、AOP、交易**，也沒有
   `@ComponentScan` 的範圍控制：整個程式都是掃描範圍，因為編譯器看得見全部——要
   排除什麼，就不要標註它。
7. **`SpringApplication.run` 不讀 `server.ssl.certificate`。** 讀那兩個屬性的是
   `Application.serve`，它自己建伺服器；`SpringApplication.run` 也自己建一個，但沒有
   那個分支。要用這個入口跑 HTTPS，得自己建 `HttpServer` 並呼叫 `ssl(cert, key)`
   再自己服務，或改用 `Application.serve`。
