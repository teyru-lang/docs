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
第一次請求時）報出來——缺 bean 更早就擋掉了，那是編譯期的 `TY-TYP-0103`。bean 的
建立是遞迴的：要 A 就先建它需要的 B。`creating` 旗標擋住環。

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
的 listener 也答得掉在執行緒走到 accept 之前抵達的連線。`stop()` 要求迴圈在兩個連線
之間停下來，不會打斷正在回答的那個連線，`isRunning()` 回答它還在不在跑。`port` 傳 0
是請核心挑一個空埠，`tests/programs/t162_http_roundtrip.teyru` 就是讓伺服器跑在一條
執行緒上、主執行緒當客戶端，在同一個程式裡往返。

## 已知限制

1. **一次處理一個連線。** 迴圈仍然一次只回答一個連線，但它現在可以跑在自己的執行緒上
   （上面的 `ServerTask`），所以「第二個連線等第一個」是迴圈的形狀，不是程式的形狀：
   客戶端與伺服器可以並存在同一個程式裡。要同時服務多個連線，需要的是
   thread-per-connection，這一層還沒有；形狀已經是它需要的形狀。
2. **沒有內容協商。** 只看方法的宣告型別，不看 `Accept`。
3. **會話活在行程裡。** 兩個行程後面接同一個服務時，請求要回到產生會話的那一個；
   會話 id 是 `java.util.Random` 的 128 位元，對單一伺服器夠用，不是密碼學來源。
4. **沒有 SSE。** multipart 上傳與驗證註解都有了，見上面兩節；伺服器推送沒有。
5. **沒有 `@Conditional`、`@Import`、`@Lazy`、AOP、交易**，也沒有
   `@ComponentScan` 的範圍控制：整個程式都是掃描範圍，因為編譯器看得見全部——要
   排除什麼，就不要標註它。
