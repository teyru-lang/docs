---
title: "Teyru 语言参考"
description: "Teyru 0.2 的语法与语义：源文件与词法、类型、声明、原生 property、语句、泛型、lambda、异常与标准库。"
---

本文档描述 Teyru 0.2 的语法与语义。文档以实现为准：这里写的每一项语言特性都在
`tests/programs/` 有对应的测试，`go test ./...` 会逐项验证；标准库的 API 则只
覆盖一部分（例如 `Map.putAll`、`Map.keys` 还没有测试用到），测试覆盖范围仍不完整。

- [1. 源文件与词法](#1-源文件与词法)
- [2. 换行与语句终止](#2-换行与语句终止)
- [3. 类型](#3-类型)
- [4. 声明](#4-声明)
- [5. 原生 property](#5-原生-property)
- [6. 语句](#6-语句)
- [7. 表达式](#7-表达式)
- [8. 泛型](#8-泛型)
- [9. lambda 与方法引用](#9-lambda-与方法引用)
- [10. 异常](#10-异常)
- [11. 标准库](#11-标准库)
- [12. 与 Java 的差异](#12-与-java-的差异)
- [13. 尚未实现](#13-尚未实现)

---

## 1. 源文件与词法

- 源文件是 UTF-8，扩展名 `.teyru`。开头的 BOM 会被忽略。
- 注释：`//` 行注释、`/* ... */` 块注释（可跨行）。
- 标识符：以字母、`_`、`$` 或非 ASCII 字母开头，其后可接数字。
- 关键字与 Java 相同的一组（`class`、`interface`、`enum`、`record`、`new`、`switch`…），
  另有 `var` 与 `val`（见 §3.4）。
- 字面量：整数（十进制、`0x`、`0b`、`0` 开头八进制、`_` 分隔、`L` 后缀）、
  浮点（`f`／`d` 后缀、指数）、`char`、`String`、文本块 `"""…"""`、
  `true`／`false`／`null`。
- 转义序列：`\n \t \r \b \f \s \0-7 \uXXXX` 与 `\\ \' \"`；`\<换行>` 续行在普通字符串
  与文本块都适用。这份清单以外的转义序列是错误，会得到 `TY-SYN-0011`
  （`\q` 不是 `q`）。

**没有分号。** 分号不是合法 token，会直接产生 `TY-SYN-0001`；
字符串、字符、注释与文本块内的分号是数据，不受影响。

## 2. 换行与语句终止

词法分析器不产生 NEWLINE token：每个 token 只记录“前面是否有换行”。
解析器在两个条件同时成立时把换行当作语句结束：

1. **换行在此处有效**：在小括号、中括号与参数列表内无效
   （`f(a,\n b)` 合法）；在块层级、类成员层级有效。
2. **前缀已完整**：下列情况即使有换行也不算结束——
   - 表达式以运算符、逗号、`.`、`::`、`->`、`?`、`:` 结尾；
   - 下一行以 `.` 或 `::` 开头（方法链）；
   - 分隔符尚未关闭。

实现上由 `parser.continues()` 决定；下一行以 `+ - ! ~ ( [ { @ <` 开头时**不**延续，
避免“下一行是新语句”与“上一行还没写完”混淆。

特殊情况：

- `return` 后直接换行＝无值返回；要返回值，表达式必须从同一行开始，
  或用 `return (` 让它跨行。
- `throw` 同理：表达式没接在同一行就是 `TY-SYN-0003`。`yield` 也拿不到下一行的值，
  但它是被当成标识符，因此消息是 `cannot find symbol yield`。
- `++`／`--` 不跨行附着：后缀运算符必须与操作数同行。
- 不能在行末用 `;` 塞多个语句，请分行。
- `do { … } while (c)` 之后不加分号。

## 3. 类型

### 3.1 基本类型

`boolean byte short char int long float double void`，与 Java 相同的大小与范围。

### 3.2 引用类型

类、接口、enum、record、数组、类型变量。`Object` 是所有类的根，
`null` 可以赋值给任何引用类型。

### 3.3 数组

`T[]`、`T[][]`、`new int[10]`、`new int[2][3]`（会创建内层数组）、
`new String[]{"a","b"}`、`{1,2,3}` 初始化列表。数组有 `length` 字段与
`clone()` 方法；元素访问会做边界检查（读取与写入都是，null 数组先抛
`NullPointerException` 再检查边界，顺序与 Java 相同）。

数组是协变的（`Object[] o = new String[2]` 合法），但创建时就记下元素类型，
所以通过更宽的视角写入不符合的值会抛 `ArrayStoreException`：

```teyru
Object[] o = new String[2]
o[0] = "hello"
o[0] = Integer.valueOf(5)   // ArrayStoreException
```

### 3.4 `var` 与 `val`

```teyru
var n = 10        // int，可重新赋值
val name = "ada"  // String，不可重新赋值
```

- 两者都只能用在局部变量（含增强 `for` 的变量与 try-with-resources），
  不可用于字段、参数或返回类型。
- 一定需要初始值；`null` 推断不出类型；lambda 需要目标类型。
- `val` 是“不可重新绑定”，不是深度不可变。
- 字段与参数一律要写出类型。

## 4. 声明

### 4.1 类、接口、enum、record

```teyru
class Base {
  protected int value
  public Base(int v) {
    value = v
  }
  public int get() {
    return value
  }
}

class Derived extends Base implements Comparable<Derived> {
  public Derived(int v) {
    super(v)
  }
  @Override
  public int compareTo(Derived o) {
    return get() - o.get()
  }
}

interface Greeter {
  String greet(String who)
  default String hello() {
    return greet("world")
  }
}

enum Color {
  RED, GREEN, BLUE
}

enum Planet {
  EARTH(1), MARS(2)

  :  // 常量区与成员区的分隔冒号
  private final int rank
  Planet(int rank) {
    this.rank = rank
  }
  public int rank() {
    return rank
  }
}

record Point(int x, int y) {
}
```

- 修饰符：`public protected private static final abstract native synchronized
  transient volatile strictfp sealed non-sealed default`。
- 嵌套类、内部类（有外层实例）、局部类、匿名类都支持。
- `enum` 的常量区与成员区之间用**一个冒号**分隔；没有成员时省略冒号；
  没有常量但有成员时以冒号开头。
- `record` 自动生成私有 final 字段、accessor、`toString`、`hashCode`、`equals`
  与规范构造函数；也可以写紧凑构造函数（compact constructor）补充验证。
- 注解类型（`@interface`）可以声明并使用，但没有运行时反射；`annotation`
  不是关键字。

### 4.2 字段与方法

```teyru
class Counter {
  private int count          // 一般 Java 字段
  public static final int MAX = 100
  public int step = 1        // 有初始值的字段

  public void inc() {
    count += step
  }
  public static Counter create() {
    return new Counter()
  }
  public Counter() {
  }
}
```

- 静态与实例初始化块：`static { … }` 与 `{ … }`。
- 构造函数可以重载；`this(...)`／`super(...)` 只能写在构造函数里，但**不必是**第一句——
  `super()` 之前的语句会先执行（JEP 513，Java 25 的灵活构造函数体），实际输出与
  javac 25 相同。
- 可变参数：`void log(String fmt, Object... args)`。
- 抽象方法只能在抽象类或接口中；接口方法有 body 时必须是
  `default`、`static` 或 `private`。

## 5. 原生 property

字段声明后面接 accessor 块就成为 property：

```teyru
class Person {
  public String name        // 普通字段
  private int age
  public int years {        // property
    get {
      return field          // field = 底层存储
    }
    set {
      field = value < 0 ? 0 : value
    }
  }
  public String label {     // 只有 getter 的计算 property
    get {
      return name + " (" + age + ")"
    }
  }
  public Person(String name, int age) {
    this.name = name
    this.age = age
  }
}
```

规则：

| 主题 | 行为 |
|---|---|
| 存储 | 有初始值、有默认 accessor、有 setter，或 accessor 内用到 `field` 时才需要存储；否则为计算 property，且不能用 `final`／`volatile`／`transient`。 |
| `field` | 只在该 property 的 accessor 内代表底层存储；其他地方的 `field` 还是一般标识符。 |
| 可见性 | property 的修饰符是 accessor 的默认可见性；底层存储一律 `private`。 |
| 访问 | `p.years` 读取会调用 getter，`p.years = v` 调用 setter，`p.years += 1` 先 getter 再 setter。只有属性声明上的初始值直接写入存储；构造函数与初始化块里的赋值跟其他地方一样会调用 setter。 |
| 命名 | JavaBeans：getter `getX`（`boolean` 可用 `isX`），setter `setX`。也可以直接调用 `p.getYears()`。 |
| 继承 | accessor 参与覆写、可见性与泛型替换，与普通方法相同。 |
| `final` | `final` property 不能有 setter。 |
| 静态 | `static` property 的 accessor 也是静态。 |

## 6. 语句

### 6.1 基本 for 使用冒号

```teyru
for (int i = 0 : i < 10 : i++) {
  System.out.println(i)
}
for ( : : ) {          // 无限循环
  break
}
```

三段用**两个顶层冒号**分隔。括号、中括号、大括号内以及三元运算符的 `:`
不会被当成分隔符，所以 `for (int i = a > b ? 0 : 1 : i < 3 : i++)` 合法。

### 6.2 增强 for

```teyru
for (String s : names) { … }
for (var s : names) { … }
for (int v : new int[]{1,2,3}) { … }
```

支持数组与 `Iterable`。

### 6.3 try-with-resources

资源以**换行**分隔，不用分号：

```teyru
try (
  Reader r = open("a.txt")
  Writer w = create("b.txt")
) {
  copy(r, w)
}
```

关闭顺序是声明顺序的逆序，与 Java 相同。

### 6.4 switch

支持语句与表达式、`->` 与 `:` 两种形式、多标签、enum、字符串、
类型模式与 `when` 守卫：

```teyru
switch (cmd) {
  case "up", "north":
    move(0, 1)
    break
  case "down":
    move(0, -1)
    break
  default:
    break
}

String label = switch (n) {
  case 1, 2 -> "low"
  case 3 -> "high"
  default -> "none"
}

String kind = switch (obj) {
  case String s -> "string:" + s.length()
  case Integer i when i.intValue() > 10 -> "big"
  case Integer i -> "small"
  default -> "other"
}
```

- `:` 形式保有 Java 的 fall-through；`->` 形式不会。
- 同一个 switch 不能混用两种形式。
- switch **表达式**必须穷尽：没有 `default` 又没有涵盖所有值时是 `TY-TYP-0096`
  编译错误（`int`／`String` 选择器一律要 `default`；枚举选择器要列完每一个常量），
  不会产生一个静默算出零值的结果。switch **语句**没有这个要求。

### 6.5 其他

`if`／`else`、`while`、`do…while`（结尾不加分号）、`return`、`break`／`continue`
（可加标签）、`throw`、`yield`、`assert`、`synchronized (lock) { … }`、
标签语句。

## 7. 表达式

- 完整的运算符优先级与 Java 相同：`||` `&&` `|` `^` `&` `==` `!=`
  `< > <= >= instanceof` `<< >> >>>` `+ -` `* / %`，一元、后缀、三元、赋值。
- 整数除法与取余数会检查除零（抛 `ArithmeticException`）。
- `==` 在引用类型上是**引用相等**，与 Java 相同；`String` 的 `==` 也是引用相等，
  要比较内容请用 `equals`。
- 字符串拼接：`+` 的任一侧是 `String` 时就做拼接，其他操作数会自动转成字符串
  （`null` 变成 `"null"`）。
- `instanceof` 支持类型模式：`if (o instanceof String s) { … }`，以及 record 解构
  模式：`if (o instanceof Point(int x, int y)) { … }`。
- **基本类型模式**（JEP 507）：`if (o instanceof int i)`、`case byte b ->`。
  匹配条件是**转换精确**，规则与 Java 相同，分选择器的两种类型：
  - 选择器是**引用类型**时，只有它的包装类型刚好等于该基本类型才匹配：
    `Integer(42)` 匹配 `int`，但不匹配 `long`、`double`、`byte`。
  - 选择器是**基本数值**时，值能精确转成该类型才匹配：`42` 匹配 `byte`，
    `16777217` 不匹配 `float`（会失真），`16777216` 则匹配。
  `boolean` 只和 `Boolean` 匹配，`null` 一律不匹配。
  基本类型模式一定要有变量名。

  ```teyru
  String kind = switch (o) {
    case int i when i > 100 -> "large int"
    case int i -> "int " + i
    case double d -> "double " + d
    default -> "other"
  }
  ```
- `Interface.super.method()` 会静态绑定到该接口的 default 实现：
  `A.super.hello()`；接口必须是当前类的父接口。
- cast：数值间做转换，引用类型间做运行时检查（失败抛 `ClassCastException`）。
- boxing／unboxing 自动发生，`null` 拆箱会抛 `NullPointerException`。
- 对象初始化列表：`new int[]{…}`、`int[] xs = {1,2,3}`、嵌套 `{{1,2},{3}}`。

## 8. 泛型

```teyru
class Box<T> {
  private T value
  public Box(T v) {
    value = v
  }
  public T get() {
    return value
  }
}

interface Mapper<A, B> {
  B map(A a)
}

class Util {
  static <T> T first(T[] xs) {
    return xs[0]
  }
}
```

- 支持类型参数、上界（`<T extends Number>`）、多重上界（`&`）、
  通配符（`?`、`? extends`、`? super`）、泛型方法、diamond `new Box<>("x")`。
- 泛型方法可以由实参推断类型参数（基本类型实参会自动 boxing），也可以显式指定：
  `Main.<String>identity("x")`、`box.<Integer>map(v -> v.length())`。
- **泛型在编译期擦除**：运行时只知道类，不会有 `ClassCastException` 之外的
  泛型检查；`List<String>` 与 `List<Integer>` 在运行时是同一个类型。
- 基本类型不能当类型实参（`Box<int>` 不合法），请用包装类。

## 9. lambda 与方法引用

```teyru
interface Fn<R> {
  R apply(int v)
}

Fn<Integer> f = (v) -> v + 1
Fn<Integer> g = v -> v * 2          // 单一无类型参数可省略括号
Fn<Integer> h = (int v) -> {
  return v - 1
}
Fn<Integer> m = Main::twice         // 静态方法
Fn<String>  c = String::valueOf     // 重载以目标类型决定

interface Maker<T> {
  T make()
}
Maker<Rect> s = Rect::new           // 构造函数引用（目标接口需自行声明）
```

- 目标类型必须是**函数式接口**（只有一个抽象方法的接口）。
- lambda 捕获外部局部变量时，会复制到合成类的字段；被捕获的变量可以
  在 lambda 之后继续使用，但**写入的变量不会回写**（与 Java 相同，
  区别是 Teyru 不要求变量是 effectively final 才能捕获）。
- 方法引用支持：`Type::staticMethod`、`obj::instanceMethod`、
  `Type::instanceMethod`（未绑定形式，第一个参数当接收者）、`Type::new`。

## 10. 异常

```teyru
try {
  risky()
} catch (IllegalArgumentException | IllegalStateException e) {
  recover()
} catch (Exception e) {
  log(e.getMessage())
} finally {
  cleanup()
}
```

- `Throwable` 家族：`Exception`、`RuntimeException`、`NullPointerException`、
  `ArithmeticException`、`ArrayIndexOutOfBoundsException`、`ClassCastException`、
  `IllegalArgumentException`、`IllegalStateException`、`NoSuchElementException`、
  `NegativeArraySizeException`、`ArrayStoreException`、`AssertionError`、
  `UnsupportedOperationException`。
- 对 `null` 读**写**字段、调用方法、读写数组元素（含取 `length`）都会抛
  `NullPointerException`。
- `catch` 多类型用 `|`；`finally` 一定会执行（包括 catch 内再次抛出的情况）。
- **没有 checked exception 检查**：`throws` 会被解析但不强制。
- 未捕获的异常会打印消息并以状态 1 结束。

## 11. 标准库

标准库是用 **Teyru 本身**编写的（`lib/*.teyru`），每次编译都跟用户程序一起被
编译与检查——它没有什么特别的地位，`lib/` 下面的文件就是用 Teyru 写的普通程序。
标准库是**一个** Teyru 包：`teyru`。其中的类取 Java 的名字，所以 Teyru
代码用一行按需导入就能把它整个带进来：`import teyru.*`（只用到单个类时
`import teyru.List` 也一样）。Java 风格的 `import java.util.*` 与
`import java.util.List` 照样接受——那是“Java 源代码不改就能编译”的那条路，见下面的
“名称怎么找”。

### java.lang（`lib/01`–`lib/07`）

`Object`、`Class`、`String`（`format`／`join`／`valueOf`／`compareTo`／
`startsWith`／`replace`／`split`／`strip`／`repeat`…）、`StringBuilder` 与
`StringBuffer`、`Math`（含 `floorDiv`／`floorMod`／`round`／三角函数）、
`System`（`out`／`err`／`currentTimeMillis`／`nanoTime`／`arraycopy`／`getenv`／
`exit`）、`PrintStream`、`InputStream`、`IO`（`println`／`readln`）、
`Number` 与八个包装类（`Integer.parseInt`、`Long.toHexString`、`Character.isDigit`
等完整静态 API）、`Throwable` 家族、`Enum`、`Record`、`Comparable`／`Iterable`／
`Iterator`／`Cloneable`／`AutoCloseable`、`Logger`。

### java.util（`lib/08`、`lib/14_*`）

`Collection`、`List`／`ArrayList`／`LinkedList`、`Set`／`HashSet`／
`LinkedHashSet`／`TreeSet`、`Map`／`HashMap`／`LinkedHashMap`／`TreeMap`（红黑树）、
`SortedSet`／`NavigableSet`／`SortedMap`／`NavigableMap`、`Queue`／`Deque`／
`ArrayDeque`、`Iterator`／`ListIterator`、`Arrays`、`Collections`、`Objects`、
`Optional`、`StringJoiner`。

契约照 JDK：`LinkedHashMap` 是插入顺序、`TreeMap` 是键顺序、`TreeSet` 的
`headSet`／`tailSet`／`subSet` 是**实时视图**（在范围内 `add` 会写进原集合，
范围外是 `IllegalArgumentException: key out of range`；`TreeMap.keySet()` 的视图
则照 JDK 一样拒绝新增）、`computeIfAbsent`／`merge`／`forEach` 都在。
`Stream.of(array)` 会把数组展开成元素（与 javac 相同的重载：`of(T...)` 比 `of(T)`
更具体）。
`java.lang.reflect`（`lib/26`）提供 `Class`、`Field`、`Method`、`Constructor`、
`Modifier`、`Array` 与六个反射用异常；它们读的是编译器为每个类生成的静态表，
查一次数据是走一次数组，运行期不建表。成员表只在程序真的会用到反射时
才写进可执行文件（用到时整份都会带上，量到的 hello world 从 445.9 KB 变成约 3 MB；
没用到的程序一行都不带）。与 Java 的差异：类名是 Teyru 的
（`String.class.getName()` 是 `teyru.String`，`forName` 两种名字都收）、没有注解
反射、所有数组共用一个类（所以没有 `getComponentType`）、没有泛型类型参数的
反射、原生类型取值器只收完全相符的包装类型、不检查访问控制（只有 final 会拦）。
`java.util.function`（`lib/09`）提供 `Function`／`BiFunction`／`Consumer`／
`Supplier`／`Predicate`／`Runnable`／`Comparator`。

```teyru
List<String> names = new ArrayList<String>()
names.add("ada")
for (String n : names) {
  System.out.println(n)
}
```

### 其他包

| 包 | 文件 | 内容 |
|---|---|---|
| `java.time` | `lib/20` | `LocalDate`／`LocalTime`／`LocalDateTime`／`Instant`／`Duration`／`Period`／`DayOfWeek`／`Month`；历法算在 epoch day 上，输出与 JDK 逐字节相同（没有时区，`now()` 读 UTC） |
| `java.io` | `lib/16` | `File`、`Path`／`Paths`、`Files`（`readString`／`writeString`／`readAllLines`／`exists`／`createDirectories`／`listFiles`） |
| `java.util.regex` | `lib/21` | `Pattern`／`Matcher`：回溯式匹配，支持字面量、`.`、`*`／`+`／`?`／`{n,m}` 及其惰性形式、字符类、`\d`／`\w`／`\s`、`^`／`$`、`|`、捕获与非捕获组、`replaceAll`／`replaceFirst`／`split`（含 `limit` 的三种正负号）；不支持的语法（占有量词、环视、反向引用、`\p{...}`）在 `compile` 就被拒绝。`String.matches`／`replaceAll`／`replaceFirst`／`split` 就是这五个方法，不是另一套实现 |
| `java.net` | `lib/15` | `ServerSocket`、`Socket`、`SocketInputStream`／`SocketOutputStream`；同步阻塞的 POSIX socket，超时通过 `SocketTimeoutException` 报告 |
| `java.util.stream` | `lib/22` | `Stream`／`IntStream`／`LongStream`／`DoubleStream`、`Collectors`（26 个工厂）、`Collector`、`Spliterator`／`Spliterators`、`StreamSupport`、统计与 `OptionalInt` 家族；中间操作构建流水线、终端操作才拉取，`Collection.stream()` 是入口 |
| `java.math` | `lib/23` | `BigInteger`（base-2^30 limb、符号与大小）、`BigDecimal`（unscaled value 与 scale）、`MathContext`、`RoundingMode`；算法照 JDK 翻译，因为小数位数、除法留下的 scale、舍入方式都是可观察的 |
| `java.text` | `lib/24` | `NumberFormat`／`DecimalFormat`／`DecimalFormatSymbols`（完整的 pattern 语言）、`DateFormat`／`SimpleDateFormat`（四种 style 与 parse）、`DateTimeFormatter`、`MessageFormat`、`ChoiceFormat`、`ParseException`／`ParsePosition`。**没有 `Locale`**（只做 ROOT／en-US），**没有 `java.util.Date`**（`format`／`parse` 经由 `Instant`），`format` 没有 `FieldPosition` 重载 |
| `java.util` 其余 | `lib/25` | `Properties`、`Random`（逐字节照 java.util.Random）、`UUID`、`BitSet`、`StringTokenizer`、`Enumeration`、`ArrayOps`（数组的范围形式） |
| `com.google.gson` | `lib/10`、`lib/19` | Gson 的树形 API，以及由编译器生成的对象绑定（见 [docs/json.md](/zh-CN/docs/json)） |
| 框架 | `lib/17`、`lib/18` | Spring 形状的容器与 web 层（见 [docs/framework.md](/zh-CN/docs/framework)） |

### 名称怎么找

简单名称照 JLS 6.5.5：先看单类型导入（它覆盖同名的包成员），再看文件自己的
包，再看按需导入，最后才看程序整体的名字（默认包与前缀）。两个
`import p.*` 都提供同一个名字时是 `TY-TYP-0099`，不会照声明顺序挑一个。

**导入本身会被检查**（`TY-TYP-0115`）：一条 `import` 必须指向标准库回应的包
（`teyru`，以及兼容用的 `java.util`、`com.google.gson`、`lombok`…，见上一节的
包表）、本次构建中某个文件声明的包，或者全限定名就是该路径的类型。名字在
Teyru 是按**简单名称**找的，前面写什么包都一样，所以 `import java.utli.List`
曾经是静默忽略、然后照样拿到 `List`；现在它是错误。模块导入
（`example.com/dep/pkg`）由构建系统解析，不在本检查范围内。

**单类型导入与按需导入（`import p.*`）都可以。** 导入写的是包**声明的
名字**：在模块构建里，一个包的 identity 是它目录的 import path
（`package todo` 在 `example.com/app` 里是 `example.com/app/todo`），而 import 写的
是 `todo`——两种写法都查得到。`import p.*` 提供该包的所有公开名称，标准库回应的
那些包名（`java.util.*`、`com.google.gson.*`、`lombok.*`…）也和单类型导入一样
指向标准库本身；两个按需导入都提供同一个名字时是 `TY-TYP-0099`。文件
**自己声明**的类型优先于按需导入（JLS 6.5.5.1），所以 `import teyru.*` 旁边
写一个 `class Node` 不会被标准库的 `Node` 覆盖。

本项目自己的 Teyru 代码一律用按需形式：一个包一行。静态导入同理，
`import static java.lang.Math.max` 写成 `import static java.lang.Math.*`。

前缀的名字是全局的——这正是 `List`、`String` 不加 import 就能用的原因——但
**具名包看不到默认包**（JLS 7.4.2）。所以用户在默认包声明 `class Node`
不会破坏标准库自己声明的 `Node`；反过来，在 `package teyru` 里声明一个前缀已经
有的名字是 `TY-TYP-0001` 重复声明，因为两者的全限定名相同。

### 没有的东西

反射、线程、`java.util.concurrent`、时区数据库、`Scanner`。这些缺失都是刻意的：它们要么需要运行时反射，要么需要一份比整个语言还大
的数据表（时区），要么需要语言本身没有的东西（线程），要么——`Scanner` 就是——
只做一半会比不做更糟。

需要自己的原生库时，`native` 方法可以用 C 实现，见
[docs/native.md](/zh-CN/docs/native)。

## 12. 与 Java 的差异

1. **没有分号**（`TY-SYN-0001`）。
2. `for` 头部用冒号：`for (init : condition : update)`。
3. try-with-resources 以换行分隔资源。
4. enum 常量区与成员区用一个冒号分隔。
5. **原生 property**：字段加 accessor 块；`field` 代表底层存储。
6. **`val`**：推断类型的不可重新绑定局部变量。
7. 捕获的局部变量不要求 effectively final。
8. 没有 annotation processor、没有注解（annotation）的运行时反射、没有 JNI。
9. 泛型与 checked exception 的规则同 Java，但没有 checked 检查。
10. 类型实参推断比 javac 弱一层，靠目标类型而不是完整的约束求解（没有 JLS 18）：
    - lambda 的类型实参会**从主体反推**：目标是 `Fn<String, ? extends R>` 而主体是
      `s -> s.length()` 时 `R` 定为 `Integer`。反过来不行——主体本身是一个需要目标
      类型的泛型调用时，两边互相依赖，单向代入停在那里：
      `words.stream().flatMap(w -> Stream.of(w.split(" ")))` 要先把
      `Function<String, Stream<String>>` 写出来。
    - 实参如果只有唯一一个候选方法，会拿该参数的类型当目标——所以嵌套的泛型调用
      可以推断出来。
    - **带自由类型变量的泛型调用，当它是链式调用的接收者时，拿不到目标类型**：
      `xs.sort(naturalOrder())` 要写出类型见证（`Comparator.<String>naturalOrder()`）；
      `comparing(...).thenComparing(...)` 则是连见证都不生效，只能先放进一个有声明
      类型的变量（`Comparator<String> c = comparing(...)` 之后 `c.thenComparing(...)`）。
      javac 对这两种写法都可以。
    - 显式见证属于它自己的调用：`pair(f, Builder.<Integer>make())` 的外层见证不会被
      内层覆盖。
11. **没有捕获转换**：`List<? extends Number>` 在这里就是 `List<Number>`。Java 靠捕获
    挡下的写入（对 `? extends` 的容器 `add`）这里挡不住；反过来看，Java 靠捕获才
    能编译通过的读取（`list.get(0).doubleValue()`）这里直接可行。

## 13. 尚未实现

- checked exception 的编译期检查（`throws` 只被解析）
- `sealed` 的 `permits` 子句没有被验证：没有 `permits` 的 sealed 类型在
  switch 穷尽性上被视为不可判定而要求 `default`；switch **语句**的穷尽性
  仍从宽
- 线程（文件与网络 I/O 有，见 `java.io`／`java.net`）
- 反射缺的部分：注解反射、泛型类型参数的反射、每个元素类型的数组类
  （所有数组共用一个类）、原生类型取值器的 Java 拓宽（对 `byte` 字段调用
  `getInt` 在 Java 会过，这里是 `IllegalArgumentException`）
- 与 Java 生态互通（JAR、JDK 类库、JNI）
- 标识符中的 Unicode 转义（`\u0041` 不能拼出标识符）
- 泛型构造函数的显式类型实参 `new <T>Foo(...)`
- 文本块的缩进细则（目前实现最小缩进去除）
- 注解的运行时保留与读取（`java.lang.annotation` 不存在；Lombok 的 `@onX`
  只把注解复制到生成的成员上，不会有任何运行时效果）
- 模块系统的语义（`import module X` 会被解析后忽略，运行时没有模块系统；`module-info` 不支持）
- 数组的运行时元素类型一律是 `teyru.Array`，所以 `String[].class` 与
  `int[].class` 是同一个对象（Java 是两个）
- 标准库缺失：`Scanner`（见 §11）；`String.format` 的
  `%t`／`%T`（日期时间转换）也未实现，遇到会以 `ty_unimplemented` 停止而不是
  打印出看起来合理的东西
- 无法解析的全限定名（例如 `com.example.Baz.qux(x)`）会报告
  `cannot find symbol com`——消息指向链的第一段而不是整条路径
