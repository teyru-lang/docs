---
title: "Teyru 语言参考"
description: "Teyru 0.2 的语法与语义：源文件与词法、类型、声明、原生 property、语句、泛型、lambda、异常与标准库。"
---

本文档描述 Teyru 0.2 的语法与语义。文档以实现为准：这里写的每一项语言特性都在
`tests/programs/` 有对应的测试，`go test ./...` 会逐项验证；标准库的 API 则只覆盖
一部分——`tests/programs/` 用到哪些就验哪些，没用到的（例如 `Map.putAll`）就没有测试
盯着它，测试覆盖范围仍不完整。

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
- 注解类型（`@interface`）可以声明并使用，也可以反射（见 §11）；`annotation`
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
- **浮点数转整数的窄化转换按 JLS 5.1.3，不是 C 的 `(int)`／`(long)`。** 放不下的值在 C 是
  undefined，所以两个后端都发出运行期调用（`ty_d2i`／`ty_d2l`）：NaN → `0`、`+∞` → 目标
  类型的最大值、`-∞` → 最小值、太大 → 最大值、太小 → 最小值，其余向零截断。目标窄于
  `int`（`byte`／`short`／`char`）时再做第二步——先饱和到 `int` 再截断——与 Java 的两步
  相同，所以 `(byte) 1.0e20` 是 `-1`，不是 `127`。

  ```teyru
  System.out.println((int) Double.NaN)                 // 0
  System.out.println((int) Double.POSITIVE_INFINITY)   // 2147483647
  System.out.println((long) 1.0e20)                    // 9223372036854775807
  System.out.println((long) -1.0e20)                   // -9223372036854775808
  System.out.println((int) 3.99)                       // 3（向零截断）
  System.out.println((byte) 1.0e20)                    // -1
  ```

  这个转换从前是未定义的，而且看得出来：同一个 `(long) 1.0e20` 在四个构建里给出四个答案
  ——C 后端 `-O2` 是 `160`、`-O0` 是 `-9223372036854775808`、`-O3` 是 `0`，LLVM 后端是
  `48`——因为常量折叠把它交给 C 的未定义行为。发出的是有定义的调用之后，常量折叠也跟着
  有定义：四个优化等级与两个后端现在都给出 `9223372036854775807`。端到端测试是
  `tests/programs/t193_narrowing_saturation.teyru`（期望值由 javac 产生，两个后端逐行
  相同）。
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
  `ArithmeticException`、`IndexOutOfBoundsException` 与它的两个子类
  `ArrayIndexOutOfBoundsException`／`StringIndexOutOfBoundsException`、
  `ClassCastException`、`IllegalArgumentException`、`IllegalStateException`、
  `NoSuchElementException`、`NegativeArraySizeException`、`ArrayStoreException`、
  `AssertionError`、`UnsupportedOperationException`。
- **索引超出范围的继承层级与 Java 相同**：`IndexOutOfBoundsException` 是父类，数组索引抛
  `ArrayIndexOutOfBoundsException`，字符串与 `StringBuilder` 的索引或范围抛
  `StringIndexOutOfBoundsException`——两者都在父类下面——容器（`ArrayList` 那一家）
  抛 `IndexOutOfBoundsException` 本身。所以 Java 的惯用写法
  `catch (IndexOutOfBoundsException e)` 在这里能捕获到这三种；每一种的触发时机见
  [docs/diagnostics.md](/zh-CN/docs/diagnostics) 的〈运行期错误〉。
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
`import java.util.List` 照样接受：`java.*` 的名字对到标准库里同名的类，见下面的
“名称怎么找”。**这不等于“Java 源代码不改就能编译”**：分号不是合法 token
（`TY-SYN-0001`，§1），带分号的 Java 源代码要先去掉分号才能编译，语法层的其余差异在
§12、缺的 API 与误报在 §13。分号是否变成可选还没有定案。

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
才写进可执行文件（用到时整份都会带上：同一支 hello world 多一次 `Class.forName` 与
`getDeclaredFields()` 的调用，同一支在 `-O2` 下的可执行文件就从 54.6 KB 变成约 4.6 MB；没用到的程序一行都不带）。与 Java 的差异：类名是 Teyru 的
（`String.class.getName()` 是 `teyru.String`，`forName` 两种名字都收）、注解可以
反射，但元素是**按名字读**（`ann.stringValue("value")`，不是 Java 的
`ann.value()`）、所有数组共用一个类（所以没有 `getComponentType`）、没有泛型类型参数的
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

### 线程与同步（`lib/35`）

线程是**真的操作系统线程**：运行期在 `internal/runtime/src/tyrt_thread.c` 为每条线程
留一条注册记录，收集器在扫描 heap 之前会先停住每一条，再扫各自的栈。

有的东西是 `Thread`（`Thread()`、`Thread(Runnable)`、`Thread(String)`、
`Thread(Runnable, String)`；`start`、`run`、`join`、`isAlive`、`getId`、`getName`、
`setName`，以及 `Thread.sleep(long)`、`Thread.yield()`、`Thread.currentThread()`）与
`Runnable` 接口，还有真正的 `synchronized`（块与**方法修饰符**都有，方法整段持有监视器，
监视器可重入）与 `Object.wait(long)`／`notify`／`notifyAll`。id 在 `Thread` 对象
创建时给定、之后不变，main 线程是 1。

**没有的东西**（没有声明，写了就是找不到符号）：`interrupt`、daemon 线程、线程
优先级、`ThreadGroup`、`ThreadLocal`、超时版的 `join(long)`、`Thread.State`，以及
未处理异常的 handler——运行期打印 Java 默认处理程序那一行，然后结束那条线程，进程继续。

GC 是**合作式**停止世界，这才是真正要知道的限制：安全点在每个循环回边（生成器会放）、
分配慢路径、等 heap 锁，以及每个会阻塞的调用。所以一条既不循环、不分配也不阻塞的
线程（例如卡在原生 `read()` 里）会让收集等它，直到它回来。单线程程序的分配速度不变
（每条线程有自己的分配区）。端到端测试是 `tests/programs/t159_threads.teyru`。

### 并发工具（`lib/37`、`lib/38`）

`java.util.concurrent` 的两块：执行器（`Callable`、`Future`、`FutureTask`、`Executor`、
`ExecutorService`、`ThreadPool`，以及 `Executors` 的 `newFixedThreadPool`／
`newSingleThreadExecutor`／`newCachedThreadPool`）与同步器（`CountDownLatch`、
`AtomicInteger`、`AtomicLong`、`ConcurrentHashMap`），再加上 `ExecutionException`、
`CancellationException`、`RejectedExecutionException`。任务在池里的一条线程上跑，
所以它的栈、分配与监视器都属于那条线程；`submit` 返回的 `Future.get()` 等它做完，
失败的任务以 `ExecutionException` 报告，cause 就是任务抛出的那个 throwable。

**这些全部是监视器，不是 lock-free。** 运行期没有硬件原子操作，所以池的工作队列是
池监视器下的一个 `ArrayDeque`、`AtomicInteger` 是对象的监视器（不是 CAS）、
`ConcurrentHashMap` 是一张哈希表放在一个监视器后面（没有分槽、没有无锁读取路径）。
每一次调用都是原子的、多条线程一起用是安全的，但它不会像 `java.util.concurrent`
那样扩展：四条线程从同一个队列拿任务，就会在那一个监视器上竞争。等待本身是
`Object.wait`，不是轮询；监视器是**每个对象一份**，超时的等待走单调时钟，
`notify`／`notifyAll` 的通知不会丢（通知发生的当下已经在等的线程都会醒过来，
晚到的线程等的是下一次通知）。

**`shutdownNow` 不是 Java 的那一个。** 这门语言没有 `interrupt`，所以它不会——也不能
——打断正在跑的任务：它拒收新工作、把还没开始的任务交回来，已经进到 `run()` 的任务
跑完为止。没有任何方法接收 Java 的 `mayInterruptIfRunning`；一个默默不做事的名义旗标
比没有那个旗标更糟。

**没有的东西**（没有声明，写了就是找不到符号）：`TimeUnit`（这里每个时长都是毫秒，
和 `Thread.sleep` 一样）、`invokeAll`／`invokeAny`、`submit(Runnable)`、调度执行器、
fork/join、`CompletionService`、`ThreadFactory`、`CyclicBarrier`／`Semaphore`／
`Phaser`／`Exchanger`、原子字段更新器，以及可中断的等待（没有
`InterruptedException`）。`ConcurrentHashMap` 不是 `Map`：没有 `clear`／`putAll`／
`keySet`／`values`／`entrySet`，`keys()` 返回的是一份快照 `Enumeration`。

### 时区（`lib/46`）

`java.time.zone` 的那一半，读**主机自己的 IANA 数据库**（TZif 格式）：纯 Teyru，在
`byte[]` 上操作，没有 native、没有新的 C，只用到既有的文件、环境与字符串辅助函数。
`ZoneId`、`ZoneOffset`、`ZoneRules`、`ZoneOffsetTransition`、`ZonedDateTime`，以及
`ZoneRulesException`（`DateTimeException` 的子类）；`ZoneId.getAvailableZoneIds()` 与
`getAvailableIDs()`（后者是排序过的 `String[]`，`java.util.TimeZone` 的形状）、
`systemDefault()`、`ZoneRules.getOffset(instant)`、`ZonedDateTime` 的算术（跨 DST 边界的
`plusDays` 是重点）与 `withZoneSameInstant`／`withZoneSameLocal`，还有重叠与缺口那两组
（`withEarlierOffsetAtOverlap`／`withLaterOffsetAtOverlap`）——少了它们，程序最常弄错的
就是这种日期。

**格式的决定**，每一条都是「对」与「差不多对」的差别：版本字节决定读哪一段，版本 2
以上用头算出第一段的长度并**跳过**它（不是把同样的转换时刻用 32 位再读一次）；
查表是对转换时刻做二分查找；第一个转换之前用第一个非 DST 的类型（RFC 8536 说类型 0、
`tzfile(5)` 说第一个非 DST 类型——这台主机上的文件两者一致，代码写明跟的是后者，因为
那是 C 函数库的读法）；**最后一个转换之后由 footer 的 POSIX 规则字符串决定**——这一段才是
「现在」对的原因，因为多数时区的最后一次转换都在过去（`Asia/Taipei` 是 1979、
`Europe/Moscow` 是 2014、New York 是 2037），停在表格上的读者会永远回答该时区最后一次
改规则之前的规则。footer 那个 POSIX TZ 字符串自己是一个小语法：`Jn`／`n`／`Mm.w.d` 三种
规则、`/time` 是转换前那个偏移下的墙上时间、offset 是 POSIX 的反向（`CST-8` 是
+08:00 以东）；读不下去的会抛 `ZoneRulesException`，消息指名来源（文件路径或 `TZ=...`）
与读不下去的地方。

**刻意没有的东西**：`java.util.TimeZone` 是**决定不做**——这个标准库的日期时间层
整套是 java.time 的，没有 `Date`／`Calendar` 给它服务，而它会被要的三件事
`getAvailableZoneIds`／`systemDefault`／`getOffset` 都在；规则的**对象**那一面
（`ZoneOffsetTransitionRule` 与 `ZoneRules.getTransitionRules`）不需要，因为解析下来的
POSIX 字符串回答同样的问题；`getDisplayName` 需要这个标准库没有的 CLDR 地区数据；
闰秒是**拒绝而不是近似**（`right/` 那类文件的转换时刻是闰秒，忽略校正会在 1972 之后差
27 秒，一个差 27 秒的答案比没有答案糟）；而且**没有内置数据库**，所以没有 tzdata 的主机
（Windows，或没装的容器）拿到的是具名拒绝——`ZoneRulesException`，消息说哪个目录不在、
要装 tzdata 或设 `TZDIR`——而不是一个偏移。只有 UTC／GMT／UT 与 `+08:00` 这类数值 id 是
内置的，因为只需要 UTC 的程序不该需要 tzdata。

**与 Java 不同的地方**：`ZoneId` 实现 `Comparable`（Java 的没有，所以在那一边排时区要自己
给 `Comparator`）；`setSystemDefault`／`setZoneInfoDir`／`getZoneInfoDir`／
`getAbbreviation` 是这个标准库自己的 additions（`getAbbreviation` 回答文件里的
designation，JVM 是通过 formatter 给 CLDR 的名字）；规则**按 id 缓存**而不是共用，所以
`Europe/Kiev` 与 `Europe/Kyiv` 会读两次文件、持有两个相等的对象，而 JVM 的 provider 会
共用一个；id 也照调用者写的原样保留，不做 canonicalize。

`tests/programs/t188_timezone.teyru` 与 javac 21 的输出逐字节相同，
`t189_timezone_lookup.teyru` 是政策那一面（id 清单、各种拒绝、`TZDIR`／`TZ`、默认时区），
`t190_timezone_tzif.teyru` 用自己写的合成文件把「读哪一段」证明出来，而不是宣称。

### TLS（`lib/15`、`lib/18`、`lib/32`）

TLS 是这个标准库唯一**不自己实现**的一层：底下的密码学是 OpenSSL，跑在 POSIX
socket 上。纯 Teyru 的那一半是政策与生命周期——`TlsSocket`（`start(plain, host)`、
`start(plain, host, caFile)` 是客户端，`accept(plain, ctx)` 是服务器端）、提供客户端
context 的 `Tls`（`clientContext(caFile)`）、持有一组证书与私钥的 `TlsServer`，以及
`TlsException`／`TlsCertificateException`（后者的消息带着 OpenSSL 给的理由，因为
「证书不受信任」只答了一半）。`HttpServer.ssl(certificate, privateKey)` 把 PEM 证书链与
其私钥的路径交给服务器——就是 Spring 的 `server.ssl.certificate` 与
`server.ssl.certificate-private-key`——从此它接到的每个连接都是 TLS，`isSecure()`
回答它是不是；那组文件在**配置时**就被读取与检查，所以用不了的证书在配置的地方失败
（程序还说得出哪里错），而不是让每一个进来的客户端失败。HTTP 客户端走 `https://`
时就是同一条路。

**这一层只有碰得到才进可执行文件。** 它是运行期唯一会链接「编译器不附带的函数库」的
部分，所以它自己是一个文件（`internal/runtime/src/tyrt_tls.c`），而「这个程序碰不碰得到
TLS」是由生成出来的 C 决定的：碰得到才编译那个文件、才加 `-lssl -lcrypto`。不用 TLS
的程序因此一个字节都不付——hello world 还是 54.6 KB。要注意这个判断是**可达性**，
不是实际执行：会反射的程序带着一份指名每个类的表格，所以它答「碰得到」，即使它从不
调用 TLS。

**这一层的要求是 OpenSSL 1.1，而且它是一个预处理器的 `#error`**
（`OPENSSL_VERSION_NUMBER < 0x10100000L`）：`SSL_set1_host`、`BIO_meth_new`、
`TLS_client_method` 与 `SSL_CTX_set_min_proto_version` 都不在 1.0.x 里。这件事在编译
时就讲清楚，而不是让使用者在一个他没写过的运行期文件里逐个标识符地读「未声明的标识
符」。**只有 POSIX 有这一层**，其他目标是**具名拒绝**，而且在写出任何输出文件之前：

- `windows/amd64`：mingw-w64 没有 OpenSSL，那个目标没有 TLS 函数库可以链接。
- `darwin/amd64`、`darwin/arm64`：macOS 出的是 SecureTransport，不是 OpenSSL。

被拒绝的是**程序**，不是那个调用：只要可达代码碰得到这一层，那个目标就编不出来，
消息指名目标、原因与可以改用的目标。要点与写法见 [docs/native.md](/zh-CN/docs/native)。

没有任何调用可以把验证关掉：给了 `caFile` 的客户端把该文件的证书当成信任锚，其余用
系统的锚。超时是这一层最容易做错的地方，所以有测试专盯它：
`tests/programs/t163_https_roundtrip.teyru`（服务器与客户端在同一个程序里，证书以路径
给，验证通过与被拒绝各一次，主体逐字节比对）、`t191_tls_keepalive.teyru`（一次 TLS
连接上两个请求）、`t192_tls_handshake_timeout.teyru`（对端完成 TCP 连接后就不说话，
超时必须是 `SocketTimeoutException` 而不是被读成流结束）。

### 其他包

| 包 | 文件 | 内容 |
|---|---|---|
| `java.time` | `lib/20` | `LocalDate`／`LocalTime`／`LocalDateTime`／`Instant`／`Duration`／`Period`／`DayOfWeek`／`Month`；历法算在 epoch day 上；时区在 `lib/46`（见上面〈时区〉），而 `LocalDate.now()`／`LocalTime.now()`／`LocalDateTime.now()` 仍然把系统时钟读成 UTC——那是这个文件剩下的一处偏差，分区的「现在」是 `ZonedDateTime.now()`。`LocalDate`、`Instant`、`Duration`、`DayOfWeek`／`Month` 的输出与 JDK 逐字节相同；四处不同：年份不补零也不加正号（`1-01-01`、`10000-01-01`，JDK 是 `0001-01-01`、`+10000-01-01`）、`LocalTime` 的 `plus*`／`minus*` 清掉纳秒（`00:00:00.000000001` 加一小时是 `01:00`）、`LocalDateTime` 的 `plusHours`／`plusMinutes`／`plusSeconds` 不跨日（`1899-01-01T23:00` 加 25 小时是 `1899-01-01T00:00`）、`Period.between` 与 `addTo`／`subtractFrom` 的算法与 JDK 不同（`2000-03-31` 到 `2000-04-30` 是 `P1M`，JDK 是 `P30D`） |
| `java.io` | `lib/16` | `File`（`listFiles`）、`Path`／`Paths`、`Files`（`readString`／`writeString`／`readAllLines`／`exists`／`createDirectories`） |
| `java.util.regex` | `lib/21` | `Pattern`／`Matcher`：回溯式匹配，支持字面量、`.`、`*`／`+`／`?`／`{n,m}` 及其惰性形式、字符类、`\d`／`\w`／`\s`、`^`／`$`、`|`、捕获与非捕获组、`replaceAll`／`replaceFirst`／`split`（含 `limit` 的三种正负号）；不支持的语法（占有量词、环视、反向引用、`\p{...}`）在 `compile` 就被拒绝。`String.matches`／`replaceAll`／`replaceFirst`／`split` 就是这五个方法，不是另一套实现 |
| `java.net` | `lib/15` | `ServerSocket`、`Socket`、`SocketInputStream`／`SocketOutputStream`；同步阻塞的 POSIX socket，超时通过 `SocketTimeoutException` 报告；TLS 是同一条路上的一层（`TlsSocket`／`Tls`／`TlsServer`／`TlsException`，见上面〈TLS〉） |
| `java.util.Base64` | `lib/25` | 编码（`encodeToString`）；没有解码 |
| `java.util.stream` | `lib/22` | `Stream`／`IntStream`／`LongStream`／`DoubleStream`、`Collectors`（26 个工厂）、`Collector`、`Spliterator`／`Spliterators`、`StreamSupport`、统计与 `OptionalInt` 家族；中间操作构建流水线、终端操作才拉取，`Collection.stream()` 是入口 |
| `java.math` | `lib/23` | `BigInteger`（base-2^30 limb、符号与大小）、`BigDecimal`（unscaled value 与 scale）、`MathContext`、`RoundingMode`；算法照 JDK 翻译，因为小数位数、除法留下的 scale、舍入方式都是可观察的 |
| `java.text` | `lib/24` | `NumberFormat`／`DecimalFormat`／`DecimalFormatSymbols`（完整的 pattern 语言）、`DateFormat`／`SimpleDateFormat`（四种 style 与 parse）、`DateTimeFormatter`、`MessageFormat`、`ChoiceFormat`、`ParseException`／`ParsePosition`。**没有 `Locale`**（只做 ROOT／en-US），**没有 `java.util.Date`**（`format`／`parse` 经由 `Instant`），`format` 没有 `FieldPosition` 重载 |
| `java.util` 其余 | `lib/25` | `Properties`、`Random`（逐字节照 java.util.Random）、`UUID`、`BitSet`、`StringTokenizer`、`Enumeration`、`ArrayOps`（数组的范围形式） |
| `java.security`／`java.util.zip` | `lib/40` | `MessageDigest`（`getInstance`、`update`、`digest`、`reset`、`getAlgorithm`、`getDigestLength`、`isEqual`）、`Checksum` 接口与 `CRC32`（Java 把它们放在 `java.util.zip`），以及 `GeneralSecurityException`／`NoSuchAlgorithmException`／`DigestException`。MD5、SHA-1、SHA-224、SHA-256、SHA-384、SHA-512 都在 Teyru 里实现（`tests/programs/t173_digest.teyru`、`t174_crc32.teyru`）；`getInstance` 的名字比较不分大小写，`getAlgorithm` 回报调用者写的那个拼法（JDK 也是如此）。JDK 21 还回应 SHA3-256 那一家族与 SHA-512/256、SHA-512/224，这里的 `getInstance` 对它们抛 `NoSuchAlgorithmException`，而不是安静地给出另一种哈希。`update` 收的是 `byte`（`java.security.MessageDigest` 没有 `update(int)`，那是 `Checksum` 的，`CRC32` 有）；没有 Provider、没有 `getInstance(String, String)`、没有 `clone()`、没有 `update(ByteBuffer)`、没有 `toString()` 覆写 |
| `java.util.HexFormat` | `lib/41` | `of`／`ofDelimiter`、`withDelimiter`／`withPrefix`／`withSuffix`／`withUpperCase`／`withLowerCase`（每个都返回新的实例，原对象不变）、`isUpperCase`／`delimiter`／`prefix`／`suffix`、`formatHex`、`parseHex`、`isHexDigit`／`fromHexDigit` 与两个取位方法，以及六个 `toHexDigits`。没有 `ByteBuffer`／`Appendable` 的重载（这个标准库没有那两个类型），也没有覆写 `toString`／`equals`／`hashCode`（`tests/programs/t175_hexformat.teyru`） |
| `java.io` 数据流 | `lib/42` | `OutputStream`／`Reader`／`Writer` 接口、`ByteArrayInputStream`／`ByteArrayOutputStream`、`DataInputStream`／`DataOutputStream`、`BufferedReader`、`PrintWriter`、`UTFDataFormatException`。`writeUTF`／`readUTF` 用 Java 的 **modified UTF-8**（NUL 是 `C0 80`，BMP 之外的字是代理对的六个字节），长度字段放不下时（65536 字节以上）以 JDK 的消息抛 `UTFDataFormatException`，而且是在写出任何字节**之前**检查，所以失败的调用不会留下半个 frame。`BufferedReader` 的行语法是 Java 的（LF、CRLF、单独的 CR），但它没有自己的缓冲区——它包装的来源本来就整块读。没有序列化、没有文件流（磁盘归 `lib/16`）、没有 `char[]` 的 `Writer` 方法、`DataInputStream` 没有 `read(byte[], int, int)`（阻塞读满是 `readFully` 的契约，不是 Java 那个允许短读的契约）、`SocketOutputStream` 不是 `OutputStream` |
| `java.util.Scanner` | `lib/43` | 只从一个 `String` 读：`hasNext`／`next`、`hasNextInt`／`hasNextLong`／`hasNextDouble` 与对应的 `next*`、`hasNextLine`／`nextLine`，以及 `InputMismatchException`。分隔符是 Java 的 `\p{javaWhitespace}+`，所以 `nextInt()` 之后的 `nextLine()` 拿到的是那一行剩下的部分；数值测试就是解析本身，不是正则表达式。没有 `useDelimiter`、没有基数重载、没有 `nextShort`／`nextFloat`、没有 `hasNext(Pattern)`／`findInLine` 那一家族、没有本地化数字格式，也没有从数据流构造的构造函数 |
| `java.util.zip` | `lib/44` | `Deflater`／`Inflater`（level 0–9，`-1` 是 6；`nowrap` 选 raw deflate 或 zlib 包装；`deflate(..., flush)` 收 `NO_FLUSH`／`SYNC_FLUSH`／`FULL_FLUSH`）、`Adler32`、`GZIPOutputStream`／`GZIPInputStream`、`ZipException`／`DataFormatException`；RFC 1951 与 RFC 1952 都以 Teyru 编写，stored、固定 Huffman 与动态 Huffman 三种 block 都有。**level 0 的输出与 zlib 逐字节相同**（在输出数组放得下一整个 block 的调用方式下）；level 0 以上刻意不同，比对器是自己的。解码端认得 JDK／zlib 在 level 0、1、6、9 的输出，raw 与包装都认、大小从 0 到 65536（`tests/programs/t177_deflate.teyru`），也认 JDK 的 gzip 输出含两个成员串接（`t178_gzip.teyru`）；Adler-32 对不上抛 `DataFormatException("incorrect data check")`，gzip trailer 对不上抛 `ZipException("Corrupt GZIP trailer")`。level 4／5 的链长与 zlib 不同，是量出来的选择：zlib 的 level 4 在本项目自己的源码上比它的 level 3 **更差**（337,376 对 328,737 字节），所以 level 4 用跟 level 3 一样长的链再加上第二次搜索（322,147），level 5 的链拉到 64 以维持在上（311,012）。内存约 600 KiB，比 zlib 默认的 256 KiB 多。**它比 zlib 大也比 zlib 慢**：在本项目自己的 `lib/*.teyru`（1,296,178 字节）上跑 level 6，输出比 JDK 的 `Deflater` 大 1.45%（307,048 对 302,659 字节），慢 2.83 倍（92.9 ms 对 32.81 ms；同一台机器、暖机后取 5 次最佳、只计 deflate 本身、两边都把 `Deflater` 构造算在内）。**没有的**：`DeflaterOutputStream`／`InflaterInputStream`／`CheckedOutputStream`／`CheckedInputStream`、`getLevel`／`getBytesRead`／`getBytesWritten`；`setStrategy` 只认 `DEFAULT_STRATEGY`／`FILTERED`／`HUFFMAN_ONLY`，`Z_FIXED` 在拒绝之列；来源不是 `ByteArrayInputStream` 时 `GZIPInputStream` 一个字节一个字节读（这个标准库的 `InputStream` 只有 `read()`），socket 因此一次调用换一个字节 |
| `java.util.zip` 归档 | `lib/45` | `ZipEntry`、`ZipOutputStream`（STORED 与 DEFLATED、`putNextEntry`／`write`／`closeEntry`／`finish`、central directory 与 end record）、`ZipInputStream`（`getNextEntry`／`read`）、`ZipFile`（路径、`File` 或字节数组；`entries()`／`getEntry`／`getInputStream`／`size()`）。格式决定照 JDK：调用者给了大小与 CRC-32（DEFLATED 还要自己设过压缩后大小，那是 JDK 的 `csizeSet` 规则）就写进 local header，否则设 general purpose bit 3、数据后面接 16 字节的 data descriptor；STORED 没有这个选项——读者得先知道数据在哪里结束——所以大小是必填，缺了以 JDK 的消息拒绝，加密则两个读取端都以 JDK 的消息拒绝。名字一律是 UTF-8 并设 bit 11，没设也照 UTF-8 读，而且没有 `Charset` 参数：Teyru 字符串本身就是它的 UTF-8 字节。**ZIP64 是拒绝而不是写一半**：装不进 32 位字段的值抛 `ZipException` 指名那个字段，读到 `0xFFFFFFFF`／`0xFFFF` 这些魔术值就说这里没有 ZIP64；extra field 原样带过不解释，所以不合成 extended timestamp，`getTime()` 一律回答 MS-DOS 字段。两个读取端都会在数据读完时检查 CRC-32、大小与压缩后大小——**JDK 的 `ZipFile` 不会**，这是本文件刻意与 JDK 不同的唯一一处，方向是宁可抛异常。`getInputStream` 返回具体的 `ZipEntryStream` 而不是 `InputStream`，因为这个标准库的 `InputStream` 只有 `read()`／`readln()`，没有 `read(byte[], int, int)` 可以覆写。时间是格式仅有的 MS-DOS 日期时间，`getTime()`／`setTime()` 走 epoch 毫秒并在 UTC 转换（JDK 用 JVM 的默认时区，所以非 UTC 时差一个偏移）。验证是三方对照：`tests/programs/t185_zip_archive.teyru` 与 `t186_zip_file.teyru` 和 JDK 双向往返，另外 Teyru 写出来的归档用 Info-ZIP 的 `unzip` 读过（两个项目列出、内容逐字节抽出、`unzip -t` 无误） |
| `java.util.concurrent` | `lib/37`、`lib/38` | 执行器与同步器两块——见上面〈并发工具〉 |
| `com.google.gson` | `lib/10`、`lib/19` | Gson 的树形 API，以及运行期读取类字段的对象绑定（见 [docs/json.md](/zh-CN/docs/json)） |
| 框架 | `lib/17`、`lib/18`、`lib/30`、`lib/33`、`lib/34`、`lib/36` | Spring 形状的容器与 web 层：`SpringApplication.run`、`application.properties` 与 `@ConfigurationProperties`／`@Profile`、`@ControllerAdvice`／`@ExceptionHandler`、`HandlerInterceptor`、静态文件、CORS、`ResponseEntity`、`MockServer`，HTTP/1.1 的 keep-alive、chunked、Cookie、HEAD／OPTIONS，WebSocket（`WebSocketHandler`／`WebSocketSession` + `server.addWebSocket`），会话（`HttpSession`／`Sessions`，含超时），上传（`MultipartFile`），响应压缩（`HttpResponse.gzipBody`，用 `lib/44` 的 gzip），验证（`Validation`／`ValidationException`），以及可以放到线程上的接收循环（`ServerTask`）——见 [docs/framework.md](/zh-CN/docs/framework) |

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

**这份清单现在是空的。** 标准库的缺口都写在它们所属的地方——上面每个包那一行或
那一节自己写出它少了什么——而且每个「没有」都是决定，不是还没做：`MessageDigest` 没有
SHA-3 是因为 `getInstance` 宁可抛 `NoSuchAlgorithmException`，也不要给出一个不是调用者
指名的那种哈希；`shutdownNow` 不能打断任务是因为这门语言没有 `interrupt`；闰秒被拒绝
是因为差 27 秒的答案比没有答案糟；`java.util.TimeZone` 没做是因为这个标准库没有
`Date` 与 `Calendar` 给它服务。

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
8. 没有 annotation processor、没有 JNI。注解可以反射，但有一个差别：元素是
   **按名字读**（`ann.stringValue("value")`），不是 Java 的 `ann.value()`；值为
   数组的元素不携带。
9. 泛型与 checked exception 的规则同 Java，但没有 checked 检查。
10. 类型实参推断比 javac 弱一层，靠目标类型而不是完整的约束求解（没有 JLS 18）：
    - lambda 的类型实参会**从主体反推**：目标是 `Fn<String, ? extends R>` 而主体是
      `s -> s.length()` 时 `R` 定为 `Integer`。反过来不行——主体本身是一个需要目标
      类型的泛型调用时，两边互相依赖，单向代入停在那里：
      `words.stream().flatMap(w -> Stream.of(w.split(" ")))` 单独写得出来，接上
      `.collect(...)` 之后 `collect` 就拿不到元素类型，要先把
      `Function<String, Stream<String>>` 写出来。
    - 实参如果只有唯一一个候选方法，会拿该参数的类型当目标——所以嵌套的泛型调用
      可以推断出来。
    - **带自由类型变量的泛型调用，当它是链式调用的接收者时，拿不到目标类型**：
      `xs.sort(naturalOrder())` 要写出类型见证（`Comparator.<String>naturalOrder()`）；
      `comparing(...).thenComparing(...)` 同样拿不到目标类型，见证要把该调用的类型变量
      写齐才生效（`Comparator.<String,Integer>comparing(...)`），否则只能先放进一个有
      声明类型的变量（`Comparator<String> c = comparing(...)` 之后 `c.thenComparing(...)`）。
      javac 对这两种写法都可以。
    - 显式见证属于它自己的调用：`pair(f, Builder.<Integer>make())` 的外层见证不会被
      内层覆盖。
11. **没有捕获转换**：`List<? extends Number>` 在这里就是 `List<Number>`。Java 靠捕获
    挡下的写入（对 `? extends` 的容器 `add`）这里挡不住；读取则没有差别
    （`list.get(0).doubleValue()` javac 也收，不是捕获转换挡的）。

## 13. 尚未实现

- checked exception 的编译期检查（`throws` 只被解析）
- `sealed` 的 `permits` 子句没有被验证：没有 `permits` 的 sealed 类型在
  switch 穷尽性上被视为不可判定而要求 `default`；switch **语句**的穷尽性
  仍从宽
- 线程只有一部分（`Thread`、`Runnable`、`synchronized` 与 `wait`／`notify` 已有，
  见 §11 的〈线程与同步〉）：`interrupt`、daemon、优先级、`ThreadGroup`、
  `ThreadLocal`、`join(long)`、`Thread.State` 没有；GC 是合作式停止世界，一条既不
  循环、不分配也不阻塞的线程会让收集等它
- 反射缺的部分：泛型类型参数的反射、每个元素类型的数组类
  （所有数组共用一个类）、原生类型取值器的 Java 拓宽（对 `byte` 字段调用
  `getInt` 在 Java 会过，这里是 `IllegalArgumentException`）
- 与 Java 生态互通（JAR、JDK 类库、JNI）
- 标识符中的 Unicode 转义（`\u0041` 不能拼出标识符）
- 泛型构造函数的显式类型实参 `new <T>Foo(...)`
- 文本块的缩进细则（目前实现最小缩进去除）
- `java.lang.annotation` 包（注解反射本身有，见 §11）：`@Retention` 收得下但没有
  作用；Lombok 的 `@onX` 只把注解复制到生成的成员上，不会有任何运行时效果
- 模块系统的语义（`import module X` 会被解析后忽略，运行时没有模块系统；`module-info` 不支持）
- 数组的运行时元素类型一律是 `teyru.Array`，所以 `String[].class` 与
  `int[].class` 是同一个对象（Java 是两个）
- **Java 源代码相容的已知缺口**（`javac` 收、这里拒绝，都是实测）：`String.codePointAt`／
  `codePointCount`／`offsetByCodePoints` 不存在（`TY-TYP-0076` 找不到方法）、
  `new String(char[])` 与 `new String(char[], int, int)` 不存在（`TY-TYP-0072` 找不到
  构造函数）、每条分支（含 `default`）都 `return` 却以 `switch` 结尾的方法被误报
  `TY-TYP-0020` missing return；分号见 §12 第 1 条
- 标准库缺口：`String.format` 的 `%t`／`%T`（日期时间转换）未实现，遇到会以
  `ty_unimplemented` 停止而不是打印出看起来合理的东西；其余缺口写在 §11 的包表与
  〈并发工具〉（`Scanner` 只读一个 `String`、`MessageDigest` 没有 SHA-3 与
  SHA-512/256、`java.util.concurrent` 只有执行器与四个同步器、闰秒没有、没有 tzdata 的主机上时区是具名拒绝）
- 无法解析的全限定名（例如 `com.example.Baz.qux(x)`）会报告
  `cannot find symbol com`——消息指向链的第一段而不是整条路径
