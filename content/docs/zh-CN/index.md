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
| 可执行文件大小（`-O2`，`wc -c`，见下） | **66,688 B**（约 65.1 KB） | — | — |
| 峰值内存（hello） | **4232 kB** | 51124 kB | **约 12.1 倍省** |
| `bench_fib` 递归 | **0.0062 s** | 0.0266 s | **约 4.3 倍快** |
| `bench_loop` 循环与整数运算 | **0.0243 s** | 0.0435 s | **约 1.8 倍快** |
| `bench_oop` 对象与虚调用 | **0.0051 s** | 0.0260 s | **约 5.1 倍快** |
| `bench_string` 字符串处理 | **0.0153 s** | 0.0632 s | **约 4.1 倍快** |
| `bench_alloc` 短命对象分配 | **0.0278 s** | 0.0304 s | **约 1.09 倍快** |
| `bench_invoke` 2000 万次反射调用（见 `examples/bench_invoke.teyru`） | **0.6019 s** | 0.2543 s | **约 2.4 倍慢** |

`bench_invoke` 这一行现在与其它每一行一样，由同一支脚本测量。它先前不是：Java 文件的类名与文件名不符，harness 因此安静地跳过那支程序、在 Java 栏印出 `-`。那是脚本真正的缺陷，已经修好（commit `1ad9b8c`），而且 Java 文件产不出可执行的类时，harness 现在印 `!no-class` 而不是 `-`。这一行显示 `Method.invoke` 这条路径仍比 HotSpot 慢约 2.4 倍。

`bench_loop` 从上一个版本的约 2.2 倍落到约 1.8 倍，原因是每个循环回边现在都带一次安全点检查——那是停止世界（stop-the-world）回收器刻意的代价，GC 是**合作式**的，说明见 [docs/language.md](/zh-CN/docs/language) §11。这不是测量误差。

**大小那一行是成绩，而且原因是具体的。** 它是〈快速开始〉那支 hello world
（`System.out.println("Hello, Teyru!")`）在 `-O2` 下以 `wc -c` 量的，今天 **66,688
字节**（约 65.1 KB）。这个数字主要是编译器**剪掉没有调用点在用的 vtable 槽位**换来的
——机制写在 [docs/architecture.md](/zh-CN/docs/architecture) 的〈为什么每个可执行文件都
带着前缀〉：`74fa648`（9/13）是 48,840 字节，剪枝前 501,072，第一版剪枝（只问「有没有
调用点」）95,832，第二版（再问「这个类有没有可能是那个调度的接收者」）落地时是 55,920。
剪枝前的 501,072 里有 1,262 个函数存活，其中 951 个是前缀的方法，真正被调用到的只有
42 个——其余都是靠 vtable 里的地址活着的。

**55,920 之后又长回来了，而两次成长都量得出来**（同一台机器、`-O2`、同一支 hello）：
**装箱缓存**（`#109`，让 `Integer.valueOf(127) == Integer.valueOf(127)` 与 Java 一致）
加 6,016 字节到 64,432，**堆栈溢出的函数序言检查**（`#104`，每个生成的函数开头一次
`ty_stack_check()`）再加 2,256 到**今天的 66,688**。剪枝省下的是不反射的程序的大小，这两
项买到的是语义与可拦截的错误，两边都不是免费的。

**这个数字要连着优化等级读。** 同一个 hello world 今天是 `-O1` 85,320、`-O2` 66,688、
`-O3` 70,128 字节；这一行与 `scripts/bench.sh` 用的都是 `-O2`，也是默认值。

前后对照（同一台机器、`-O2`、`wc -c`）：hello world 剪枝前 501,072 → 第一版 95,832 →
第二版 55,920 → 今天 66,688；`t84_sealed_switch` 今天 89,712（剪枝前 521,456、第一版
113,904）、`t133_arrow_blocks` 今天 71,704（509,536、105,688）、`t51_java25_tour` 今天
283,648（523,696、438,560），而且这些程序的输出逐字节不变。**会反射的程序不受剪枝
影响**：`t146_reflect` 今天 5,287,376 字节、`t101_gson` 5,251,024，剪枝对它们没有帮助，
因为反射会从 `main` 抓住每一张成员表——所以用反射的程序仍然要为整份成员表付出代价
（今天约 5.25 MB 而不是 3 MB），剪枝省下的是不反射的程序的大小。速度没有可测到的变化：六支
benchmark 交错跑二十轮，每个差异都在噪音内、checksum 全部相同。

**底线在哪里，以及为什么不能再低。** 剪枝后 hello world 生成的 C 里有 628 个 vtable
数组，每一个都还留着槽位 0、1、2，而只有**一个**数组在索引 3 以上有填东西——`Class`
自己的，为了 7、12、13、16 那四个索引，因为它是那个调度 owner 底下唯一可能的接收者。
槽位 0、1、2 对每个类都留着，而且**不能**用同一条规则收紧：运行期是拿着
`void *`／`tyobj *` 按索引读它们的（`print_uncaught` 与字符串辅助函数读 `[0]`、
`ty_obj_hash` 读 `[1]`、`ty_obj_equal` 读 `[2]`），所以它们的 owner 是继承树的根；
要再窄下去就得知道「某个类永远不会被实例化」，而生成的 C 不决定这件事——而且在那里
答错是跳到 `NULL`，不是浪费几个字节。



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

大小那一行量的是 hello world，而它的数字就是剪枝进了编译器之后才会变的那个：脚本量到的
是编译器在它当时那棵树上生成什么。

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
`import java.util.*` 和 `import java.util.List` 也照样接受——相容的是**导入**这一层。
「Java 源码不改就能编译」**不是**本文的宣称：Java 源码与这里的差别列在〈语言参考〉
§12（语法层，第一条就是分号）与 §13（缺的 API 与被误拒的写法），那两节就是那句话的
适用范围，而它们现在不是空的。等那些条目都不存在、而且有 `tests/` 的程序在验，那句话
才有人有资格说：

| 包 | 内容 |
|---|---|
| `java.lang` | `Object`、`Class`、`String`（`format`／`join`／`valueOf` 等）、`StringBuilder`、`Math`、`System`、`PrintStream`、八个包装类和 `Number`、`Throwable` 家族、`Enum`、`Record` |
| `java.util` | `List`／`ArrayList`／`LinkedList`、`Set`／`HashSet`／`LinkedHashSet`／`TreeSet`、`Map`／`HashMap`／`LinkedHashMap`／`TreeMap`、`Deque`／`ArrayDeque`、`Arrays`、`Collections`、`Objects`、`Optional`、`StringJoiner`、`Properties`、`Random`、`UUID`、`BitSet`、`StringTokenizer` |
| `java.time` | `LocalDate`／`LocalTime`／`LocalDateTime`／`Instant`／`Duration`／`Period`；时区是 `ZoneId`／`ZoneOffset`／`ZoneRules`／`ZonedDateTime`，读主机自己的 tzdata |
| `java.io` | `File`、`Path`／`Paths`、`Files` |
| `java.util.regex` | `Pattern`／`Matcher` |
| `java.net` | `ServerSocket`、`Socket` 及其输入输出流；TLS 是同一条路上的一层（`TlsSocket`／`Tls`／`TlsServer`／`TlsException`，用 OpenSSL，只有 POSIX 有） |
| `java.util.stream` | `Stream`／`IntStream`／`LongStream`／`DoubleStream`、`Collectors`、`Collector`、`Spliterator`；惰性求值，入口是 `Collection.stream()` |
| `java.math` | `BigInteger`、`BigDecimal`、`MathContext`、`RoundingMode` |
| `java.text` | `NumberFormat`／`DecimalFormat`（完整 pattern 语言）、`DateFormat`／`SimpleDateFormat`、`DateTimeFormatter`、`MessageFormat`；只做 ROOT／en-US，`format` 用 `Instant` |
| `java.io` 数据流 | `Reader`／`Writer`／`OutputStream`、`ByteArrayInputStream`／`ByteArrayOutputStream`、`DataInputStream`／`DataOutputStream`（`writeUTF`／`readUTF` 是 Java 的 modified UTF-8）、`BufferedReader`、`PrintWriter` |
| `java.util.HexFormat` | `of`／`ofDelimiter`、`with*`、`formatHex`／`parseHex`、`toHexDigits` 与位分类 |
| `java.util.Scanner` | 读一个 `String`：`hasNext`／`next` 与整数、长整数、浮点的形式，加上 `nextLine` |
| `java.security` | `MessageDigest`（MD5、SHA-1／224／256／384／512，以 Teyru 实现），加上 `java.util.zip` 形状的 `Checksum` 与 `CRC32` |
| `java.util.zip` | `Deflater`／`Inflater`（level 0–9、zlib 包装或 raw）、`Adler32`、`GZIPOutputStream`／`GZIPInputStream`；RFC 1951 的 deflate 以 Teyru 编写，web 层用它压缩响应 |
| `java.util.zip` 归档 | `ZipEntry`／`ZipOutputStream`／`ZipInputStream`／`ZipFile`；这里写出来的归档，JDK 与 Info-ZIP 的 `unzip` 都读得开 |
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

标准库没有清单式的一条「少了什么」：每个缺口都写在它自己所属于的包那一行或那一节
（见 [docs/language.md](/zh-CN/docs/language) §11），而且每条都是决定——`MessageDigest`
没有 SHA-3、`Scanner` 只读 `String`、闰秒被拒绝、没有 tzdata 的主机上时区是具名拒绝。

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
- **GitHub 的语言统计**由 `.gitattributes` 决定：`*.teyru` 声明成
  `linguist-language=Teyru`，而 `*.java.ref`（那是规格——`.expected` 是由 javac 的输出
  产生的）与 `*.expected`（测试数据）标成不计入。校正之前，「Java」曾经是这个仓库里
  最大的语言，而它几乎不存在。**要说清楚的是 `linguist-language` 这一行不会让 Teyru
  出现**：Linguist 只统计它认得的语言，所以统计里仍然没有 Teyru 这一项，要等语言本身
  与 `teyru-lang/editors` 那份文法被上游收下。

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
| `internal/runtime/src` | C 运行时：GC、字符串、数组、异常、boxing、线程与监视器、socket；操作系统那一层在 `tyrt_plat.h`，实现分成 POSIX 与 Windows 两半。TLS 在 `tyrt_tls.c`——唯一会链接 OpenSSL 的文件，只有程序的可达代码碰得到它时才编译与链接 |
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
- **堆栈溢出**：每个生成的函数开头拿自己的框架地址跟线程的 `ty_stack_limit` 比一次
  （堆栈底端加 **256 KB** 余量），低于就抛出该线程**预先分配**的 `StackOverflowError`
  ——所以抛出的路径不再分配、不再深递归。它与 Java 一样可以被拦截（`catch (Error)`
  与 `catch (VirtualMachineError)` 都接得到，消息是 `null`），线程与进程继续跑；
  未拦截时打印 `Exception in thread "main" teyru.StackOverflowError` 并以状态 1 结束。
  原生代码真的把堆栈写坏时，`sigaltstack` 上的 SIGSEGV 处理器打印
  `stack overflow in native code` 后 `abort()`——**不从信号处理器 longjmp**。测试是
  `t214`（捕获、父类、`Error`、另一条线程）、`t215`、`t216`；web 处理函数里的深递归
  是 `t241`。
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
只有 `tyrt.c`／`tyrt2.c`／`tyrt_thread.c`／`tyrt_net.c`／`tyrt_tls.c` 会调用它们。
（TLS 是这一层唯一的例外：它写在 OpenSSL 上，只有程序的可达代码碰得到它时才会被
编译与链接，所以没有 OpenSSL 的目标对它是具名拒绝——见 [docs/native.md](/zh-CN/docs/native)。）

`teyru build --target <os>/<arch>` 选的是编译器、旗标、要编哪一半的平台层与输出文件名；
没有给就编给这台机器。目标表有五列，而**「编得出来」与「跑得起来」是两个问题**、证据
也不一样，所以分成两栏——把其中一个写进另一格，就是把没量到的讲成量到的：

| 目标 | 构建 | 运行 |
|---|---|---|
| `linux/amd64` | ✅ | ✅ 在这台机器上原生跑完整套件：`go test ./...` 与 `TEYRU=<compiler> sh tests/run.sh`（250 项） |
| `windows/amd64` | ✅ 用 `x86_64-w64-mingw32-gcc` 交叉编译；**碰得到 TLS 的程序除外**（见下） | ✅ 在 Wine 下跑：当时 195 支测试程序有 179 支逐字节相同（16 支不符里 14 支在改动前的编译器上用 gcc 编 Linux 也一样失败，2 支是 Windows 的路径与文件名事实） |
| `linux/arm64` | ✅ 用 `aarch64-linux-gnu-gcc` 交叉编译；那个目标的 sysroot 是另外装上去的（见下） | ✅ 在 qemu-aarch64 下跑完整套件：**250 项全过**——222 支测试程序全部构建、运行、逐字节相同，3 个套件、23 个拒绝案例与 2 个 native 案例也全过 |
| `darwin/amd64`、`darwin/arm64` | ⚠️ **只到「编译并链接」**，而且不是通过 `teyru build`：从这个宿主，编译器对 Apple 那两列是具名拒绝（`teyru: no C compiler for darwin/amd64 on a linux/amd64 host`）。绕过那个检查、把编译器产生的 C 交给 `zig cc -target <arch>-macos`，**不碰 TLS 的 188 支全部编译并链接成功**（产物是 Mach-O 可执行文件），碰得到 TLS 的 34 支不行（见下） | ❌ 这里没有 macOS，所以没有任何人跑过它们 |

证据是分开量的，因为「编得出来」与「跑得起来」不同，而这次新增的量测是 `linux/arm64` 与
macOS 这两列。

**`linux/arm64` 是这样量的。** 这台机器原本有 `aarch64-linux-gnu-gcc`，但它的 sysroot 是
空的——不是头文件不对，是根本没有头文件（`fatal error: stdint.h`）。先把那个 sysroot 装
起来：libc 与其头文件、`linux-libc-dev`、`libatomic`，以及 arm64 的 TLS 需要的 OpenSSL
3.6.4（与 libcrypto 运行期要的 zlib、zstd）都取自 Debian sid 的 arm64 套件，解进这支交叉
编译器默认的 sysroot `/usr/aarch64-linux-gnu/sys-root`。有两件事要为 Fedora 这支编译器另
外处理：Debian 那两个链接脚本（`libc.so`、`libm.so`）里写死的是 Debian 的绝对路径，要改
写成 sysroot 内的路径；Fedora 的 gcc specs 无条件加上 `-latomic_asneeded`（一个 Fedora 的
封装手法，让 libatomic 只在真的用到时才连进去），而这支交叉编译器不带 libatomic，所以要
把它指向 Debian 的 `libatomic.so.1`。

跑的是**没有改过的 `tests/run.sh`**：只有三件事由外面给。编译器是一个多加了
`--target linux/arm64` 的包装——`run.sh` 没有地方可以指名目标，它只喊
`teyru build -O1 -o <输出> <来源>`，所以目标由编译器那个名字带着走。`CC` 是
`aarch64-linux-gnu-gcc`，套件自己那支 C 测试（`native/net_c_test.c`）因此也编成 arm64。
`QEMU_LD_PREFIX` 指向那个 sysroot：Fedora 的 `qemu-user-static` 已经注册了 binfmt_misc
handler，arm64 的可执行文件直接执行就会被 qemu 接手，但那支 qemu 没有编进默认 sysroot，
动态链接的程序要靠这个环境变量才找得到 loader。结果是 **250 项全过、0 项不符**：222 支测试
程序每一支都构建、运行、逐字节相同，另外 3 个套件、23 个拒绝案例与 2 个 native 案例也全过
（native 那支 C 测试是编成 arm64 在 qemu 下跑的）。

**macOS 那两列只到「编译并链接」，而且要说清楚是怎么到的。** 从这个 linux/amd64 宿主，
`teyru build --target darwin/arm64` 对**每一支**程序都是具名拒绝
（`teyru: no C compiler for darwin/amd64 on a linux/amd64 host`）：目标表上 Apple 那两列
没有 C 编译器，而 `--cc` 补不上——`resolveTarget` 先读表、再让调用方换编译器，所以一个
hello world 都不会开始。绕过那个检查之后，编译器产生的 C 与目标无关（`codegen.Emit` 只吃
程序，不吃目标），而 macOS 与 Linux 共用同一份 `tyrt_plat_posix.c`，所以那份 C 就是 darwin
构建会编的 C。把 `teyru emit` 印出来的 C 连同运行期六个文件交给
`zig cc -target aarch64-macos` 与 `zig cc -target x86_64-macos`：**不碰 TLS 的 188 支全部
编译并链接成功**，产物是 Mach-O 64-bit 可执行文件。碰得到 TLS 的那 34 支编不过，原因与
编译器的拒绝一致：`tyrt_tls.c` include 了 `openssl/err.h`，macOS 的 SDK 里没有这个头文件。
还有一件要讲明的：这批链接没有 `-flto`，因为 zig 对 `-flto` 直接回
`LTO requires using LLD`；编译器本来就会对没有 LTO 的工具链退回不带 `-flto` 的第二次尝试，
所以那是它自己的成功路径之一，但那不是默认那条。

**五个目标都实现了，而这台机器现在能演练四个。** `linux/amd64` 原生跑整套测试、
`windows/amd64` 在 Wine 下跑、`linux/arm64` 在 qemu-aarch64 下跑（250 项全过），
`darwin/amd64` 与 `darwin/arm64` 只到「编译并链接」。差别不在工具链而在机器：arm64 这一列
有东西可以执行它，macOS 那两列没有——没有任何 macOS 在旁边，所以那一格不能写成 ✅，也没有
任何人在它上面跑过一行程序。

**windows 与 macOS 没有 TLS，而被拒绝的是程序。** TLS 那一层写在 OpenSSL 上，
mingw-w64 没有它、macOS 出的是 SecureTransport，所以碰得到 TLS 的程序在那两个目标上是
**具名拒绝**（消息指名目标、原因与可以改用的目标），而不是留给链接器去说
`undefined reference to SSL_CTX_new`。要注意「碰得到」算的是**可达性**：会用反射的程序
带着一份指名每个类的表格，所以它自动碰得到 TLS——`t146_reflect`、`t101_gson` 与
`t102_web`（Spring 形状的那一层会扫描类）就是这样在 windows/amd64 上被拒绝的。不用
反射也不用 TLS 的程序完全不受影响，而且不用 TLS 的程序不会被链接 OpenSSL。
`linux/arm64` 不在这两个目标之列：那个 sysroot 里装了 arm64 的 OpenSSL，所以 TLS 在 arm64
上是被量过的——`t163_https_roundtrip`、`t191_tls_keepalive` 与
`t192_tls_handshake_timeout` 都在 qemu 下跑过且逐字节相同。

这张表**不是「每一列都跑过」的承诺**。今天缺的那一格只有 macOS：没有可命名的交叉编译器，
所以从别的宿主要求它是明确的错误——而且 `--cc` 也补不上，因为目标表上 Apple 那两列没有
编译器时，`resolveTarget` 在读 `--cc` 之前就拒绝了；把 `zig cc` 当成那两列的编译器是这页
上面那个手动流程，不是 `teyru build` 做得到的事。

**push 与 PR 上没有 CI**：每次改动的关卡就是上面那两条指令，在这台机器上由人跑，所以
文档里的数字都写着它是怎么量、在哪里量的。`.github/workflows/release.yml` 是这个仓库
**唯一**的工作流，只在发布 release 时跑：它构建那个 tag、对它跑整套测试、把可执行文件附到
release 上，跑的与人跑的是同一组（`make ci`、`make jdk-diff`、`make notices`、
`tests/run.sh`），push 与 PR 都不会触发它。arm64 因此不再停在「实现了、没有任何人跑过」
——它是被跑过的（数字与做法见上表）；macOS 那两列仍然没有，而且只要没有一台 macOS，它们
就会一直是这样。


---

## 开发

```sh
go build ./...          # 构建
go test ./...           # 端到端测试（会编译 tests/programs 下每个程序并比对输出）
go vet ./...
sh scripts/bench.sh       # 与 JVM 对照的性能测试（需要 java 才会跑 JVM 那一半）
```

新增测试只要在 `tests/programs/` 放 `xxx.teyru` 与 `xxx.expected`；
若程序需要命令行参数，再放 `xxx.args`（每行一个参数）；程序如果**应该**失败，
用 `xxx.exit` 写它必须结束时的状态码、`xxx.experr` 写它应该打印到 stderr 的内容。
`go test` 会自动处理。

测试仓库还有三个文件决定「今天什么算通过」（见 `teyru-lang/tests` 的 `README.md`）：

- `known-failures.txt`：一行一个 `<案例> <工作项> <原因>`。列在这里的案例失败是**已知
  失败**（会报告，但不让这次跑失败）；而列在这里的案例**通过**会让整次跑失败——所以条目
  不会活得比它描述的 bug 更久。两个 driver（Teyru 仓库的 `go test` 与 `tests/run.sh`）
  读同一个文件，没有原因的条目不收。
- `jdk-diff-allow.txt`：`<案例> <种类> <工作项> <原因>`，记下与 JDK 对照后**决定接受**的
  差异（或 Java 写不出来的东西）。没有工作项（或明确写 `none`）的条目不收。
- `<part>/<案例>.skip`：这个案例不能在哪些平台上跑（`windows`、`darwin/arm64`，或
  `!linux` 表示只有那个平台能跑），`#` 之后写原因。

贡献前请读 [AGENTS.md](https://github.com/teyru-lang/Teyru/blob/main/AGENTS.md)。

---

## 许可

见 [LICENSE](https://github.com/teyru-lang/Teyru/blob/main/LICENSE) 与 [THIRD-PARTY-NOTICES.md](/zh-CN/docs/legal)。
