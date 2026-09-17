---
title: "Teyru"
description: "編譯器完全用 Go 撰寫、直接產生原生執行檔的程式語言——不依賴 JVM、不依賴 javac、不產生任何 bytecode。"
---

**繁體中文** · [简体中文](/zh-CN/docs) · [English](/en/docs)

**Teyru 是一門獨立實作的程式語言：編譯器完全用 Go 撰寫，直接產生原生執行檔——不依賴 JVM、不依賴 javac、不產生任何 bytecode。**

Teyru 的語法對 Java 開發者高度熟悉（類別、介面、泛型、lambda、例外、record、enum、annotation），
但拿掉了分號、補上原生 property，並且用**原生機器碼**執行：編譯器把整個程式降成 C，
再交給 clang/LLVM（或 gcc）編成執行檔。執行期是 **8,524 行**的 C（`internal/runtime/src`
的八個 `.c`；連標頭一起算是 10,135 行，`wc -l`），裡頭有自己的垃圾回收器
（conservative mark-and-sweep）、字串、陣列與例外實作，沒有任何虛擬機。

```
Teyru 原始碼 (.teyru)
      │  Go 寫的編譯器：lexer → parser → 語意分析 → C 產生器
      ▼
  generated C  ──clang（Clang 前端 + LLVM 中後端）──▶  LLVM IR  ──▶  原生執行檔
                                                          （無 JVM、無 bytecode）
```

後端是 **LLVM**：`./teyru emit-llvm` 可以直接印出 IR 模組，要接 `opt`／`llc`／自訂 pass
都沒問題；只想看 C 也可以用 `./teyru emit`。

**文件**：[語言參考](/docs/language) · [原生互通](/docs/native) · [Lombok 相容層](/docs/lombok) · [診斷碼一覽](/docs/diagnostics) · [編譯器架構](/docs/architecture) · [工作規範](https://github.com/teyru-lang/Teyru/blob/main/AGENTS.md)

---

## 目錄

- [為什麼比 JVM 快](#為什麼比-jvm-快)
- [快速開始](#快速開始)
- [語言速覽](#語言速覽)
- [支援的語言特性](#支援的語言特性)
- [標準程式庫](#標準程式庫)
- [編輯器與工具](#編輯器與工具)
- [專案結構](#專案結構)
- [執行期模型](#執行期模型)
- [與 Java 的差異](#與-java-的差異)
- [命令列介面](#命令列介面)
- [開發](#開發)
- [授權](#授權)

---

## 為什麼比 JVM 快

同一台機器實測（AMD Ryzen 7 5700X、Linux x86-64、clang 22.1.8、OpenJDK 21.0.11 Temurin；
由 `RUNS=5 sh scripts/bench.sh` 產生，每列取 5 次最佳。數字是**牆鐘（wall-clock）的整支
程式時間，含 process 啟動**）：

| 指標 | Teyru（原生） | Java（HotSpot） | 差距 |
|---|---|---|---|
| 啟動 100 次總時間 | **0.0769 s**（0.77 ms/次） | 1.9982 s（20.0 ms/次） | **約 26 倍快** |
| 執行檔大小（`-O2`，`wc -c`，見下） | **66,688 B**（約 65.1 KB） | — | — |
| 尖峰記憶體（hello） | **4232 kB** | 51124 kB | **約 12.1 倍省** |
| `bench_fib` 遞迴 | **0.0062 s** | 0.0266 s | **約 4.3 倍快** |
| `bench_loop` 迴圈與整數運算 | **0.0243 s** | 0.0435 s | **約 1.8 倍快** |
| `bench_oop` 物件與虛擬呼叫 | **0.0051 s** | 0.0260 s | **約 5.1 倍快** |
| `bench_string` 字串處理 | **0.0153 s** | 0.0632 s | **約 4.1 倍快** |
| `bench_alloc` 短命物件配置 | **0.0278 s** | 0.0304 s | **約 1.09 倍快** |
| `bench_invoke` 2000 萬次反射呼叫（見 `examples/bench_invoke.teyru`） | **0.6019 s** | 0.2543 s | **約 2.4 倍慢** |

`bench_invoke` 這一列現在與其他每一列一樣，由同一支腳本量測。它先前不是：Java 檔案的類別名稱與檔名不符，harness 因此安靜地跳過那支程式、在 Java 欄印出 `-`。那是腳本真正的缺陷，已經修好（commit `1ad9b8c`），而且 Java 檔案產不出可執行的類別時，harness 現在印 `!no-class` 而不是 `-`。這一列顯示 `Method.invoke` 這條路徑仍比 HotSpot 慢約 2.4 倍。

`bench_loop` 由上一個版本的約 2.2 倍落到約 1.8 倍，原因是每個迴圈回邊現在都帶一次安全點檢查——那是停止世界（stop-the-world）收集器刻意的代價，GC 是**合作式**的，說明見 [docs/language.md](/docs/language) §11。這不是量測誤差。

**大小那一列是成績，而且原因是具體的。** 它是〈快速開始〉那支 hello world
（`System.out.println("Hello, Teyru!")`）在 `-O2` 下以 `wc -c` 量的，今天 **66,688
位元組**（約 65.1 KB）。這個數字主要是編譯器**剪掉沒有呼叫點在用的 vtable 槽位**換來的
——機制寫在 [docs/architecture.md](/docs/architecture) 的〈為什麼每個執行檔都帶著前綴〉：
`74fa648`（9/13）是 48,840 位元組，剪枝前 501,072，第一版剪枝（只問「有沒有呼叫點」）
95,832，第二版（再問「這個類別有沒有可能是那個調度的接收者」）落地時是 55,920。剪枝前的
501,072 裡有 1,262 個函式存活，其中 951 個是前綴的方法，真正被呼叫到的只有 42 個——其餘
都是靠 vtable 裡的位址活著的。

**55,920 之後又長回來了，而兩次成長都量得出來**（同一台機器、`-O2`、同一支 hello）：
**裝箱快取**（`#109`，讓 `Integer.valueOf(127) == Integer.valueOf(127)` 與 Java 一致）
加 6,016 位元組到 64,432，**堆疊溢位的函式序言檢查**（`#104`，每個產生的函式開頭一次
`ty_stack_check()`）再加 2,256 到**今天的 66,688**。剪枝省下的是不反射的程式的大小，這兩
項買到的是語意與可攔截的錯誤，兩邊都不是免費的。

**這個數字要連著最佳化等級讀。** 同一支 hello world 今天是 `-O1` 85,320、`-O2` 66,688、
`-O3` 70,128 位元組；這一列與 `scripts/bench.sh` 用的都是 `-O2`，也是預設值。

前後對照（同一台機器、`-O2`、`wc -c`）：hello world 剪枝前 501,072 → 第一版 95,832 →
第二版 55,920 → 今天 66,688；`t84_sealed_switch` 今天 89,712（剪枝前 521,456、第一版
113,904）、`t133_arrow_blocks` 今天 71,704（509,536、105,688）、`t51_java25_tour` 今天
283,648（523,696、438,560），而且這些程式的輸出逐位元組不變。**會反射的程式不受剪枝
影響**：`t146_reflect` 今天 5,287,376 位元組、`t101_gson` 5,251,024，剪枝對它們沒有幫助，
因為反射會從 `main` 抓住每一張成員表——所以用反射的程式仍然要為整份成員表付出代價
（今天約 5.25 MB 而不是 3 MB），剪枝省下的是不反射的程式的大小。速度沒有可測到的變化：六支
benchmark 交錯跑二十輪，每個差異都在噪音內、checksum 全部相同。

**底線在哪裡，以及為什麼不能再低。** 剪枝後 hello world 產生的 C 裡有 628 個 vtable
陣列，每一個都還留著槽位 0、1、2，而只有**一個**陣列在索引 3 以上有填東西——`Class`
自己的，為了 7、12、13、16 那四個索引，因為它是那個調度 owner 底下唯一可能的接收者。
槽位 0、1、2 對每個類別都留著，而且**不能**用同一條規則收緊：執行期是拿著
`void *`／`tyobj *` 按索引讀它們的（`print_uncaught` 與字串輔助函式讀 `[0]`、
`ty_obj_hash` 讀 `[1]`、`ty_obj_equal` 讀 `[2]`），所以它們的 owner 是繼承樹的根；
要再窄下去就得知道「某個類別永遠不會被實例化」，而產生的 C 不決定這件事——而且在那裡
答錯是跳到 `NULL`，不是浪費幾個位元組。



**為什麼會快：**

1. **沒有 JVM 啟動成本。** 沒有 class loading、沒有 JIT 暖機、沒有 GC 執行緒啟動。
   適合 CLI 工具、短命 process、容器啟動、serverless。
2. **編譯期就做完的事不留到執行期。** 泛型在編譯期抹除、方法呼叫在編譯期定址、
   字串常數靜態配置、`static final` 常數直接折疊、vtable 與介面表由編譯器填好。
3. **沒有 bytecode 解譯階段。** clang/LLVM 直接最佳化整份程式（LTO 跨模組 inline、
   常數傳播、迴圈向量化），不需要等 JIT 觀察熱點。
4. **不需要配置的物件就不配置。** 逃逸分析把「不離開所在方法」的物件放在 C 堆疊上，
   LLVM 接著把它的欄位提升成暫存器、把整個物件消除——與 JVM 的 scalar replacement
   同樣的效果，`bench_alloc` 就是靠這件事贏過 HotSpot 的。
5. **配置與邊界檢查都走行內快速路徑。** `ty_alloc` 的指標碰撞配置在標頭檔內聯，
   陣列存取只在必要時呼叫慢路徑；GC 會回收完全空掉的 chunk，類別初始化也只測一個旗標。
6. **可預測的效能。** 沒有 deopt、沒有暖機曲線、沒有 GC 調校參數，
   第一次執行就是最快速度。

**誠實的邊界。** 逃逸分析只涵蓋「不離開所在方法」的物件。會存進欄位、陣列、
回傳或交給其他物件的物件仍然走堆積與標記清除式回收，而 HotSpot 有分代假設，
所以在「物件長期存活、反覆回收」的負載上 JVM 仍可能勝出。上面的數字都含
process 啟動，絕對值都很小；重現方式見 `sh scripts/bench.sh`，六支 benchmark 程式、
啟動 100 次、執行檔大小與尖峰記憶體都由這支腳本量測（`RUNS=5` 取最佳，於上面那台
機器上執行）。

大小那一列量的是 hello world，而它的數字就是剪枝進了編譯器之後才會變的那一個：腳本量到
的是編譯器在當時那棵樹上產生什麼。

---

## 快速開始

需要 **Go 1.26+** 與 **clang**（或 gcc）。

```sh
# 建置編譯器
go build -o teyru ./cmd/teyru

# 編譯並執行
./teyru run hello.teyru

# 產生執行檔
./teyru build -O2 -o hello hello.teyru
./hello

# 看編譯器產生的 C 程式碼
./teyru emit hello.teyru

# 看交給 LLVM 的 IR（後端是 clang/LLVM，可用 opt/llc 直接接手）
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

注意：**Teyru 不用分號**。每個敘述以換行結束；`for` 標頭用兩個冒號分隔三段。

---

## 語言速覽

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
      return field            // field = 底層儲存
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

    // lambda 與方法參照
    Fn<Integer> f = (v) -> v + 1
    Fn<Integer> g = Main::twice
    System.out.println(f.apply(41))
    System.out.println(g.apply(21))

    // switch 運算式與型別 pattern
    Color c = Color.GREEN
    String name = switch (c) {
      case RED -> "red"
      case GREEN -> "green"
      default -> "other"
    }
    System.out.println(name)
    System.out.println(describe(c))

    // 例外
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

### Java 25 語法對照

Teyru 以 Java SE 25 的最終定案語法為基準（預覽功能不算），保留 Java 的語意，
只拿掉分號並加上原生 property。已實作並有測試的 Java 25 項目：

| JEP | 功能 | 狀態 |
|---|---|---|
| 512 | 精簡原始檔、實例 `main`、隱式 `java.io.IO`（`println`／`print`／`readln`） | ✅ |
| 511 | `import module java.base`（解析後忽略，執行期沒有模組系統） | ✅ 解析 |
| 513 | 彈性建構子本體（`super()` 之前可以有敘述） | ✅ |
| 440 | Record 模式（含巢狀解構、`instanceof` 版本） | ✅ |
| 441 | switch 的模式比對與 `when` 守衛 | ✅ |
| 507 | 原生型別 pattern（`case int i`、`o instanceof int i`，精確轉換語意；Java 25 仍為預覽功能） | ✅ |
| 456 | 未命名變數與模式 `_` | ✅ |
| 395 | record（含精簡建構子） | ✅ |
| 394 | `instanceof` 型別模式 | ✅ |
| 409 | sealed 類別（`sealed`／`permits`／`non-sealed`） | ✅ 解析 |
| 378 | 文字區塊 | ✅ |
| 361 | switch 運算式 | ✅ |
| 286 | `var` 區域變數推斷 | ✅ |

### Lombok 相容層

編譯器內建 Lombok：標註會在語意分析階段展開成一般的 Teyru 成員，與手寫程式碼走同一條
型別檢查與程式碼產生路徑，不需要 annotation processor。

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

完整清單與差異見 **[docs/lombok.md](/docs/lombok)**：`@Getter`／`@Setter`／`@ToString`／
`@EqualsAndHashCode`／`@Data`／`@Value`／`@Builder`／`@NonNull`／`@Cleanup`／
`@SneakyThrows`／`@Synchronized`／`@With`／`@Accessors`／`@FieldDefaults`／
`@UtilityClass`／`@StandardException`／`@Log` 家族／`@ExtensionMethod`／
`@FieldNameConstants`／`@Delegate`／`@Helper`／`@Tolerate`／`@Locked`／
`@NonFinal`／`@PackagePrivate` 全部支援，包含 `@Singular`（逐項累積、整批加入、
清除、`build()` 取得副本）、`@SuperBuilder`（涵蓋整條繼承鏈的欄位）與
`@Builder.ObtainVia`。

### 支援的語言特性

| 類別 | 內容 |
|---|---|
| 型別 | 原生型別、類別、介面、enum、record、annotation type、泛型（bound／wildcard／diamond／泛型方法）、多維陣列 |
| 成員 | 欄位、方法、建構子、可變參數、靜態與實例初始化區塊、巢狀／內部／區域／匿名類別、`sealed`／`permits` |
| 陳述式 | `if`、`while`、`do-while`、基本 `for`（冒號標頭）、增強 `for`、`switch`（陳述式／運算式、箭頭／冒號、多標籤、enum、字串、型別 pattern + `when` 守衛）、`try`／`catch`／`finally`、try-with-resources、多型別 catch、`throw`、`yield`、`assert`、`synchronized`、標籤與 `break`／`continue` |
| 運算式 | 完整運算子與優先序、三元、cast、`instanceof`（含 pattern）、lambda、方法參照（靜態／綁定／未綁定／建構子）、匿名類別、物件初始化列表、字串串接、自動 boxing／unboxing |
| 原生擴充 | 無分號語法、`val`（推斷型別的不可重綁區域變數）、`var`、原生 property（`get`／`set`／`field`）、`for` 的雙冒號標頭、try-with-resources 以換行分隔 |

完整的語法與語意寫在 **[docs/language.md](/docs/language)**。

---

## 標準程式庫

標準程式庫以 **Teyru 本身**撰寫（`lib/*.teyru`），每次編譯都與使用者程式
一起被編譯與檢查。標準程式庫是一個 Teyru 套件（`teyru`），所以匯入寫成一行
`import teyru.*`（只用到一個類別時也可以寫 `import teyru.List`）；Java 風格的
`import java.util.*` 與 `import java.util.List` 也照樣收——相容的是**匯入**這一層。
「Java 原始碼不改就能編」**不是**本文的宣稱：Java 原始碼與這裡的差別列在〈語言參考〉
§12（語法層，第一條就是分號）與 §13（缺的 API 與被誤拒的寫法），那兩節就是那句話的
適用範圍，而它們現在不是空的。等那些條目都不存在、而且有 `tests/` 的程式在驗，那句話
才有人有資格說：

| 套件 | 內容 |
|---|---|
| `java.lang` | `Object`、`Class`、`String`（`format`／`join`／`valueOf`…）、`StringBuilder`、`Math`、`System`、`PrintStream`、八個包裝類別與 `Number`、`Throwable` 家族、`Enum`、`Record` |
| `java.util` | `List`／`ArrayList`／`LinkedList`、`Set`／`HashSet`／`LinkedHashSet`／`TreeSet`、`Map`／`HashMap`／`LinkedHashMap`／`TreeMap`、`Deque`／`ArrayDeque`、`Arrays`、`Collections`、`Objects`、`Optional`、`StringJoiner`、`Properties`、`Random`、`UUID`、`BitSet`、`StringTokenizer` |
| `java.time` | `LocalDate`／`LocalTime`／`LocalDateTime`／`Instant`／`Duration`／`Period`；時區是 `ZoneId`／`ZoneOffset`／`ZoneRules`／`ZonedDateTime`，讀主機自己的 tzdata |
| `java.io` | `File`、`Path`／`Paths`、`Files` |
| `java.util.regex` | `Pattern`／`Matcher` |
| `java.net` | `ServerSocket`、`Socket` 與其輸入輸出串流；TLS 是同一條路上的一層（`TlsSocket`／`Tls`／`TlsServer`／`TlsException`，用 OpenSSL，POSIX 才有） |
| `java.util.stream` | `Stream`／`IntStream`／`LongStream`／`DoubleStream`、`Collectors`、`Collector`、`Spliterator`；延遲求值，`Collection.stream()` 是入口 |
| `java.math` | `BigInteger`、`BigDecimal`、`MathContext`、`RoundingMode` |
| `java.text` | `NumberFormat`／`DecimalFormat`（完整 pattern 語言）、`DateFormat`／`SimpleDateFormat`、`DateTimeFormatter`、`MessageFormat`；只做 ROOT／en-US，`format` 走 `Instant` |
| `java.io` 資料流 | `Reader`／`Writer`／`OutputStream`、`ByteArrayInputStream`／`ByteArrayOutputStream`、`DataInputStream`／`DataOutputStream`（`writeUTF`／`readUTF` 是 Java 的 modified UTF-8）、`BufferedReader`、`PrintWriter` |
| `java.util.HexFormat` | `of`／`ofDelimiter`、`with*`、`formatHex`／`parseHex`、`toHexDigits` 與位數分類 |
| `java.util.Scanner` | 讀一個 `String`：`hasNext`／`next` 與整數、長整數、浮點的形式，加上 `nextLine` |
| `java.security` | `MessageDigest`（MD5、SHA-1／224／256／384／512，以 Teyru 實作），加上 `java.util.zip` 形狀的 `Checksum` 與 `CRC32` |
| `java.util.zip` | `Deflater`／`Inflater`（level 0–9、zlib 包裝或 raw）、`Adler32`、`GZIPOutputStream`／`GZIPInputStream`；RFC 1951 的 deflate 以 Teyru 撰寫，web 層用它壓縮回應 |
| `java.util.zip` 封存 | `ZipEntry`／`ZipOutputStream`／`ZipInputStream`／`ZipFile`；這裡寫出來的封存，JDK 與 Info-ZIP 的 `unzip` 都讀得開 |
| `java.util.concurrent` | 執行器（`Executors`／`Future`／`ThreadPool`）與同步器（`CountDownLatch`、`AtomicInteger`／`AtomicLong`、`ConcurrentHashMap`）；全部是監視器，不是 lock-free |
| `com.google.gson` | Gson 的樹狀 API，以及執行期讀取類別欄位的物件綁定（[docs/json.md](/docs/json)） |
| 執行緒 | `Thread`／`Runnable`、真正的 `synchronized`（含方法修飾子）與 `Object.wait`／`notify`／`notifyAll`（[docs/language.md](/docs/language) §11） |
| 框架 | Spring 形狀的容器與 web 層：設定與 profile、`@ControllerAdvice`、攔截器、靜態檔案、CORS、`ResponseEntity`、`MockServer`、WebSocket、會話、multipart 上傳、驗證註解，以及可放上執行緒的接收迴圈（[docs/framework.md](/docs/framework)） |

集合以 Teyru 撰寫，所以 `for` 迴圈直接支援：

```teyru
List<String> names = new ArrayList<String>()
names.add("ada")
names.add("grace")
for (String n : names) {
  System.out.println(n)
}
```

模組與相依用 `teyru.mod` 宣告，取得與校驗照 Go 的做法（[docs/modules.md](/docs/modules)）：

```sh
teyru mod init example.com/app
teyru get example.com/greeting@v0.1.0
teyru build ./...
```

標準程式庫沒有清單式的一條「少了什麼」：每個缺口都寫在它自己所屬的套件那一列或那一節
（見 [docs/language.md](/docs/language) §11），而且每條都是決定——`MessageDigest` 沒有
SHA-3、`Scanner` 只讀 `String`、閏秒被拒絕、沒有 tzdata 的主機上時區是具名拒絕。

需要自己的原生程式庫時，宣告 `native` 方法並用 C 實作：

```teyru
class Native {
  public static native int add(int a, int b)
}
```
```sh
teyru build --native-header native.h program.teyru   # 產生要實作的宣告
teyru build --native impl.c program.teyru            # 一起編譯
```

完整說明見 [`docs/native.md`](/docs/native)。

---

## 編輯器與工具

- **VS Code**：[`teyru-lang/editors`](https://github.com/teyru-lang/editors) 倉庫的 `vscode/` 提供 `.teyru` 的 TextMate 語法highlight、語言設定與片段。
  用 `npx @vscode/vsce package` 打包，再以 `code --install-extension teyru-0.1.0.vsix` 安裝。
- **tree-sitter**：同一倉庫的 `tree-sitter-teyru/` 是完整文法，附 highlight query、縮排 query
  與 corpus 測試，Neovim、Helix、Zed 等可直接使用。
- **GitHub 的語言統計**由 `.gitattributes` 決定：`*.teyru` 宣告成
  `linguist-language=Teyru`，而 `*.java.ref`（那是規格——`.expected` 是由 javac 的輸出
  產生的）與 `*.expected`（測試資料）標成不計入。校正之前，「Java」曾經是這個倉庫裡
  最大的語言，而它幾乎不存在。**要說清楚的是 `linguist-language` 這一行不會讓 Teyru
  出現**：Linguist 只統計它認得的語言，所以統計裡仍然沒有 Teyru 這一項，要等語言本身
  與 `teyru-lang/editors` 那份文法被上游收下。

---

## 專案結構

| 路徑 | 說明 |
|---|---|
| `cmd/teyru` | CLI 進入點（`build`／`run`／`emit`／`emit-llvm`／`get`／`mod`／`version`） |
| `internal/driver` | 編譯流程：串起前後端、呼叫 C 編譯器、處理 native 來源與輸出選項 |
| `internal/source` | 檔案、位置換算、診斷容器 |
| `internal/lexer` | 詞法分析；換行不產生 token，只在 token 上標記「前面有換行」 |
| `internal/parser` | 遞迴下降剖析器，以顯著性與前綴完整性判斷敘述是否結束 |
| `internal/ast` | 語法樹、符號（類別／方法／欄位／變數）、型別 |
| `internal/sema` | 名稱解析、型別檢查、泛型抹除與推斷、多載解析、vtable／selector 配置、property 降階 |
| `internal/codegen` | 兩個後端：C（預設；類別→struct、虛擬呼叫→vtable、介面呼叫→itable、GC 根資訊）與 LLVM（`--backend=llvm`；產生程式自己的 IR 模組） |
| `internal/util` | 前後端共用的工具：名稱修飾、型別描述、C 版面配置 |
| `internal/runtime/src` | C 執行期：GC、字串、陣列、例外、boxing、執行緒與監視器、socket；作業系統那一層在 `tyrt_plat.h`，實作分成 POSIX 與 Windows 兩半。TLS 在 `tyrt_tls.c`——唯一會連結 OpenSSL 的檔案，只有程式的可達程式碼碰得到它時才編譯與連結 |
| `lib` | 以 Teyru 撰寫的標準程式庫 |
| `tests/programs` | 端到端測試程式與期望輸出（`go test` 會逐一編譯並比對） |
| `tests/native` | native 方法互通測試：Teyru 宣告 + C 實作 + 期望輸出（`TestNative`） |
| `examples` | 範例程式與 JVM 對照的 benchmark（`bench_*.teyru` 與 `.java`） |
| `scripts` | 開發腳本：`bench.sh` 效能量測、`pre-commit` 掛勾 |
| [`teyru-lang/docs`](https://github.com/teyru-lang/docs) | 語言參考、診斷碼、架構（另一個倉庫，即本文件站） |
| [`teyru-lang/editors`](https://github.com/teyru-lang/editors) | 編輯器支援：VS Code 擴充與 tree-sitter 文法（另一個倉庫） |

---

## 執行期模型

- **物件**：C struct，第一欄是 `tyobj { tyclass* cls }`。每個類別一張 `tyclass`，
  記錄父類、介面、vtable、介面表、GC 需要追蹤的參考欄位位移。
- **虛擬呼叫**：`obj->cls->vtable[slot]`；**介面呼叫**：`ty_itab(obj, selector)`。
  每個介面方法有全域唯一的 selector，每個類別的介面表由編譯期填好。
- **泛型**：編譯期抹除，執行期沒有泛型資訊（與 Java 相同）。
- **例外**：以 `setjmp`／`longjmp` 實作的 handler 鏈；`finally` 以巢狀 handler
  保證在任何路徑（含 catch 內再拋出）都執行。
- **堆疊溢位**：每個產生的函式開頭拿自己的框架位址跟執行緒的 `ty_stack_limit` 比一次
  （堆疊底端加 **256 KB** 餘裕），低於就丟出該執行緒**預先配置**的 `StackOverflowError`
  ——所以丟出的路徑不再配置、不再深遞迴。它與 Java 一樣可以被攔截（`catch (Error)`
  與 `catch (VirtualMachineError)` 都接得到，訊息是 `null`），執行緒與行程繼續跑；
  未攔截時印出 `Exception in thread "main" teyru.StackOverflowError` 並以狀態 1 結束。
  原生程式碼真的把堆疊寫壞時，`sigaltstack` 上的 SIGSEGV 處理器印出
  `stack overflow in native code` 後 `abort()`——**不從訊號處理器 longjmp**。測試是
  `t214`（捕獲、父類別、`Error`、另一條執行緒）、`t215`、`t216`；web 處理函式裡的深
  遞迴是 `t241`。
- **GC**：保守式標記清除。根包含原生堆疊（保守掃描）、靜態欄位註冊表與暫存器
  （`setjmp` 溢出）。物件不搬移，所以 C 端的暫存指標永遠有效。收集前會先停住每一條
  執行緒，再掃各自的堆疊（停止是世界性的，且是**合作式**的，見
  [docs/language.md](/docs/language) §11）。
- **字串**：UTF-8 `tystr { tyobj obj; int64 len; char* data }`；字面值是靜態物件，
  不經 GC。
- **陣列**：`tyarr { tyobj; len; data; esize; refs }`，元素內嵌在物件後方。

---

## 與 Java 的差異

Teyru 不是 Java 的子集，而是「Java 開發者一看就懂」的獨立語言。主要差異：

1. **沒有分號。** 分號會被編譯器拒絕（`TY-SYN-0001`）。
2. **`for` 標頭用冒號**：`for (int i = 0 : i < n : i++)`。
3. **try-with-resources 用換行分隔**，不用分號。
4. **enum 常數區與成員區用一個冒號**分隔（沒有成員時可省略）。
5. **原生 property**：欄位後面接 accessor 區塊即成 property；`field` 代表底層儲存。
   沒有 accessor 區塊的欄位就是普通 Java 欄位。
6. **`val`**：推斷型別的不可重綁區域變數（不是深度不可變）。
7. **沒有 checked exception 檢查**；`throws` 會被剖析但不強制。
8. **沒有 annotation processor**；註解可以反射，但元素是**按名字讀**
   （`ann.stringValue("value")`），不是 Java 的 `ann.value()`。
9. **不是 bytecode 平台**：沒有 `.class`、沒有 `java.lang`、沒有 JNI，
   目前也**無法**與既有 Java 程式庫互通——這是刻意的取捨。

完整清單見 [docs/language.md §12](/docs/language)。

---

## 命令列介面

```
teyru build [flags] <files...>                 編譯成原生執行檔
teyru run   [flags] <files...> [-- args...]    編譯後直接執行
teyru emit  [flags] <files...>                 印出產生的 C
teyru emit-llvm [flags] <files...>             印出交給 LLVM 的 IR
teyru get <module>@<version>                   取得模組到快取並加入相依
teyru mod init <module-path>                   為新模組寫出 teyru.mod
teyru mod tidy                                 讓 teyru.mod 與 teyru.sum 對上原始碼
teyru version                                  版本
teyru help                                     說明
```

| 旗標 | 說明 |
|---|---|
| `-o <path>` | 輸出檔名（預設 `a.out`） |
| `-c <path>` | 保留產生的 C 檔在指定路徑 |
| `--cc <name>` | 使用的 C 編譯器（預設依序找 `clang`、`gcc`、`cc`） |
| `-O0`…`-O3` | 最佳化等級（預設 `-O2`） |
| `--llvm-ir <path>` | 額外輸出 LLVM IR 模組 |
| `--native <file.c>` | 加入 C 檔一起編譯，實作 native 方法（可重複） |
| `--native-header <path>` | 產生 native 方法的宣告（見 [docs/native.md](/docs/native)） |
| `--link <arg>` | 傳給連結步驟的參數，例如 `--link -lm` |
| `--no-lto` | 關閉 LTO（工具鏈不支援時會自動退回） |
| `--target <os>/<arch>` | 編譯給哪個平台（預設是這台機器）；未知的目標會以名字被拒絕 |
| `--backend <c\|llvm>` | 用哪個後端編譯程式（預設 `c`，見下面〈後端與平台〉） |
| `-v` | 顯示實際執行的編譯命令 |

---

## 後端與平台

**兩個後端，預設是 C。** 預設的 C 後端替整個程式產生 C（見
[docs/architecture.md](/docs/architecture)）。`--backend=llvm` 換成後端直接產生**這個
程式自己的 LLVM IR**：執行期仍然是 C，clang 只負責組譯與連結。它拒絕它降不下去的
東西，不會安靜地退回 C 後端——拒絕是一個 `TY-INT-0100` 診斷，指出是哪個建構。

那條界線是量出來的，不是猜的：2026-09-17 用 main 的編譯器對 `tests/programs` 的
**256 支**掃過一輪（`teyru build --backend=llvm`，建得起來的每一支都跑起來與 `.expected`
逐位元組比，`exit` 與 `experr` 也比）：**159 支建得起來**，其中 **153 支輸出完全相同**、
**6 支不同**（那 6 支是 W5／W6 的 JDK 探針，期望值來自 JDK，正列在 `known-failures.txt`
裡，差異就是那些工作項要修的）；**93 支被 emitter 以 `TY-INT-0100` 具名拒絕**；
**4 支在建到後端之前就被語意分析拒絕**（同樣是 `known-failures.txt` 的探針）；
**0 個模組 clang 不收**。被拒絕的按數量是：程式自己宣告上的註解（38——Lombok、Spring
與 Gson 那些要靠註解才成立的宣告）、帶型別 pattern／守衛／`null` 的 `switch` case（12）、
綁定變數的 `instanceof` pattern（8）、執行緒（8）、內部類別（7，含區域類別；訊息是
不降階 enclosing-instance 鏈）、反射呼叫（7）、try-with-resources（5）、`synchronized`
（3）、boxing `void`（2）、介面的 `super` 呼叫與其他（2）。**lambda 與方法參照已經不在
被拒絕的理由裡**（這份清單以前把它們排在第一位）；它目前只編 linux/amd64，其他目標以
`TY-INT-0101` 拒絕。

**平台層。** 執行期對作業系統的呼叫都走 `internal/runtime/src/tyrt_plat.h`：
時間與 CPU、mutex 與 condition variable、執行緒、啟動、socket、檔案，共四十個
`typlat_*` 函式，實作分成 `tyrt_plat_posix.c` 與 `tyrt_plat_win.c` 兩半，
只有 `tyrt.c`／`tyrt2.c`／`tyrt_thread.c`／`tyrt_net.c`／`tyrt_tls.c` 會呼叫它們。
（TLS 是這一層唯一的例外：它寫在 OpenSSL 上，只有程式的可達程式碼碰得到它時才會被
編譯與連結，所以沒有 OpenSSL 的目標對它是具名拒絕——見 [docs/native.md](/docs/native)。）

`teyru build --target <os>/<arch>` 選的是編譯器、旗標、要編哪一半的平台層與輸出檔名；
沒有給就編給這台機器。目標表有五列，而**「編得出來」與「跑得起來」是兩個問題**、證據
也不一樣，所以分成兩欄——把其中一個寫進另一格，就是把沒量到的講成量到的：

| 目標 | 建置 | 執行 |
|---|---|---|
| `linux/amd64` | ✅ | ✅ 這台機器上原生跑完整套件：`go test ./...` 與 `TEYRU=<compiler> sh tests/run.sh`（250 項） |
| `windows/amd64` | ✅ 以 `x86_64-w64-mingw32-gcc` 交叉編譯；**碰得到 TLS 的程式除外**（見下） | ✅ 在 Wine 下跑：當時 195 支測試程式有 179 支逐位元組相同（16 支不符裡 14 支在改動前的編譯器上用 gcc 編 Linux 也一樣失敗，2 支是 Windows 的路徑與檔名事實） |
| `linux/arm64` | ✅ 以 `aarch64-linux-gnu-gcc` 交叉編譯；那個目標的 sysroot 是另外裝上去的（見下） | ✅ 在 qemu-aarch64 下跑完整套件：**250 項全過**——222 支測試程式全部建置、執行、逐位元組相同，3 個套件、23 個拒絕案例與 2 個 native 案例也全過 |
| `darwin/amd64`、`darwin/arm64` | ⚠️ **只到「編譯並連結」**：`teyru build --target darwin/arm64 --cc <zig 包裝>` 現在走得通（`resolveTarget` 看的是這次建置真的會跑的編譯器，所以目標表沒有編譯器而呼叫端給了 `--cc` 時不再拒絕），產物是 Mach-O 執行檔；**沒有任何一行被執行過**。W9 之前那兩個數字（不碰 TLS 的 188 支建得起來、碰得到 TLS 的 34 支不行）正在重測——碰得到 TLS 的程式現在是在 C 編譯器**之前**由驅動具名拒絕，而不是 `openssl/err.h` 找不到 | ❌ 這裡沒有 macOS，所以沒有任何人跑過它們 |

證據是分開量的，因為「編得出來」與「跑得起來」不同，而這次新增的量測是 `linux/arm64` 與
macOS 這兩列。

**`linux/arm64` 是這樣量的。** 這台機器原本有 `aarch64-linux-gnu-gcc`，但它的 sysroot 是
空的——不是標頭不對，是根本沒有標頭（`fatal error: stdint.h`）。先把那個 sysroot 裝起來：
libc 與其標頭、`linux-libc-dev`、`libatomic`，以及 arm64 的 TLS 需要的 OpenSSL 3.6.4（與
libcrypto 執行期要的 zlib、zstd）都取自 Debian sid 的 arm64 套件，解進這支交叉編譯器預設的
sysroot `/usr/aarch64-linux-gnu/sys-root`。有兩件事要為 Fedora 這支編譯器另外處理：Debian
那兩個連結腳本（`libc.so`、`libm.so`）裡寫死的是 Debian 的絕對路徑，要改寫成 sysroot 內的
路徑；Fedora 的 gcc specs 無條件加上 `-latomic_asneeded`（一個 Fedora 的封裝手法，讓
libatomic 只在真的用到時才連進去），而這支交叉編譯器不帶 libatomic，所以要把它指向 Debian
的 `libatomic.so.1`。

那次跑的是**沒有改過的 `tests/run.sh`**，而且只有三件事由外面給。W9 之後不必再那樣繞：`run.sh` 與 `go test` 都讀 `TEYRU_TARGET`，目標由那個變數給，`.skip` 也照那個平台判讀；當時的作法是把編譯器多包一層 `--target linux/arm64`（`run.sh` 只喊 `teyru build -O1 -o <輸出> <來源>`，目標由編譯器那個名字帶著走）。`CC` 是
`aarch64-linux-gnu-gcc`，套件自己那支 C 測試（`native/net_c_test.c`）因此也編成 arm64。
`QEMU_LD_PREFIX` 指向那個 sysroot：Fedora 的 `qemu-user-static` 已經註冊了 binfmt_misc
handler，arm64 的執行檔直接執行就會被 qemu 接手，但那支 qemu 沒有編進預設 sysroot，動態
連結的程式要靠這個環境變數才找得到 loader。結果是 **250 項全過、0 項不符**：222 支測試
程式每一支都建置、執行、逐位元組相同，另外 3 個套件、23 個拒絕案例與 2 個 native 案例也
全過（native 那支 C 測試是編成 arm64 在 qemu 下跑的）。

**macOS 那兩列只到「編譯並連結」，而且要說清楚是怎麼到的。** 現在它走得通 `teyru build`：目標表上 Apple 那兩列沒有 C 編譯器，但 `resolveTarget` 看的是這次建置真的會跑的編譯器，所以呼叫端給的 `--cc` 算數。沒有 `--cc` 時仍然是具名拒絕（`teyru: no C compiler for darwin/arm64 on a linux/amd64 host: building for it needs a compiler that runs here and targets it, and neither this table nor --cc names one`）；給了之後——例如一個兩行的包裝 `exec …/zig cc -target aarch64-macos "$@"`——
`teyru build --target darwin/arm64 --cc <包裝> -o hello-darwin hello.teyru` 產出 Mach-O 64-bit arm64 執行檔。連結時 zig 對 `-flto` 回 `LTO requires using LLD`；編譯器本來就會對沒有 LTO 的工具鏈退回不帶 `-flto` 的第二次嘗試，成功的是那一次，不是預設那條。

碰得到 TLS 的程式在 darwin 上是**驅動的具名拒絕，發生在 C 編譯器之前**（`teyru: TLS is not available for darwin/arm64: macOS ships SecureTransport rather than OpenSSL, …`），而不是從前那種 `tyrt_tls.c: openssl/err.h` 找不到。

W9 之前那條繞道（`teyru emit` 的 C 加上執行期六個檔案交給 `zig cc`）與它量到的兩個數字（不碰 TLS 的 188 支全部編譯並連結成功、碰得到 TLS 的 34 支不行）在這裡保留為歷史：那 34 支現在改由驅動拒絕，而 188 那個數字要重測（W9 之後的計數正在跑）。

**五個目標都實作了，而這台機器現在能演練四個。** `linux/amd64` 原生跑整套測試、
`windows/amd64` 在 Wine 下跑、`linux/arm64` 在 qemu-aarch64 下跑（250 項全過），
`darwin/amd64` 與 `darwin/arm64` 只到「編譯並連結」。差別不在工具鏈而在機器：arm64 這一列
有東西可以執行它，macOS 那兩列沒有——沒有任何 macOS 在旁邊，所以那一格不能寫成 ✅，也
沒有任何人在它上面跑過一行程式。

**windows 與 macOS 沒有 TLS，而被拒絕的是程式。** TLS 那一層寫在 OpenSSL 上，
mingw-w64 沒有它、macOS 出的是 SecureTransport，所以碰得到 TLS 的程式在那兩個目標上是
**具名拒絕**（訊息指名目標、原因與可以改用的目標），而不是留給連結器去說
`undefined reference to SSL_CTX_new`。要注意「碰得到」算的是**可達性**，而 W9 之後它算的是**程式自己的呼叫圖**：反射用的成員表與 `Class.forName` 的類別表不再被當成可達（emitter 標記那些行，TLS 的不動點不走它們），所以 `t146_reflect`、`t101_gson` 與 `t102_web`（Spring 形狀的那一層會掃描類別）現在都建得起來——`t101_gson` 的 PE32+ 只 import `KERNEL32.dll`、`WS2_32.dll`、`msvcrt.dll`，在 Wine 下的輸出與 `.expected` 相同。透過反射走到 TLS 的呼叫由 `tyrt_net.c` 的弱符號回答一個具名、可攔截的 `UnsupportedOperationException`（`Net.tlsClientContext0: this program was not linked against OpenSSL`），而不是跳到 `NULL`。不用 TLS 的程式不會被連結 OpenSSL。
`linux/arm64` 不在這兩個目標之列：那個 sysroot 裡裝了 arm64 的 OpenSSL，所以 TLS 在
arm64 上是被量過的——`t163_https_roundtrip`、`t191_tls_keepalive` 與
`t192_tls_handshake_timeout` 都在 qemu 下跑過且逐位元組相同。

這張表**不是「每一列都跑過」的承諾**。今天缺的那一格只有 macOS 的**執行**：它編得出來（`--cc` 指到一個跑在這裡、目標是 macOS 的編譯器），但沒有 macOS 能執行它，所以那一格是 ❌。W9 收掉了兩個「還沒解的空隙」：`tests/run.sh` 與 `go test` 讀 `TEYRU_TARGET`，目標不必再靠替換編譯器名字；`resolveTarget` 也接受呼叫端給的 `--cc`，所以 Apple 那兩列不必再繞過目標表。

**push 與 PR 上沒有 CI**：每次改動的關卡就是上面那兩道指令，在這台機器上由人跑，所以
文件裡的數字都寫著它是怎麼量、在哪裡量的。`.github/workflows/release.yml` 是這個倉庫
**唯一**的工作流程，只在發佈 release 時跑：它建置那個 tag、對它跑整套測試、把執行檔附到
release 上，跑的內容與人跑的是同一組（`make ci`、`make jdk-diff`、`make notices`、
`tests/run.sh`），push 與 PR 都不會觸發它。arm64 因此不再停在「實作了、沒有任何人跑過」
——它是被跑過的（數字與做法見上表）；macOS 那兩列仍然沒有，而且只要沒有一台 macOS，它們
就會一直是這樣。


---

## 開發

```sh
go build ./...          # 建置
go test ./...           # 端到端測試（會編譯 tests/programs 下每個程式並比對輸出）
go vet ./...
sh scripts/bench.sh       # 與 JVM 對照的效能測試（需要 java 才會跑 JVM 那一半）
```

新增測試只要在 `tests/programs/` 放 `xxx.teyru` 與 `xxx.expected`；
若程式需要命令列參數，再放 `xxx.args`（每行一個參數）；程式如果**應該**失敗，
用 `xxx.exit` 寫它必須結束時的狀態碼、`xxx.experr` 寫它應該印到 stderr 的內容。
`go test` 會自動處理。

測試倉庫還有三個檔案決定「今天什麼算通過」（見 `teyru-lang/tests` 的 `README.md`）：

- `known-failures.txt`：一行一個 `<案例> <工作項> <原因>`。列在這裡的案例失敗是**已知
  失敗**（會回報，但不讓這次跑失敗）；而列在這裡的案例**通過**會讓整次跑失敗——所以
  條目不會活得比它描述的 bug 久。兩個 driver（Teyru 倉庫的 `go test` 與 `tests/run.sh`）
  讀同一個檔案，沒有原因的條目不收。
- `jdk-diff-allow.txt`：`<案例> <種類> <工作項> <原因>`，記下與 JDK 對照後**決定接受**的
  差異（或 Java 寫不出來的東西）。沒有工作項（或明確寫 `none`）的條目不收。
- `<part>/<案例>.skip`：這個案例不能在哪些平台跑（`windows`、`darwin/arm64`，或
  `!linux` 表示只有那個平台能跑），`#` 之後寫原因。

倉庫裡的 make target 把這些包起來（`make` 本身等於 `make build`）：

| target | 做什麼 |
|---|---|
| `make check` | 提交前要跑的：`lint`（`go vet` ＋ `gofmt` 差異檢查）＋ `notices`（第三方聲明與樹一致）＋ `test` |
| `make ci` | 一次 CI job 會跑的東西，在這裡由人跑：`lint`、整套測試分別用 clang 與 gcc 各建一次，`TEYRU_JDK` 有設就再加上 JDK 差分。只裝了一個 C 編譯器時，gcc 那一半會明說它沒跑 |
| `make jdk-diff` | 把 `tests/programs/` 裡能翻譯的程式用 JDK 21 編譯執行，比對 stdout 與結束狀態；需要 `TEYRU_JDK` 指向 JDK 21 的家目錄 |
| `make progen` | 隨機程式差分：`internal/tools/progen` 依固定種子產生 200 個程式，兩種寫法各編一次再比對 |
| `make notices` | 核對 `THIRD-PARTY-NOTICES.md` 與樹一致（見 [docs/legal.md](/docs/legal)） |
| `make bench`／`make examples` | 效能對照與範例 |

執行期有兩個診斷開關給這些工作用：`TEYRU_GC_STRESS=N` 讓**每 N 次配置**強制收集一次，
`TEYRU_GCTRACE=1` 每次收集印出一行——什麼觸發的、停頓多久、收集前後的堆積大小。

貢獻前請讀 [AGENTS.md](https://github.com/teyru-lang/Teyru/blob/main/AGENTS.md)。

---

## 授權

見 [LICENSE](https://github.com/teyru-lang/Teyru/blob/main/LICENSE) 與 [THIRD-PARTY-NOTICES.md](/docs/legal)。
