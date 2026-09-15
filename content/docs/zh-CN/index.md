---
title: "Teyru"
description: "Teyru 是一门独立实现的编程语言：编译器完全用 Go 编写，直接生成原生可执行文件——不依赖 JVM、不依赖 javac、不产生任何 bytecode。"
---

[繁體中文](/docs) · **简体中文** · [English](/en/docs)

**Teyru 是一门独立实现的编程语言：编译器完全用 Go 编写，直接生成原生可执行文件——不依赖 JVM、不依赖 javac、不产生任何 bytecode。**

Teyru 的语法对 Java 开发者非常熟悉（类、接口、泛型、lambda、异常、record、enum、annotation），
但去掉了分号、加入了原生 property，并且以**原生机器码**运行：编译器把整个程序降级为 C，
再交给 clang/LLVM（或 gcc）编译成可执行文件。运行时只有约 5000 行 C，其中包含自己的垃圾回收器
（conservative mark-and-sweep）、字符串、数组与异常实现，没有任何虚拟机。

```
Teyru 源码 (.teyru)
      │  用 Go 写的编译器：lexer → parser → 语义分析 → C 生成器
      ▼
  generated C  ──clang（Clang 前端 + LLVM 中后端）──▶  LLVM IR  ──▶  原生可执行文件
                                                          （无 JVM、无 bytecode）
```

后端是 **LLVM**：`./teyru emit-llvm` 可以直接打印 IR 模块，接 `opt`／`llc`／自定义 pass
都没有问题；只想看 C 也可以用 `./teyru emit`。

**文档**：[语言参考](/zh-CN/docs/language) · [原生互通](/zh-CN/docs/native) · [Lombok 兼容层](/zh-CN/docs/lombok) · [诊断码一览](/zh-CN/docs/diagnostics) · [编译器架构](/zh-CN/docs/architecture) · [工作规范](https://github.com/teyru-lang/Teyru/blob/main/AGENTS.md)

---

## 目录

- [为什么比 JVM 快](#为什么比-jvm-快)
- [快速开始](#快速开始)
- [语言速览](#语言速览)
- [支持的语言特性](#支持的语言特性)
- [标准库](#标准库)
- [编辑器与工具](#编辑器与工具)
- [项目结构](#项目结构)
- [运行时模型](#运行时模型)
- [与 Java 的差异](#与-java-的差异)
- [命令行接口](#命令行接口)
- [开发](#开发)
- [许可](#许可)

---

## 为什么比 JVM 快

同一台机器实测（AMD Ryzen 7 5700X、Linux x86-64、clang 22.1.8、OpenJDK 21.0.11 Temurin；
由 `RUNS=5 sh scripts/bench.sh` 产生，每行取 5 次最佳。数字是**墙钟（wall-clock）的整支
程序时间，包含 process 启动**）：

| 指标 | Teyru（原生） | Java（HotSpot） | 差距 |
|---|---|---|---|
| 启动 100 次总时间 | **0.0769 s**（0.77 ms/次） | 1.9982 s（20.0 ms/次） | **约 26 倍快** |
| 可执行文件大小 | **489 KB**（目前是未解决的问题，见下面注记） | — | — |
| 峰值内存（hello） | **4232 kB** | 51124 kB | **约 12.1 倍省** |
| `bench_fib` 递归 | **0.0062 s** | 0.0266 s | **约 4.3 倍快** |
| `bench_loop` 循环与整数运算 | **0.0243 s** | 0.0435 s | **约 1.8 倍快** |
| `bench_oop` 对象与虚调用 | **0.0051 s** | 0.0260 s | **约 5.1 倍快** |
| `bench_string` 字符串处理 | **0.0153 s** | 0.0632 s | **约 4.1 倍快** |
| `bench_alloc` 短命对象分配 | **0.0278 s** | 0.0304 s | **约 1.09 倍快** |
| `bench_invoke` 2000 万次反射调用（见 `examples/bench_invoke.teyru`） | **0.6019 s** | 0.2543 s | **约 2.4 倍慢** |

`bench_invoke` 这一行现在与其它每一行一样，由同一支脚本测量。它先前不是：Java 文件的类名与文件名不符，harness 因此安静地跳过那支程序、在 Java 栏印出 `-`。那是脚本真正的缺陷，已经修好（commit `1ad9b8c`），而且 Java 文件产不出可执行的类时，harness 现在印 `!no-class` 而不是 `-`。这一行显示 `Method.invoke` 这条路径仍比 HotSpot 慢约 2.4 倍。

`bench_loop` 从上一个版本的约 2.2 倍落到约 1.8 倍，原因是每个循环回边现在都带一次安全点检查——那是停止世界（stop-the-world）回收器刻意的代价，GC 是**合作式**的，说明见 [docs/language.md](/zh-CN/docs/language) §11。这不是测量误差。

**大小那一行现在不是成绩，是一个未解决的问题。** 它是同一个 hello world 在 `-O2` 下
以 `wc -c` 量的，今天是 501,072 字节（约 489 KB）；同一个程序在 `74fa648`（9/13）
是 **48,840 字节**。退步已二分到 `52913a0`“feat(lib): java.util.function”
（74,384 → 105,328 字节），之后每加一个库就再往上跳一阶，`.text` 从 12,693
涨到 320,664。已经知道的事：生成的 C 还是 67,285 行，反射的成员表也没有写进这支
程序，所以变的是链接期优化不再把前缀整个丢掉。编译器仓库的 `AGENTS.md` §10 记着
这件事的完整测量，**处理中**——修好之后这一行会换回新的数字。

**为什么快：**

1. **没有 JVM 启动成本。** 没有 class loading、没有 JIT 预热、没有 GC 线程启动。
   适合 CLI 工具、短命进程、容器启动、serverless。
2. **编译期能做完的事不留到运行期。** 泛型擦除、调用定址、字符串常量静态分配、
   `static final` 常量折叠、vtable 与接口表都由编译器填好。
3. **没有字节码解释阶段。** clang/LLVM 直接优化整个程序（LTO 跨模块内联、
   常量传播、循环向量化），不需要等 JIT 观察热点。
4. **不需要分配的对象就不分配。** 逃逸分析把“不离开所在方法”的对象放在 C 栈上，
   LLVM 随后把它的字段提升为寄存器、把整个对象消除——与 JVM 的 scalar replacement
   效果相同，`bench_alloc` 正是靠这一点赢过 HotSpot。
5. **分配与边界检查都走行内快速路径。** `ty_alloc` 的指针碰撞分配在头文件内联，
   数组访问只在必要时调用慢路径；GC 会回收完全空掉的 chunk，类初始化也只测一个旗标。
6. **可预测的性能。** 没有 deopt、没有预热曲线、没有 GC 调参。

**诚实的边界。** 逃逸分析只覆盖“不离开所在方法”的对象。会存进字段、数组、返回或
交给其他对象的对象仍然走堆与标记清除回收，而 HotSpot 有分代假设，所以在“对象长期
存活、反复回收”的负载上 JVM 仍可能胜出。上面的数字都包含 process 启动，绝对值都很
小；重现方式见 `sh scripts/bench.sh`，六支 benchmark 程序、启动 100 次、可执行文件大小
与峰值内存都由这支脚本测量（`RUNS=5` 取最佳，在上面那台机器上执行）。

大小那一行量的是 hello world，而它现在的大小就是上面那个未解决问题的主体：脚本量到的
是编译器在它当时那棵树上生成什么，所以那一行会跟着修好而变。

---

## 快速开始

需要 **Go 1.26+** 与 **clang**（或 gcc）。

```sh
# 构建编译器
go build -o teyru ./cmd/teyru

# 编译并运行
./teyru run hello.teyru

# 生成可执行文件
./teyru build -O2 -o hello hello.teyru
./hello

# 查看编译器生成的 C 代码
./teyru emit hello.teyru

# 查看交给 LLVM 的 IR（后端是 clang/LLVM，可交给 opt/llc）
./teyru emit-llvm hello.teyru

# 版本
./teyru version
```

`hello.teyru`：

```teyru
class Hello {
  public static void main(String[] args) {
    System.out.println("Hello, Teyru!")
  }
}
```

注意：**Teyru 不用分号**。每条语句以换行结束；`for` 头部用两个冒号分隔三段。

---

## 语言速览

```teyru
interface Shape {
  double area()
  default String describe() {
    return "area=" + area()
  }
}

class Rect implements Shape {
  public double w
  public double h
  public Rect(double w, double h) {
    this.w = w
    this.h = h
  }
  public double area() {
    return w * h
  }
}

class Circle implements Shape {
  private double r
  public double radius {      // 原生 property
    get {
      return field            // field = 底层存储
    }
    set {
      field = value < 0 ? 0 : value
    }
  }
  public Circle(double r) {
    radius = r
  }
  public double area() {
    return Math.PI * r * r
  }
}

record Point(int x, int y) {
}

enum Color {
  RED, GREEN, BLUE
}

interface Fn<R> {
  R apply(int v)
}

class Main {
  static int twice(int v) {
    return v * 2
  }

  public static void main(String[] args) {
    Shape s = new Rect(3, 4)
    System.out.println(s.describe())

    // for ( init : condition : update )
    for (int i = 0 : i < 3 : i++) {
      System.out.println(i)
    }

    int[] xs = {1, 2, 3}
    for (int x : xs) {
      System.out.print(x)
    }
    System.out.println()

    // lambda 与方法引用
    Fn<Integer> f = (v) -> v + 1
    Fn<Integer> g = Main::twice
    System.out.println(f.apply(41))
    System.out.println(g.apply(21))

    // switch 表达式与类型 pattern
    Color c = Color.GREEN
    String name = switch (c) {
      case RED -> "red"
      case GREEN -> "green"
      default -> "other"
    }
    System.out.println(name)
    System.out.println(describe(c))

    // 异常
    try {
      System.out.println(10 / 0)
    } catch (ArithmeticException e) {
      System.out.println("除以零")
    } finally {
      System.out.println("cleanup")
    }
  }

  static String describe(Object o) {
    return switch (o) {
      case String s -> "string of length " + s.length()
      case Integer i when i.intValue() > 10 -> "big int"
      case Integer i -> "small int"
      default -> "other"
    }
  }
}
```

### Java 25 语法对照

Teyru 以 Java SE 25 最终定案的语法为基准（不含预览功能），保留 Java 语义，
只去掉分号并加入原生 property。已实现并有测试的 Java 25 项目：

| JEP | 功能 | 状态 |
|---|---|---|
| 512 | 精简源文件、实例 `main`、隐式 `java.io.IO`（`println`／`print`／`readln`） | ✅ |
| 511 | `import module java.base`（解析后忽略，运行期没有模块系统） | ✅ 解析 |
| 513 | 弹性构造器本体（`super()` 之前可以写语句） | ✅ |
| 440 | Record 模式（含嵌套解构、`instanceof` 版本） | ✅ |
| 441 | switch 的模式匹配与 `when` 守卫 | ✅ |
| 507 | 原生类型 pattern（`case int i`、`o instanceof int i`，精确转换语义；Java 25 仍为预览功能） | ✅ |
| 456 | 未命名变量与模式 `_` | ✅ |
| 395 | record（含紧凑构造器） | ✅ |
| 394 | `instanceof` 类型模式 | ✅ |
| 409 | sealed 类（`sealed`／`permits`／`non-sealed`） | ✅ 解析 |
| 378 | 文本块 | ✅ |
| 361 | switch 表达式 | ✅ |
| 286 | `var` 局部变量推断 | ✅ |

### Lombok 兼容层

编译器内置 Lombok：注解在语义分析阶段展开成普通的 Teyru 成员，与手写代码走同一条
类型检查与代码生成路径，不需要 annotation processor。

```teyru
import lombok.*

@Data
@AllArgsConstructor
@Builder
class Person {
  private String name
  private int age
}

class Main {
  public static void main(String[] args) {
    Person p = Person.builder().name("ada").age(36).build()
    System.out.println(p.getName() + " " + p.getAge())
    System.out.println(p)
  }
}
```

完整清单与差异见 **[docs/lombok.md](/zh-CN/docs/lombok)**：`@Getter`／`@Setter`／`@ToString`／
`@EqualsAndHashCode`／`@Data`／`@Value`／`@Builder`／`@NonNull`／`@Cleanup`／
`@SneakyThrows`／`@Synchronized`／`@With`／`@Accessors`／`@FieldDefaults`／
`@UtilityClass`／`@StandardException`／`@Log` 系列／`@ExtensionMethod`／
`@FieldNameConstants`／`@Delegate`／`@Helper`／`@Tolerate`／`@Locked`／
`@NonFinal`／`@PackagePrivate` 全部支持，包含 `@Singular`（逐项累积、整批加入、
清除、`build()` 取得副本）、`@SuperBuilder`（覆盖整条继承链的字段）与
`@Builder.ObtainVia`。

### 支持的语言特性

| 类别 | 内容 |
|---|---|
| 类型 | 原生类型、类、接口、enum、record、annotation type、泛型（bound／wildcard／diamond／泛型方法）、多维数组 |
| 成员 | 字段、方法、构造器、可变参数、静态与实例初始化块、嵌套／内部／局部／匿名类、`sealed`／`permits` |
| 语句 | `if`、`while`、`do-while`、基本 `for`（冒号头部）、增强 `for`、`switch`（语句／表达式、箭头／冒号、多标签、enum、字符串、类型 pattern + `when` 守卫）、`try`／`catch`／`finally`、try-with-resources、多类型 catch、`throw`、`yield`、`assert`、`synchronized`、标签与 `break`／`continue` |
| 表达式 | 完整运算符与优先级、三元、cast、`instanceof`（含 pattern）、lambda、方法引用（静态／绑定／未绑定／构造器）、匿名类、对象初始化列表、字符串拼接、自动 boxing／unboxing |
| 原生扩展 | 无分号语法、`val`（推断类型的不可重绑定局部变量）、`var`、原生 property（`get`／`set`／`field`）、`for` 的双冒号头部、try-with-resources 以换行分隔 |

完整的语法与语义写在 **[docs/language.md](/zh-CN/docs/language)**。

---

## 标准库

标准库以 **Teyru 本身**编写（`lib/*.teyru`），每次编译都和使用者程序一起被编译与
检查。标准库是一个 Teyru 包（`teyru`），所以导入写成一行
`import teyru.*`（只用到单个类时也可以写 `import teyru.List`）；Java 写法的
`import java.util.*` 和 `import java.util.List` 也照样接受，Java 源码不改就能编译：

| 包 | 内容 |
|---|---|
| `java.lang` | `Object`、`Class`、`String`（`format`／`join`／`valueOf` 等）、`StringBuilder`、`Math`、`System`、`PrintStream`、八个包装类和 `Number`、`Throwable` 家族、`Enum`、`Record` |
| `java.util` | `List`／`ArrayList`／`LinkedList`、`Set`／`HashSet`／`LinkedHashSet`／`TreeSet`、`Map`／`HashMap`／`LinkedHashMap`／`TreeMap`、`Deque`／`ArrayDeque`、`Arrays`、`Collections`、`Objects`、`Optional`、`StringJoiner`、`Properties`、`Random`、`UUID`、`BitSet`、`StringTokenizer` |
| `java.time` | `LocalDate`／`LocalTime`／`LocalDateTime`／`Instant`／`Duration`／`Period` |
| `java.io` | `File`、`Path`／`Paths`、`Files` |
| `java.util.regex` | `Pattern`／`Matcher` |
| `java.net` | `ServerSocket`、`Socket` 及其输入输出流 |
| `java.util.stream` | `Stream`／`IntStream`／`LongStream`／`DoubleStream`、`Collectors`、`Collector`、`Spliterator`；惰性求值，入口是 `Collection.stream()` |
| `java.math` | `BigInteger`、`BigDecimal`、`MathContext`、`RoundingMode` |
| `java.text` | `NumberFormat`／`DecimalFormat`（完整 pattern 语言）、`DateFormat`／`SimpleDateFormat`、`DateTimeFormatter`、`MessageFormat`；只做 ROOT／en-US，`format` 用 `Instant` |
| `java.io` 数据流 | `Reader`／`Writer`／`OutputStream`、`ByteArrayInputStream`／`ByteArrayOutputStream`、`DataInputStream`／`DataOutputStream`（`writeUTF`／`readUTF` 是 Java 的 modified UTF-8）、`BufferedReader`、`PrintWriter` |
| `java.util.HexFormat` | `of`／`ofDelimiter`、`with*`、`formatHex`／`parseHex`、`toHexDigits` 与位分类 |
| `java.util.Scanner` | 读一个 `String`：`hasNext`／`next` 与整数、长整数、浮点的形式，加上 `nextLine` |
| `java.security` | `MessageDigest`（MD5、SHA-1／224／256／384／512，以 Teyru 实现），加上 `java.util.zip` 形状的 `Checksum` 与 `CRC32` |
| `java.util.zip` | `Deflater`／`Inflater`（level 0–9、zlib 包装或 raw）、`Adler32`、`GZIPOutputStream`／`GZIPInputStream`；RFC 1951 的 deflate 以 Teyru 编写，web 层用它压缩响应 |
| `java.util.concurrent` | 执行器（`Executors`／`Future`／`ThreadPool`）与同步器（`CountDownLatch`、`AtomicInteger`／`AtomicLong`、`ConcurrentHashMap`）；全部是监视器，不是 lock-free |
| `com.google.gson` | Gson 的树状 API，以及运行期读取类字段的对象绑定（[docs/json.md](/zh-CN/docs/json)） |
| 线程 | `Thread`／`Runnable`、真正的 `synchronized`（含方法修饰符）与 `Object.wait`／`notify`／`notifyAll`（[docs/language.md](/zh-CN/docs/language) §11） |
| 框架 | Spring 形状的容器与 web 层：配置与 profile、`@ControllerAdvice`、拦截器、静态文件、CORS、`ResponseEntity`、`MockServer`、WebSocket、会话、multipart 上传、验证注解，以及可以放到线程上的接收循环（[docs/framework.md](/zh-CN/docs/framework)） |

集合以 Teyru 编写，所以 `for` 循环直接支持：

```teyru
List<String> names = new ArrayList<String>()
names.add("ada")
names.add("grace")
for (String n : names) {
  System.out.println(n)
}
```

依赖用 `teyru.mod` 声明，获取与校验照 Go 的做法（[docs/modules.md](/zh-CN/docs/modules)）：

```sh
teyru mod init example.com/app
teyru get example.com/greeting@v0.1.0
teyru build ./...
```

时区数据库仍然没有，理由记在 [docs/language.md](/zh-CN/docs/language) §11 与 §13。
线程、`java.util.concurrent` 的执行器与同步器、`Scanner` 都有了，见 §11 的〈线程与
同步〉与〈并发工具〉。

需要自己的原生库时，声明 `native` 方法并用 C 实现：

```teyru
class Native {
  public static native int add(int a, int b)
}
```
```sh
teyru build --native-header native.h program.teyru   # 生成要实现的原型
teyru build --native impl.c program.teyru            # 一起编译
```

完整说明见 [`docs/native.md`](/zh-CN/docs/native)。

---

## 编辑器与工具

- **VS Code**：[`teyru-lang/editors`](https://github.com/teyru-lang/editors) 仓库的 `vscode/` 提供 `.teyru` 的 TextMate 语法高亮、语言配置与片段。
  用 `npx @vscode/vsce package` 打包，再用 `code --install-extension teyru-0.1.0.vsix` 安装。
- **tree-sitter**：同一仓库的 `tree-sitter-teyru/` 是完整文法，附高亮 query、缩进 query
  与 corpus 测试，Neovim、Helix、Zed 等可直接使用。
- GitHub 目前仍把 `.teyru` 显示为 Java：linguist 还没有 Teyru 的定义，
  `.gitattributes` 先映射到最接近的语法。

---

## 项目结构

| 路径 | 说明 |
|---|---|
| `cmd/teyru` | CLI 入口（`build`／`run`／`emit`／`emit-llvm`／`get`／`mod`／`version`） |
| `internal/driver` | 编译流程：串起前端与 C 后端、调用 C 编译器、处理 native 源文件与输出选项 |
| `internal/source` | 文件、位置换算、诊断容器 |
| `internal/lexer` | 词法分析；换行不产生 token，只在 token 上标记“前面有换行” |
| `internal/parser` | 递归下降解析器，用显著性与前缀完整性判断语句是否结束 |
| `internal/ast` | 语法树、符号（类／方法／字段／变量）、类型 |
| `internal/sema` | 名称解析、类型检查、泛型擦除与推断、重载解析、vtable／selector 分配、property 降级 |
| `internal/codegen` | 两个后端：C（默认；类→struct、虚调用→vtable、接口调用→itable、GC 根信息）与 LLVM（`--backend=llvm`；生成程序自己的 IR 模块） |
| `internal/util` | 前后端共用的工具：名称修饰、类型描述、C 内存布局 |
| `internal/runtime/src` | C 运行时：GC、字符串、数组、异常、boxing、线程与监视器、socket；操作系统那一层在 `tyrt_plat.h`，实现分成 POSIX 与 Windows 两半 |
| `lib` | 用 Teyru 编写的标准库 |
| `tests/programs` | 端到端测试程序与期望输出（`go test` 会逐一编译并比对） |
| `tests/native` | native 方法互通测试：Teyru 声明、C 实现与期望输出（`TestNative`） |
| `examples` | 示例程序与 JVM 对照的 benchmark（`bench_*.teyru` 与 `.java`） |
| `scripts` | 开发脚本：`bench.sh` 性能测量、`pre-commit` 钩子 |
| [`teyru-lang/docs`](https://github.com/teyru-lang/docs) | 语言参考、诊断码、架构（另一个仓库，即本文档站） |
| [`teyru-lang/editors`](https://github.com/teyru-lang/editors) | 编辑器支持：VS Code 扩展与 tree-sitter 文法（另一个仓库） |

---

## 运行时模型

- **对象**：C struct，第一栏是 `tyobj { tyclass* cls }`。每个类一张 `tyclass`，
  记录父类、接口、vtable、接口表、GC 需要追踪的引用字段偏移。
- **虚调用**：`obj->cls->vtable[slot]`；**接口调用**：`ty_itab(obj, selector)`。
  每个接口方法有全局唯一的 selector，每个类的接口表由编译期填好。
- **泛型**：编译期擦除，运行期没有泛型信息（与 Java 相同）。
- **异常**：以 `setjmp`／`longjmp` 实现的 handler 链；`finally` 以嵌套 handler
  保证在任何路径（含 catch 内再抛出）都执行。
- **GC**：保守式标记清除。根包含原生栈（保守扫描）、静态字段注册表与寄存器
  （`setjmp` 溢出）。对象不移动，所以 C 端的临时指针永远有效。收集前会先停住每一条
  线程，再扫各自的栈（停止是世界性的，且是**合作式**的，见
  [docs/language.md](/zh-CN/docs/language) §11）。
- **字符串**：UTF-8 `tystr { tyobj obj; int64 len; char* data }`；字面量是静态对象，
  不经过 GC。
- **数组**：`tyarr { tyobj; len; data; esize; refs }`，元素内嵌在对象后方。

---

## 与 Java 的差异

Teyru 不是 Java 的子集，而是“Java 开发者一看就懂”的独立语言。主要差异：

1. **没有分号。** 分号会被编译器拒绝（`TY-SYN-0001`）。
2. **`for` 头部用冒号**：`for (int i = 0 : i < n : i++)`。
3. **try-with-resources 用换行分隔**，不用分号。
4. **enum 常量区与成员区用一个冒号**分隔（没有成员时可省略）。
5. **原生 property**：字段后面接 accessor 块即成 property；`field` 代表底层存储。
   没有 accessor 块的字段就是普通 Java 字段。
6. **`val`**：推断类型的不可重绑定局部变量（不是深度不可变）。
7. **没有 checked exception 检查**；`throws` 会被解析但不强制。
8. **没有 annotation processor**；注解可以反射，但元素是**按名字读**
   （`ann.stringValue("value")`），不是 Java 的 `ann.value()`。
9. **不是 bytecode 平台**：没有 `.class`、没有 `java.lang`、没有 JNI，
   目前也**无法**与既有 Java 库互通——这是刻意的取舍。

完整清单见 [docs/language.md §12](/zh-CN/docs/language)。

---

## 命令行接口

```
teyru build [flags] <files...>                 编译成原生可执行文件
teyru run   [flags] <files...> [-- args...]    编译后直接运行
teyru emit  [flags] <files...>                 打印生成的 C
teyru emit-llvm [flags] <files...>             打印交给 LLVM 的 IR
teyru get <module>@<version>                   获取模块到缓存并加入依赖
teyru mod init <module-path>                   为新模块写出 teyru.mod
teyru mod tidy                                 让 teyru.mod 与 teyru.sum 与源码一致
teyru version                                  版本
teyru help                                     帮助
```

| 旗标 | 说明 |
|---|---|
| `-o <path>` | 输出文件名（默认 `a.out`） |
| `-c <path>` | 保留生成的 C 文件到指定路径 |
| `--cc <name>` | 使用的 C 编译器（默认依次查找 `clang`、`gcc`、`cc`） |
| `-O0`…`-O3` | 优化等级（默认 `-O2`） |
| `--llvm-ir <path>` | 额外输出 LLVM IR 模块 |
| `--native <file.c>` | 加入 C 文件一起编译，实现 native 方法（可重复） |
| `--native-header <path>` | 生成 native 方法的声明（见 [docs/native.md](/zh-CN/docs/native)） |
| `--link <arg>` | 传给链接步骤的参数，例如 `--link -lm` |
| `--no-lto` | 关闭 LTO（工具链不支持时自动退回） |
| `--target <os>/<arch>` | 编译给哪个平台（默认是这台机器）；未知的目标会以名字被拒绝 |
| `--backend <c\|llvm>` | 用哪个后端编译程序（默认 `c`，见下面〈后端与平台〉） |
| `-v` | 显示实际执行的编译命令 |

---

## 后端与平台

**两个后端，默认是 C。** 默认的 C 后端为整个程序生成 C（见
[docs/architecture.md](/zh-CN/docs/architecture)）。`--backend=llvm` 换成后端直接生成
**这个程序自己的 LLVM IR**：运行期仍然是 C，clang 只负责汇编与链接。它拒绝它降不下去
的东西，不会安静地退回 C 后端——拒绝是一个 `TY-INT-0100` 诊断，指出是哪个构造。

那条界线是量出来的，不是猜的：`tests/programs` 扫过一轮的结果是
**76 支逐字节相同、0 支输出错误、119 支被 emitter 以诊断拒绝、0 个模块 clang 不收**。
被拒绝的那些按顺序是：闭包（lambda 与方法引用，以及局部类与匿名类）、
record／enum／注解合成出来的成员、类型 pattern 与带守卫的 switch、内部类，然后是
其余。它目前只编 linux/amd64，其他目标以 `TY-INT-0101` 拒绝。

**平台层。** 运行期对操作系统的调用都走 `internal/runtime/src/tyrt_plat.h`：
时间与 CPU、mutex 与 condition variable、线程、启动、socket、文件，共四十个
`typlat_*` 函数，实现分成 `tyrt_plat_posix.c` 与 `tyrt_plat_win.c` 两半，
只有 `tyrt.c`／`tyrt2.c`／`tyrt_thread.c`／`tyrt_net.c` 会调用它们。

`teyru build --target <os>/<arch>` 选的是编译器、旗标、要编哪一半的平台层与输出文件名；
没有给就编给这台机器。目标表有五列，每列的证据不一样：

| 目标 | 验证到什么程度 |
|---|---|
| `linux/amd64` | 完整套件：`go test ./...` 与 `sh tests/run.sh`（221 项）都在 CI 上跑 |
| `windows/amd64` | 原生 CI 跑 `go test ./...`；在作者的机器上以 Wine 跑测试程序，195 支里 179 支逐字节相同（16 支不符里 14 支在改动前的编译器上用 gcc 编 Linux 也一样失败，2 支是 Windows 的路径与文件名事实） |
| `linux/arm64` | CI 建得出来，并真的跑一支程序（`ubuntu-24.04-arm`）；没有跑整套 |
| `darwin/amd64`、`darwin/arm64` | CI 在 macOS runner 上跑 `go test ./...`；**作者的机器上没有验证过**（没有 macOS 可用） |

这张表**不是「每一列都跑过」的承诺**：`linux/amd64` 是整套测试的那一个，其他目标如果
需要这台机器没有的交叉工具链，会在编译器那里以编译器自己的错误失败，而不是安静地
成功。macOS 没有可命名的交叉编译器，所以从别的宿主要求它是明确的错误。

---

## 开发

```sh
go build ./...          # 构建
go test ./...           # 端到端测试（会编译 tests/programs 下每个程序并比对输出）
go vet ./...
sh scripts/bench.sh       # 与 JVM 对照的性能测试（需要 java 才会跑 JVM 那一半）
```

新增测试只需在 `tests/programs/` 放 `xxx.teyru` 与 `xxx.expected`；
若程序需要命令行参数，再放 `xxx.args`（每行一个参数）；程序如果**应该**失败，
用 `xxx.exit` 写它必须结束时的状态码、`xxx.experr` 写它应该输出到 stderr 的内容。
`go test` 会自动处理。

贡献前请读 [AGENTS.md](https://github.com/teyru-lang/Teyru/blob/main/AGENTS.md)。

---

## 许可

见 [LICENSE](https://github.com/teyru-lang/Teyru/blob/main/LICENSE) 与 [THIRD-PARTY-NOTICES.md](/zh-CN/docs/legal)。
