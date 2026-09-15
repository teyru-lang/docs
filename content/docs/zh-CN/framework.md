---
title: "框架：Spring 形状的容器与 web 层"
description: "依赖注入与请求绑定都在编译期完成，而不是像 Spring 那样在启动时用反射扫描。"
---

`lib/17_container.teyru`、`lib/18_web.teyru` 加上 `internal/sema/framework*.go` 构成
一个应用程序框架，接口照 Spring 抄，实现方式不同。

## 为什么不是反射

Spring 在启动时扫描 classpath、读注解、用反射创建与注入 bean、把请求绑定到方法。
这里的容器也读注解、也用反射创建与注入（`lib/28_container_reflect.teyru`）——
差别在 bean 清单：没有 classpath 可以扫，所以清单是编译器列出来的，其余每一件事
都是启动时从类本身读出来的。

两边的差别是具体的：

| | Spring | Teyru |
|---|---|---|
| bean 从哪来 | 运行时扫描 classpath | 编译器列出带 `@Component` 等标注的类（没有 classpath 可扫） |
| 读注解与注入 | 运行时反射 | 运行时反射，读的是类本身 |
| 缺少 bean | `NoSuchBeanDefinitionException`，启动时 | `IllegalStateException`，`refresh()` 时 |
| 循环依赖 | `BeanCurrentlyInCreationException`，启动时 | `IllegalStateException`，`refresh()` 时，消息里有环 |
| 运行时新增 bean | 可以 | 不行（清单来自编译器） |
| 启动成本 | 扫描与反射 | 反射，没有扫描 |

代价是明确的：不能在运行期扩展。好处也是：整类错误从“部署之后才看到”变成“编译
不过”。

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

### 支持的注解

| 注解 | 含义 |
|---|---|
| `@Component`／`@Service`／`@Repository`／`@Controller`／`@RestController` | 这个类是 bean；名称默认是首字母小写的类名，`@Component("x")` 可改 |
| `@Configuration` + `@Bean` | 这个类本身也是 bean，它的 `@Bean` 方法各产生一个 bean |
| `@Autowired` | 字段、构造器参数或 `@Bean` 方法参数由容器提供 |
| `@Qualifier("name")` | 同类型有多个时指名 |
| `@Primary` | 同类型有多个时的默认选择 |
| `@Value("${key}")`／`@Value("${key:default}")` | 注入属性 |
| `@PostConstruct` | 构建并注入完成后调用（无参、返回 void） |
| `@Scope("prototype")` | 每次查询都创建新的；默认 singleton |

### 构造器选择

Spring 4.3 起的规则：只有一个构造器就用它，否则找标了 `@Autowired` 的，否则用无参
的那个。被选上的构造器，每个参数都要自己标 `@Autowired`（或 `@Value`）才会被注入：
没标的参数不会被填充，生成的工厂就用少掉的实参调用它，编译以 `TY-TYP-0072` 失败。
标了多个 `@Autowired`，或都没有而有多个又没有无参构造器时，是 `TY-TYP-0105`。

### 生命周期

`refresh()` 会把每个 singleton 都创建起来，所以构造与注入的失败会在启动时（而不是
第一次请求时）报出来——缺 bean 更早就挡掉了，那是编译期的 `TY-TYP-0103`。bean 的
创建是递归的：要 A 就先创建它需要的 B。`creating` 标志位挡住环。

`@PostConstruct` 由生成的注入器在注入完成后调用。`@PreDestroy` 已声明但**没有**
执行——Teyru 没有进程关闭钩子，容器也没有 `close()`。

## Web 层

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

| 注解 | 含义 |
|---|---|
| `@RequestMapping`（类上） | 路径前缀 |
| `@RequestMapping`（方法上） | 路径与 `method`（不写是任何动词） |
| `@GetMapping`／`@PostMapping`／`@PutMapping`／`@DeleteMapping`／`@PatchMapping` | 路径与动词 |
| `@PathVariable` | 路径里 `{name}` 的值，会转换成参数的类型 |
| `@RequestParam` | 查询参数，`defaultValue` 可给默认值 |
| `@RequestHeader` | 请求头（名称不区分大小写）；`defaultValue` 是没有这个请求头时的值，不给就是空字符串 |
| `@RequestBody` | 请求体；参数是 `String` 就原样拿到，是类（或 record）就以 Gson 绑定解析 |
| `@ResponseBody` | 已声明；`@RestController` 本来就隐含，所以有没有都一样 |

**参数转换**：路径与查询参数都是字符串，所以 `int`、`long`、`double`、`float`、
`short`、`byte`、`boolean` 的参数会经由对应的 `parseX` 转换（`int` 用
`Integer.parseInt`）。

**请求体**：`@RequestBody` 的参数是 `String` 时拿到原样的请求体（想自己查看的
payload 就是这样接），是类或 record 时由**编译器为该类型生成的 Gson 绑定**解析
——Spring 依 `Content-Type` 挑选消息转换器，这里类型在编译期就知道了，转换器就是那
个绑定。解析失败抛出的是同一个 `JsonSyntaxException`。没有 JSON 映射的类型是编译
错误，不是第一次请求时的异常。

**响应**：返回 `HttpResponse` 就完全自己决定；返回 `String` 是 `text/plain`；返回
`void` 是空主体；其余一律由 Gson 绑定写成 `application/json`（见 `docs/json.md`）
——record、enum（写成常量名称的字符串）、数组、`List`、`Map` 都一样。原本“基本类型
没有映射”的 `TY-TYP-0111` 已经移除，绑定现在收得下所有类型。

**处理函数的参数**：类型是 `HttpRequest` 的参数就是这个请求本身（名字不拘），
Spring 把 `HttpServletRequest` 交给处理函数也是这样；其余没有标注的参数照旧当成
同名查询参数。

**路由**：`Router.match` 取最具体的匹配——字面片段胜过变量片段，所以
`/pets/mine` 不会被 `/pets/{id}` 吃掉，与注册顺序无关。路径存在但动词不对是 405，
路径不存在是 404。

### 服务器

```teyru
ApplicationContext ctx = Application.boot(args)
Router router = Application.routerFrom(ctx)
HttpServer server = new HttpServer(port, router, ctx)
```

`HttpServer.handle(HttpRequest)` 是请求进来后唯一的入口——它与 socket 循环分开，
所以不需要连接就能测试：`tests/programs/t102_web.teyru` 与
`tests/programs/t141_web_param_errors.teyru` 就是这样测试的，后者覆盖转换失败的 400、
enum 参数与返回值、`defaultValue`。

### 启动与配置

```teyru
class Main {
  public static void main(String[] args) {
    SpringApplication.run(Main.class, args)
  }
}
```

`SpringApplication.run` 等同于 `new ApplicationContext()` ＋
`SpringApplication.loadConfig(ctx, args)` ＋ `ctx.refresh()`，配置来源依次是：
工作目录的 `application.properties`（`--spring.config.name=路径` 可以换一份），
再叠上 `--key=value` 形式的命令行参数。读回来用 `ctx.getProperty("app.name")` 与
`ctx.getProperty("app.name", "默认")`，问有没有用 `ctx.hasProperty(...)`。

`@ConfigurationProperties(prefix = "app")` 标在 bean 上，`app.*` 就会绑进它的字段，
键名比对是宽松的：`app.max-size` 绑 `maxSize`、`app.max_size` 也绑。`@Profile("prod")`
的 bean 只在该 profile 生效（`--spring.profiles.active=prod`）。`@PreDestroy` 的方法
在 `ctx.close()` 时执行。

### 跨请求的关注点

| 东西 | 怎么声明 | 行为 |
|---|---|---|
| `@ControllerAdvice` ＋ `@ExceptionHandler(X.class)` | 类上的 advice、方法上的处理 | controller 抛出的 `X`（含子类）由这个方法回答；返回值就是响应，可以是 `HttpResponse`、`ResponseEntity` 或主体 |
| `HandlerInterceptor` | 实现接口的 bean | 每个请求都会 `preHandle`，回 `false` 就是 403（由 interceptor 决定内容）；`afterCompletion` 在响应送出前跑 |
| 静态文件 | `spring.web.static=目录` | 没有路由认领的路径就找该目录里的文件，Content-Type 依扩展名；路径含 `..` 一律 404 |
| CORS | `spring.web.cors=来源,来源` | 预检由服务器直接回答，不进 controller；标头盖在**最后真正送出的**响应上 |

反射调用会把异常包成 `InvocationTargetException`，但 advice 看到的是 controller
真正想抛的那个：这层包装在比对之前先拆掉。

### 会话

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

`Sessions.of(req)` 找出这个请求的 cookie 指到的会话，没有就建一个，并在**服务器要
送出的响应**上补 `Set-Cookie`（`TEYRUSSESSIONID`，带 `HttpOnly`）。这里是唯一能盖
cookie 的地方：路由的响应是处理函数返回后才产生的，这也是为什么处理函数拿到的是
请求而不是注入的响应。

`isNew()` 只在建立它的那个请求为 true，下一个请求起就是 false；`find(req)` 只找不建
（登录页读既有会话就是这个）；`invalidate()` 把 id 从 store 拿掉，客户端手上的旧
cookie 就指不到东西，下一个请求会拿到新的会话；`attributeNames()` 保持首次设定的
顺序；`Sessions.count()`／`clear()` 是给测试用的。

**超时。** `setMaxInactiveInterval(秒)` 给单个会话一个空闲上限，`Sessions.setTimeout(秒)`
给整个 store 一个默认；`0`（或负数）是**没有限制**，会话自己设了就以自己的为准，否则
用 store 的默认。配置文件写 Boot 的 `server.servlet.session.timeout`，值是 `30m`、`2h`、
`1d`、`45s` 这种长度或直接写秒数；`spring.web.session.timeout` 是同一件事的短写法，
Boot 的那个键优先。读不出来的值当成 `0`（没有限制）而不是猜一个数字。

超时的会话等于不存在：`find(req)` 把它从 store 拿掉并回应 `null`，客户端手上的 cookie
就指不到东西，下一个想要会话的请求会拿到新的（`tests/programs/t181_session_timeout.teyru`）。

**刻意没有后台清理线程。** 这个运行期在进程结束时会 join 每一条线程，一条无限循环
的清理线程会让程序结束不了；改成每个请求顺手检查几个会话（游标前进，一次八个），
所以成本摊在流量上而不是交给一条 reaper；`Sessions.prune()` 一次扫完整个 store，给
测试或空闲的时候用。要注意的是：**没有设 store 默认值时那个游标不做事**——只有自己设
了区间的会话，是靠 `find()` 或 `prune()` 才会被发现。

### 验证

`lib/36_validation.teyru` 是 Bean Validation 的那一小块：类在自己的字段上声明约束，
一个调用检查它们。

| 注解 | 意思 |
|---|---|
| `@NotNull` | 字段不能是 `null` |
| `@Size(min = …, max = …)` | `String` 字段的长度落在 `[min, max]` 内，两端都含 |
| `@Min(value = …)`／`@Max(value = …)` | 数值字段的下界／上界 |

四个都有 `String message() default …`，没写就用默认消息。`Validation.check(bean)` 读
对象自己声明的字段（走的是 JSON 绑定也在读的那套反射），碰到**第一个**违反约束的字段
就抛 `ValidationException`，消息是 `字段: 消息`——Spring 会一次报完所有违反，这里只报
第一个，要看其余的可以再问一次。

web 层对**绑定产生的每一个对象**都调用它，所以请求体违反自己类型的约束时，响应是
400，主体是 `bad request: 字段: 消息`：客户端做错的事，说得出是哪个字段。`@Min`／
`@Max` 标在非数值字段、`@Size` 标在非 `String` 字段时也是 violation，消息说明那个约束
读不了这个字段——那是类写错了，但不该让服务器崩溃。`tests/programs/t160_validation.teyru`
覆盖了这些。

**这四个名字是被占走的。** Teyru 的简单名称在同一个平坦命名空间里，所以 `NotNull`、
`Size`、`Min`、`Max` 已经是约束注解的名字，程序不能拿它们当自己类型的名字：自己声明
一个 `class Size` 之后，`@Size` 就指向那个类，约束不再被检查（安静地不检查）。

### 上传（multipart）

`HttpRequest.multipart(String name)` 回应 `multipart/form-data` 请求里以该字段名送出的
那个部分，类型是 `MultipartFile`：`name`、`originalFilename`、`contentType`、`content`
（请求体本来就是字符串，所以文件的内容是以送出的那些字符到达的），加上 `isEmpty()` 与
`size()`；没有这个字段时是 `null`。

不是 multipart、`Content-Type` 没有 boundary、或主体不是它声明的那个 multipart 时，
答案也是 `null`，不是异常——要不要回 400 是处理函数的决定。urlencoded 表单不受影响，
照旧由 `@RequestParam` 绑定（见 `tests/programs/t161_multipart.teyru`）。

### 压缩的响应

响应要不要压缩是**处理函数说了算**：把 `HttpResponse.gzipBody` 设成 `true`，连接循环在
送出前读 `Accept-Encoding`，只有下面每一项都成立才真的压：

- 请求的 `Accept-Encoding` 收 gzip（`gzip`、`*`；`gzip;q=0` 是拒绝，不是接受）；
- 主体至少 1024 字节——gzip 自己的头与尾就 18 字节，已经是一个包的主体不会因为多一个头
  而更好；
- 压完**真的比较短**。

压缩的来源是 `lib/44_zip.teyru`（见 [docs/language.md](/zh-CN/docs/language) §11），
`Content-Encoding: gzip` 只在真的压了才写；只要处理函数要过压缩，响应就会带
`Vary: Accept-Encoding`，**无论这一个请求最后有没有压**——缓存不能把压过的答案交给
一个没说自己能解压的客户端。`Content-Length` 由服务器在送出时依（压完的）主体重算。

客户端那一半是 opt-in：`HttpClientRequest.acceptGzip()` 才会送 `Accept-Encoding: gzip`，
而答案写了 `Content-Encoding: gzip` 时客户端会自己解开，头（含 `Content-Length`）
保持连线上原样的数字。压坏的 gzip 不会被吞掉：`ZipException`／`EOFException` 会从
`send` 传出来（`tests/programs/t180_http_gzip.teyru`）。

### 测试

`MockServer` 不开 socket，直接问 `HttpServer.handle`：

```teyru
MockServer server = new MockServer(ctx)
server.get("/pets")                                  // 主体
server.request("POST", "/pets", body, "application/json")
server.handle(req)                                   // 自己组的请求，看标头
```

理由与 Spring 的 MockMvc 相同：测路由不该需要一个端口、一个客户端或第二条线程。
`server.handle(req)` 收的是**已经准备好**的请求，cookie 要自己 `readCookies()`。

### 服务器跑在自己的线程上

接收循环也做成了 `Runnable`（`lib/18_web.teyru` 的 `ServerTask`），所以客户端与服务器
可以活在同一个程序里：

```teyru
HttpServer server = new HttpServer(0, Application.routerFrom(ctx), ctx)
server.bind()                                  // 先绑，端口才是已知的
ServerTask task = new ServerTask(server)
Thread serving = new Thread(task, "server")
serving.start()
// …发请求…
task.stop()
serving.join()
```

`server.bind()` 要在启动线程之前做：端口（`server.getPort()`）是拼 URL 要用的，而已经
绑好的 listener 也答得掉在线程走到 accept 之前到达的连接。`stop()` 要求循环在两个
连接之间停下来，不会打断正在回应的那个连接，`isRunning()` 回应它还在不在跑。端口传 0
是请内核挑一个空闲端口，`tests/programs/t162_http_roundtrip.teyru` 就是让服务器跑在一条
线程上、主线程当客户端，在同一个程序里往返。

## 已知限制

1. **一次处理一个连接。** 循环仍然一次只回应一个连接，但它现在可以跑在自己的线程上
   （上面的 `ServerTask`），所以“第二个连接等第一个”是循环的形状，不是程序的形状：
   客户端与服务器可以并存于同一个程序里。要同时服务多个连接，需要的是
   thread-per-connection，这一层还没有；形状已经是它需要的形状。
2. **几乎没有内容协商。** 只看方法的声明类型，不看 `Accept`；唯一的例外是
   `Accept-Encoding` 与 gzip——而且那要处理函数先把 `gzipBody` 打开。brotli、deflate
   等其他编码没有。
3. **会话活在进程里。** 两个进程后面接同一个服务时，请求要回到产生会话的那一个；
   会话 id 是 `java.util.Random` 的 128 位，对单一服务器够用，不是密码学来源。
4. **没有 SSE。** multipart 上传与验证注解都有了，见上面两节；服务器推送没有。
5. **没有 `@Conditional`、`@Import`、`@Lazy`、AOP、事务**，也没有
   `@ComponentScan` 的范围控制：整个程序都是扫描范围，因为编译器看得见全部——要
   排除什么，就不要标注它。
