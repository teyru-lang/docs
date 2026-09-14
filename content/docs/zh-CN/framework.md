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
`void` 是空请求体；其他类（含 record 与 enum，enum 写成常量名称的字符串）以 Gson
绑定序列化成 `application/json`（见 `docs/json.md`）。基本类型没有映射，跟数组、
`List` 一样是 `TY-TYP-0111`。

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

## 已知限制

1. **一次处理一个连接。** 语言没有线程（`docs/language.md` §13），所以第二个连接
   要等第一个处理完。这对“会响应请求的程序”够用，对“服务一群人”不够；形状已经
   是 thread-per-connection 需要的形状。
2. **没有内容协商。** 只看方法的声明类型，不看 `Accept`。
3. **返回数组、`List` 或基本类型还没有 JSON 映射**（`TY-TYP-0111`），因为绑定尚未
   支持它们。
4. **只有 `Application.boot` 读取 `--key=value` 形式的命令行参数**并写入属性；没有
   `application.properties` 文件的读取。
5. **`@PreDestroy` 不执行**；没有 `@Conditional`、`@Profile`、`@Import`、
   `@Lazy`、AOP、事务、`@ExceptionHandler`。
6. **没有 `@ComponentScan` 的范围控制**：整个程序都是扫描范围，因为编译器看得见
   全部——要排除什么，就不要标注它。
