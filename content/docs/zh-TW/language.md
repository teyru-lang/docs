---
title: "Teyru 語言參考"
description: "Teyru 0.4 的語法與語意：原始檔與詞法、型別、宣告、原生 property、陳述式、泛型、lambda、例外與標準程式庫。"
---

本文件描述 Teyru 0.4 的語法與語意。文件以實作為準：這裡寫的每一項語言特性都在
`tests/programs/` 有對應的測試，`go test ./...` 會逐項驗證；標準程式庫的 API 則只涵蓋
一部分——`tests/programs/` 用到哪些就驗哪些，沒用到的（例如 `Map.putAll`）就沒有測試在
盯著它，測試涵蓋範圍仍不完整。

- [1. 原始檔與詞法](#1-原始檔與詞法)
- [2. 換行與敘述終止](#2-換行與敘述終止)
- [3. 型別](#3-型別)
- [4. 宣告](#4-宣告)
- [5. 原生 property](#5-原生-property)
- [6. 陳述式](#6-陳述式)
- [7. 運算式](#7-運算式)
- [8. 泛型](#8-泛型)
- [9. lambda 與方法參照](#9-lambda-與方法參照)
- [10. 例外](#10-例外)
- [11. 標準程式庫](#11-標準程式庫)
- [12. 與 Java 的差異](#12-與-java-的差異)
- [13. 尚未實作](#13-尚未實作)

---

## 1. 原始檔與詞法

- 原始檔是 UTF-8，副檔名 `.teyru`。開頭的 BOM 會被忽略。
- 註解：`//` 行註解、`/* ... */` 區塊註解（可跨行）。
- 識別字：字母、`_`、`$` 或非 ASCII 字母開頭，其後可接數字。
- 關鍵字與 Java 相同的一組（`class`、`interface`、`enum`、`record`、`new`、`switch`…），
  另有 `var` 與 `val`（見 §3.4）。
- 字面值：整數（十進位、`0x`、`0b`、`0` 開頭八進位、`_` 分隔、`L` 後綴）、
  浮點（`f`／`d` 後綴、指數）、`char`、`String`、text block `"""…"""`、
  `true`／`false`／`null`。
- 跳脫序列：`\n \t \r \b \f \s \0-7 \uXXXX` 與 `\\ \' \"`；`\<換行>` 續行在一般字串
  與 text block 都適用。這份清單以外的跳脫序列是錯誤，會得到 `TY-SYN-0011`
  （`\q` 不是 `q`）。

**分號是可選的。** 敘述以換行結束，分號會被編譯器**忽略**（W7 之後；`TY-SYN-0001` 已經不再
由這裡產生），所以一份寫著分號的 `.teyru` 或未修改的 `.java` 都編得過。字串、字元、註解與
text block 內的分號照舊是資料。

## 2. 換行與敘述終止

詞法分析器不產生 NEWLINE token：每個 token 只記錄「前面是否有換行」。
剖析器在兩個條件同時成立時把換行當成敘述結束：

1. **換行在此處顯著**：在小括號、中括號與引數列表內不顯著
   （`f(a,\n b)` 合法）；在區塊層級、類別成員層級顯著。
2. **前綴已完整**：下列情況即使有換行也不算結束——
   - 運算式以運算子、逗號、`.`、`::`、`->`、`?`、`:` 結尾；
   - 下一行以 `.` 或 `::` 開頭（方法鏈）；
   - 分隔符尚未關閉。

實作上由 `parser.continues()` 決定；下一行以 `+ - ! ~ ( [ { @ <` 開頭時**不**延續，
避免「下一行是新敘述」與「上一行還沒寫完」混淆。

特殊情況：

- `return` 後直接換行＝無值回傳；要回傳值，運算式必須從同一行開始，
  或用 `return (` 讓它跨行。
- `throw` 同理：運算式沒接在同一行就是 `TY-SYN-0003`。`yield` 也拿不到下一行的值，
  但它是被當成識別字，訊息因此是 `cannot find symbol yield`。
- `++`／`--` 不跨行附著：後綴運算子必須與運算元同行。
- 不能在行末用 `;` 塞多個敘述，請分行。
- `do { … } while (c)` 之後不加分號。

## 3. 型別

### 3.1 原生型別

`boolean byte short char int long float double void`，與 Java 相同的大小與範圍。

### 3.2 參考型別

類別、介面、enum、record、陣列、型別變數。`Object` 是所有類別的根，
`null` 可指派給任何參考型別。

### 3.3 陣列

`T[]`、`T[][]`、`new int[10]`、`new int[2][3]`（會建立內層陣列）、
`new String[]{"a","b"}`、`{1,2,3}` 初始化列表。陣列有 `length` 欄位與
`clone()` 方法；元素存取會做邊界檢查（讀取與寫入都是，null 陣列先丟
`NullPointerException` 再檢查邊界，順序與 Java 相同）。

陣列是共變的（`Object[] o = new String[2]` 合法），但建立時就記下元素型別，
所以透過較寬的視角寫入不符合的值會丟 `ArrayStoreException`：

```teyru
Object[] o = new String[2]
o[0] = "hello"
o[0] = Integer.valueOf(5)   // ArrayStoreException
```

### 3.4 `var` 與 `val`

```teyru
var n = 10        // int，可重新指派
val name = "ada"  // String，不可重新指派
```

- 兩者都只能用在區域變數（含增強 `for` 的變數與 try-with-resources），
  不可用於欄位、參數或回傳型別。
- 一定需要初始值；`null` 推斷不出型別；lambda 需要目標型別。
- `val` 是「不可重新綁定」，不是深度不可變。
- 欄位與參數一律要寫出型別。

## 4. 宣告

### 4.1 類別、介面、enum、record

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

  :  // 常數區與成員區的分隔冒號
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

- 修飾符：`public protected private static final abstract native synchronized
  transient volatile strictfp sealed non-sealed default`。
- 巢狀類別、內部類別（有外層實例）、區域類別、匿名類別都支援。
- `enum` 的常數區與成員區之間用**一個冒號**分隔；沒有成員時省略冒號；
  沒有常數但有成員時以冒號開頭。
- `record` 自動產生私有 final 欄位、accessor、`toString`、`hashCode`、`equals`
  與標準建構子；也可寫精簡建構子（compact constructor）補驗證。
- annotation 型別（`@interface`）可以宣告並使用，也可以反射（見 §11）；`annotation`
  不是關鍵字。

### 4.2 欄位與方法

```teyru
class Counter {
  private int count          // 一般 Java 欄位
  public static final int MAX = 100
  public int step = 1        // 有初始值的欄位

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

- 靜態與實例初始化區塊：`static { … }` 與 `{ … }`。
- 建構子可以多載；`this(...)`／`super(...)` 只能寫在建構子裡，但**不必是**第一句——
  `super()` 之前的敘述會先執行（JEP 513，Java 25 的彈性建構子主體），實際輸出與
  javac 25 相同。
- 可變參數：`void log(String fmt, Object... args)`。
- 抽象方法只能在抽象類別或介面中；介面方法有 body 時必須是
  `default`、`static` 或 `private`。

## 5. 原生 property

欄位宣告後面接 accessor 區塊就成為 property：

```teyru
class Person {
  public String name        // 普通欄位
  private int age
  public int years {        // property
    get {
      return field          // field = 底層儲存
    }
    set {
      field = value < 0 ? 0 : value
    }
  }
  public String label {     // 只有 getter 的計算 property
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

規則：

| 主題 | 行為 |
|---|---|
| 儲存 | 有初始值、有預設 accessor、有 setter，或 accessor 內用到 `field` 時才需要儲存；否則為計算 property，且不能用 `final`／`volatile`／`transient`。 |
| `field` | 只在該 property 的 accessor 內代表底層儲存；其他地方的 `field` 還是一般識別字。 |
| 可見性 | property 的修飾符是 accessor 的預設可見性；底層儲存一律 `private`。 |
| 存取 | `p.years` 讀取呼叫 getter，`p.years = v` 呼叫 setter，`p.years += 1` 先 getter 再 setter。只有屬性宣告上的初始值直接寫入儲存；建構子與初始化區塊裡的指派跟其他地方一樣會呼叫 setter。 |
| 命名 | JavaBeans：getter `getX`（`boolean` 可用 `isX`），setter `setX`。也可以直接呼叫 `p.getYears()`。 |
| 繼承 | accessor 參與覆寫、可視性與泛型代換，與一般方法相同。 |
| `final` | `final` property 不能有 setter。 |
| 靜態 | `static` property 的 accessor 也是靜態。 |

## 6. 陳述式

### 6.1 基本 for 使用冒號

```teyru
for (int i = 0 : i < 10 : i++) {
  System.out.println(i)
}
for ( : : ) {          // 無窮迴圈
  break
}
```

三段用**兩個頂層冒號**分隔。括號、中括號、大括號內以及三元運算子的 `:`
不會被當成分隔符，所以 `for (int i = a > b ? 0 : 1 : i < 3 : i++)` 合法。

### 6.2 增強 for

```teyru
for (String s : names) { … }
for (var s : names) { … }
for (int v : new int[]{1,2,3}) { … }
```

支援陣列與 `Iterable`。

### 6.3 try-with-resources

資源以**換行**分隔，不用分號：

```teyru
try (
  Reader r = open("a.txt")
  Writer w = create("b.txt")
) {
  copy(r, w)
}
```

關閉順序是宣告的反序，與 Java 相同。

### 6.4 switch

支援陳述式與運算式、`->` 與 `:` 兩種形式、多標籤、enum、字串、
型別 pattern 與 `when` 守衛：

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

- `:` 形式保有 Java 的 fall-through；`->` 形式不會。
- 同一個 switch 不能混用兩種形式。
- switch **運算式**必須窮盡：沒有 `default` 又沒有涵蓋所有值時是 `TY-TYP-0096`
  編譯錯誤（`int`／`String` 選擇子一律要 `default`；列舉選擇子要列完每一個常數），
  不會產生一個默默算成零值的結果。switch **陳述式**沒有這個要求。

### 6.5 其他

`if`／`else`、`while`、`do…while`（結尾不加分號）、`return`、`break`／`continue`
（可加標籤）、`throw`、`yield`、`assert`、`synchronized (lock) { … }`、
標籤陳述式。

## 7. 運算式

- 完整運算子優先序與 Java 相同：`||` `&&` `|` `^` `&` `==` `!=`
  `< > <= >= instanceof` `<< >> >>>` `+ -` `* / %`，一元、後綴、三元、指派。
- 整數除法與取餘數會檢查除零（丟 `ArithmeticException`）。
- `==` 在參考型別上是**參照相等**，與 Java 相同；`String` 的 `==` 也是參照相等，
  要比內容請用 `equals`。
- 字串串接：`+` 的任一側是 `String` 時就做串接，其他運算元會自動轉成字串
  （`null` 變成 `"null"`）。
- `instanceof` 支援型別 pattern：`if (o instanceof String s) { … }`，以及 record 解構
  pattern：`if (o instanceof Point(int x, int y)) { … }`。
- **原生型別 pattern**（JEP 507）：`if (o instanceof int i)`、`case byte b ->`。
  配對條件是**轉換精確**，規則與 Java 相同，分選擇子的兩種型別：
  - 選擇子是**參考型別**時，只有它的包裝型別剛好等於該原生型別才匹配：
    `Integer(42)` 匹配 `int`，但不匹配 `long`、`double`、`byte`。
  - 選擇子是**原生數值**時，值能精確轉成該型別才匹配：`42` 匹配 `byte`，
    `16777217` 不匹配 `float`（會失真），`16777216` 則匹配。
  `boolean` 只和 `Boolean` 配對，`null` 一律不匹配。
  原生型別 pattern 一定要有變數名稱。

  ```teyru
  String kind = switch (o) {
    case int i when i > 100 -> "large int"
    case int i -> "int " + i
    case double d -> "double " + d
    default -> "other"
  }
  ```
- `Interface.super.method()` 會靜態綁定到該介面的 default 實作：
  `A.super.hello()`；介面必須是當前類別的 super interface。
- cast：數值間做轉換，參考型別間做執行期檢查（失敗丟 `ClassCastException`）。
- **浮點轉整數的窄化轉換照 JLS 5.1.3，不是 C 的 `(int)`／`(long)`。** 放不下的值在 C 是
  undefined，所以兩個後端都發出執行期呼叫（`ty_d2i`／`ty_d2l`）：NaN → `0`、`+∞` → 目標
  型別的最大值、`-∞` → 最小值、太大 → 最大值、太小 → 最小值，其餘往零截斷。目標窄於
  `int`（`byte`／`short`／`char`）時再做第二步——先飽和到 `int` 再截斷——與 Java 的兩步
  相同，所以 `(byte) 1.0e20` 是 `-1`，不是 `127`。

  ```teyru
  System.out.println((int) Double.NaN)                 // 0
  System.out.println((int) Double.POSITIVE_INFINITY)   // 2147483647
  System.out.println((long) 1.0e20)                    // 9223372036854775807
  System.out.println((long) -1.0e20)                   // -9223372036854775808
  System.out.println((int) 3.99)                       // 3（往零截斷）
  System.out.println((byte) 1.0e20)                    // -1
  ```

  這個轉換從前是未定義的，而且看得出來：同一個 `(long) 1.0e20` 在四個建置給出四個答案
  ——C 後端 `-O2` 是 `160`、`-O0` 是 `-9223372036854775808`、`-O3` 是 `0`，LLVM 後端是
  `48`——因為常數摺疊把它交給 C 的未定義行為。發出的是有定義的呼叫之後，常數摺疊也跟著
  有定義：四個最佳化等級與兩個後端現在都給 `9223372036854775807`。端到端測試是
  `tests/programs/t193_narrowing_saturation.teyru`（期望值由 javac 產生，兩個後端逐行
  相同）。
- boxing／unboxing 自動發生，`null` 拆箱會丟 `NullPointerException`。
- 物件初始化列表：`new int[]{…}`、`int[] xs = {1,2,3}`、巢狀 `{{1,2},{3}}`。

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

- 支援型別參數、bound（`<T extends Number>`）、多重 bound（`&`）、
  萬用字元（`?`、`? extends`、`? super`）、泛型方法、diamond `new Box<>("x")`。
- 泛型方法可以由引數推斷型別參數（原生引數會自動 boxing），也可以顯式指定：
  `Main.<String>identity("x")`、`box.<Integer>map(v -> v.length())`。
- **泛型在編譯期抹除**：執行期只知道類別，不會有 `ClassCastException` 之外的
  泛型檢查；`List<String>` 與 `List<Integer>` 在執行期是同一個型別。
- 原生型別不能當型別引數（`Box<int>` 不合法），請用包裝類別。

## 9. lambda 與方法參照

```teyru
interface Fn<R> {
  R apply(int v)
}

Fn<Integer> f = (v) -> v + 1
Fn<Integer> g = v -> v * 2          // 單一無型別參數可省略括號
Fn<Integer> h = (int v) -> {
  return v - 1
}
Fn<Integer> m = Main::twice         // 靜態方法
Fn<String>  c = String::valueOf     // 多載以目標型別決定

interface Maker<T> {
  T make()
}
Maker<Rect> s = Rect::new           // 建構子參照（目標介面需自行宣告）
```

- 目標型別必須是**函式介面**（只有一個抽象方法的介面）。
- lambda 捕獲外部區域變數時，會複製到合成類別的欄位；被捕獲的變數可以
  在 lambda 之後繼續使用，但**寫入的變數不會回寫**（與 Java 相同，
  差別是 Teyru 不要求變數是 effectively final 才能捕獲）。
- 方法參照支援：`Type::staticMethod`、`obj::instanceMethod`、
  `Type::instanceMethod`（未綁定型，第一個參數當受體）、`Type::new`。

## 10. 例外

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
  `ArithmeticException`、`IndexOutOfBoundsException` 與它的兩個子類別
  `ArrayIndexOutOfBoundsException`／`StringIndexOutOfBoundsException`、
  `ClassCastException`、`IllegalArgumentException`、`IllegalStateException`、
  `NoSuchElementException`、`NegativeArraySizeException`、`ArrayStoreException`、
  `AssertionError`、`UnsupportedOperationException`。
- **越界的繼承階層與 Java 相同**：`IndexOutOfBoundsException` 是父類別，陣列索引丟
  `ArrayIndexOutOfBoundsException`，字串與 `StringBuilder` 的索引或範圍丟
  `StringIndexOutOfBoundsException`——兩者都在父類別底下——容器（`ArrayList` 那一家）
  丟 `IndexOutOfBoundsException` 本身。所以 Java 的慣用寫法
  `catch (IndexOutOfBoundsException e)` 在這裡接得到這三種；每一種的觸發時機見
  [docs/diagnostics.md](/docs/diagnostics) 的〈執行期錯誤〉。
- 對 `null` 讀**寫**欄位、呼叫方法、讀寫陣列元素（含取 `length`）都會丟
  `NullPointerException`。
- `catch` 多型別用 `|`；`finally` 一定會執行（含 catch 內再拋出的情況）。
- **沒有 checked exception 檢查**：`throws` 會被剖析但不強制。
- 未捕捉的例外會印出訊息並以狀態 1 結束。

## 11. 標準程式庫

標準程式庫以 **Teyru 本身**撰寫（`lib/*.teyru`），每次編譯都與使用者程式一起被
編譯與檢查——它沒有什麼特別的地位，`lib/` 底下的檔案就是用 Teyru 寫的普通程式。
標準程式庫是**一個** Teyru 套件：`teyru`。裡面的類別取 Java 的名字，所以 Teyru
程式碼用一行 on-demand 匯入把它整個帶進來：`import teyru.*`（只用到一個類別時
`import teyru.List` 也一樣）。Java 風格的 `import java.util.*` 與
`import java.util.List` 照樣收：`java.*` 的名字對到標準程式庫裡同名的類別，見下面的
〈名稱怎麼找〉。**W7 之後，未修改的 Java 原始碼在測過的那個子集上編得過**（分號可省、
`.java` 可當輸入、JLS §14.22、常見的泛型推論），但那句話本身沒有範圍——§12（語法層）與
§13（缺的 API 與被誤拒的寫法）就是它的適用範圍，而它們現在不是空的。

### java.lang（`lib/01`–`lib/07`）

`Object`、`Class`、`String`（`format`／`join`／`valueOf`／`compareTo`／
`startsWith`／`replace`／`split`／`strip`／`repeat`…）、`StringBuilder` 與
`StringBuffer`、`Math`（含 `floorDiv`／`floorMod`／`round`／三角函式）、
`System`（`out`／`err`／`currentTimeMillis`／`nanoTime`／`arraycopy`／`getenv`／
`exit`）、`PrintStream`、`InputStream`、`IO`（`println`／`readln`）、
`Number` 與八個包裝類別（`Integer.parseInt`、`Long.toHexString`、`Character.isDigit`
等靜態 API；**不是**完整的一組，缺的見 §12 第 12 條與 §13）、`Throwable` 家族、`Enum`、
`Record`、`Comparable`／`Iterable`／
`Iterator`／`Cloneable`／`AutoCloseable`、`Logger`。

### java.util（`lib/08`、`lib/14_*`）

`Collection`、`List`／`ArrayList`／`LinkedList`、`Set`／`HashSet`／
`LinkedHashSet`／`TreeSet`、`Map`／`HashMap`／`LinkedHashMap`／`TreeMap`（紅黑樹）、
`SortedSet`／`NavigableSet`／`SortedMap`／`NavigableMap`、`Queue`／`Deque`／
`ArrayDeque`、`Iterator`／`ListIterator`、`Arrays`、`Collections`、`Objects`、
`Optional`、`StringJoiner`。

契約照 JDK：`LinkedHashMap` 是插入序、`TreeMap` 是鍵序、`TreeSet` 的
`headSet`／`tailSet`／`subSet` 是**活的視圖**（在範圍內 `add` 會寫進原集合，
範圍外是 `IllegalArgumentException: key out of range`；`TreeMap.keySet()` 的視圖
則照 JDK 一樣拒絕新增）、`computeIfAbsent`／`merge`／`forEach` 都在。
`Stream.of(array)` 會把陣列攤成元素（與 javac 相同的多載：`of(T...)` 比 `of(T)`
更特定）。
`java.lang.reflect`（`lib/26`）提供 `Class`、`Field`、`Method`、`Constructor`、
`Modifier`、`Array` 與六個反射用例外；它們讀的是編譯器為每個類別產生的靜態表，
查一次資料是走一次陣列，執行期不建表。成員表只在程式真的會用到反射時
才寫進執行檔（用到時整份都會帶上：同一支 hello world 多一次 `Class.forName` 與
`getDeclaredFields()` 的呼叫，同一支在 `-O2` 下的執行檔就從 54.6 KB 變成約 4.6 MB；沒用到的一行都不帶）。與 Java 的差異：類別名報告的是 JDK 的
（`String.class.getName()` 是 `java.lang.String`、`Map.Entry` 是 `java.util.Map$Entry`；
`forName` 兩種寫法都收，因為它查的是二元名）、註解可以反射，但元素是**按名字讀**（`ann.stringValue("value")`，不是 Java 的 `ann.value()`）；所有陣列共用一個類別（所以沒有 `getComponentType`）、沒有泛型型別參數的
反射、原生型別取值器只收完全相符的裝箱型別、不檢查存取控制（只有 final 會攔）。
`java.util.function`（`lib/09`）提供 `Function`／`BiFunction`／`Consumer`／
`Supplier`／`Predicate`／`Runnable`／`Comparator`。

```teyru
List<String> names = new ArrayList<String>()
names.add("ada")
for (String n : names) {
  System.out.println(n)
}
```

### 執行緒與同步（`lib/35`）

執行緒是**真的作業系統執行緒**：執行期在 `internal/runtime/src/tyrt_thread.c` 為每一條
執行緒留一筆註冊資料，收集器在掃 heap 之前會先停住每一條，再掃各自的堆疊。

有的東西是 `Thread`（`Thread()`、`Thread(Runnable)`、`Thread(String)`、
`Thread(Runnable, String)`；`start`、`run`、`join`、`isAlive`、`getId`、`getName`、
`setName`，以及 `Thread.sleep(long)`、`Thread.yield()`、`Thread.currentThread()`）與
`Runnable` 介面，還有真正的 `synchronized`（區塊與**方法修飾子**都有，方法整段持有
監視器，監視器可重入）與 `Object.wait(long)`／`notify`／`notifyAll`。id 在 `Thread`
物件建立時就給定、之後不變，main 執行緒是 1。

**沒有的東西**（沒有宣告，寫了就是找不到符號）：`interrupt`、daemon 執行緒、執行緒
優先權、`ThreadGroup`、`ThreadLocal`、逾時版的 `join(long)`、`Thread.State`，以及未
處理例外的 handler——執行期印出 Java 預設處理常式那一行，然後結束那條執行緒，行程繼續。

GC 是**合作式**停止世界，這是真正要知道的限制：安全點在每個迴圈回邊（產生器會放）、
配置慢路徑、等 heap 鎖，以及每個會阻塞的呼叫。所以一條既不迴圈、不配置也不阻塞的
執行緒（例如卡在原生 `read()` 裡）會讓收集等它，直到它回來。單執行緒程式的配置速度
不變（每條執行緒有自己的配置區）。端到端測試是 `tests/programs/t159_threads.teyru`。

### 並行工具（`lib/37`、`lib/38`）

`java.util.concurrent` 的兩塊：執行器（`Callable`、`Future`、`FutureTask`、`Executor`、
`ExecutorService`、`ThreadPool`，以及 `Executors` 的 `newFixedThreadPool`／
`newSingleThreadExecutor`／`newCachedThreadPool`）與同步器（`CountDownLatch`、
`AtomicInteger`、`AtomicLong`、`ConcurrentHashMap`），再加上 `ExecutionException`、
`CancellationException`、`RejectedExecutionException`。任務在池裡的一條執行緒上跑，
所以它的堆疊、配置與監視器都屬於那條執行緒；`submit` 回傳的 `Future.get()` 等它做完，
失敗的任務以 `ExecutionException` 回報，cause 就是任務拋出的那個 throwable。

**這些全部是監視器，不是 lock-free。** 執行期沒有硬體原子操作，所以池的工作佇列是
池監視器下的一個 `ArrayDeque`、`AtomicInteger` 是物件的監視器（不是 CAS）、
`ConcurrentHashMap` 是一張雜湊表放在一個監視器後面（沒有分槽、沒有無鎖讀取路徑）。
每一次呼叫都是原子的、多條執行緒一起用是安全的，但它不會像 `java.util.concurrent`
那樣擴展：四條執行緒從同一個佇列拿任務，就會在那一個監視器上競爭。等待本身是
`Object.wait`，不是輪詢；監視器是**每個物件一份**，逾時的等待走單調時鐘，
`notify`／`notifyAll` 的通知不會掉（通知發生的當下已經在等的執行緒都醒得過來，
晚到的執行緒等的是下一次通知）。

**`shutdownNow` 不是 Java 的那一個。** 這個語言沒有 `interrupt`，所以它不會——也不能
——打斷正在跑的任務：它拒收新工作、把還沒開始的任務交回來，已經進到 `run()` 的任務
跑完為止。沒有任何方法收 Java 的 `mayInterruptIfRunning`；一個默默不做事的名義旗標
比沒有那個旗標更糟。

**沒有的東西**（沒有宣告，寫了就是找不到符號）：`TimeUnit`（這裡每個時長都是毫秒，
和 `Thread.sleep` 一樣）、`invokeAll`／`invokeAny`、`submit(Runnable)`、排程執行器、
fork/join、`CompletionService`、`ThreadFactory`、`CyclicBarrier`／`Semaphore`／
`Phaser`／`Exchanger`、原子欄位更新器，以及可中斷的等待（沒有
`InterruptedException`）。`ConcurrentHashMap` 不是 `Map`：沒有 `clear`／`putAll`／
`keySet`／`values`／`entrySet`，`keys()` 回的是一份快照 `Enumeration`。

### 時區（`lib/46`）

`java.time.zone` 的那一半，讀**主機自己的 IANA 資料庫**（TZif 格式）：純 Teyru，在
`byte[]` 上操作，沒有 native、沒有新的 C，只用到既有的檔案、環境與字串輔助函式。
`ZoneId`、`ZoneOffset`、`ZoneRules`、`ZoneOffsetTransition`、`ZonedDateTime`，以及
`ZoneRulesException`（`DateTimeException` 的子類別）；`ZoneId.getAvailableZoneIds()` 與
`getAvailableIDs()`（後者是排序過的 `String[]`，`java.util.TimeZone` 的形狀）、
`systemDefault()`、`ZoneRules.getOffset(instant)`、`ZonedDateTime` 的算術（跨 DST 邊界的
`plusDays` 是重點）與 `withZoneSameInstant`／`withZoneSameLocal`，還有重疊與缺口那兩組
（`withEarlierOffsetAtOverlap`／`withLaterOffsetAtOverlap`）——少了它們，程式最常弄錯的
就是這種日期。

**格式的決定**，每一條都是「對」與「差不多對」的差別：版本位元組決定讀哪一段，版本 2
以上用標頭算出第一段的長度並**跳過**它（不是把同樣的轉換時刻用 32 位元再讀一次）；
查表是對轉換時刻做二分搜尋；第一個轉換之前用第一個非 DST 的型別（RFC 8536 說型別 0、
`tzfile(5)` 說第一個非 DST 型別——這台主機上的檔案兩者一致，程式碼寫明跟的是後者，因為
那是 C 函式庫的讀法）；**最後一個轉換之後由 footer 的 POSIX 規則字串決定**——這一段才是
「現在」對的原因，因為多數時區的最後一次轉換都在過去（`Asia/Taipei` 是 1979、
`Europe/Moscow` 是 2014、New York 是 2037），停在表格上的讀者會永遠回答該時區最後一次
改規則之前的規則。footer 那個 POSIX TZ 字串自己是一個小語法：`Jn`／`n`／`Mm.w.d` 三種
規則、`/time` 是轉換前那個偏移下的牆上時間、offset 是 POSIX 的反向（`CST-8` 是
+08:00 以東）；讀不下去的會丟 `ZoneRulesException`，訊息指名來源（檔案路徑或 `TZ=...`）
與唸不下去的地方。

**刻意沒有的東西**：`java.util.TimeZone` 是**決定不做**——這個標準程式庫的日期時間層
整套是 java.time 的，沒有 `Date`／`Calendar` 給它服務，而它會被要的三件事
`getAvailableZoneIds`／`systemDefault`／`getOffset` 都在；規則的**物件**那一面
（`ZoneOffsetTransitionRule` 與 `ZoneRules.getTransitionRules`）不需要，因為解析下來的
POSIX 字串回答同樣的問題；`getDisplayName` 需要這個標準程式庫沒有的 CLDR 地區資料；
閏秒是**拒絕而不是近似**（`right/` 那類檔案的轉換時刻是閏秒，忽略校正會在 1972 之後差
27 秒，一個差 27 秒的答案比沒有答案糟）；而且**沒有內建資料庫**，所以沒有 tzdata 的主機
（Windows，或沒裝的容器）拿到的是具名拒絕——`ZoneRulesException`，訊息說哪個目錄不在、
要裝 tzdata 或設 `TZDIR`——而不是一個偏移。只有 UTC／GMT／UT 與 `+08:00` 這類數值 id 是
內建的，因為只需要 UTC 的程式不該需要 tzdata。

**與 Java 不同的地方**：`ZoneId` 實作 `Comparable`（Java 的沒有，所以在那邊排時區要自己
給 `Comparator`）；`setSystemDefault`／`setZoneInfoDir`／`getZoneInfoDir`／
`getAbbreviation` 是這個標準程式庫自己的 additions（`getAbbreviation` 回答檔案裡的
designation，JVM 是透過 formatter 給 CLDR 的名字）；規則**按 id 快取**而不是共用，所以
`Europe/Kiev` 與 `Europe/Kyiv` 會讀兩次檔案、持有兩個相等的物件，而 JVM 的 provider 會
共用一個；id 也照呼叫者寫的原樣保留，不做 canonicalize。

`tests/programs/t188_timezone.teyru` 與 javac 21 的輸出逐位元組相同，
`t189_timezone_lookup.teyru` 是政策那一面（id 清單、各種拒絕、`TZDIR`／`TZ`、預設時區），
`t190_timezone_tzif.teyru` 用自己寫的合成檔案把「讀哪一段」證明出來，而不是宣稱。

### TLS（`lib/15`、`lib/18`、`lib/32`）

TLS 是這個標準程式庫唯一**不自己實作**的一層：底下的密碼學是 OpenSSL，跑在 POSIX
socket 上。純 Teyru 的那一半是政策與生命週期——`TlsSocket`（`start(plain, host)`、
`start(plain, host, caFile)` 是客戶端，`accept(plain, ctx)` 是伺服器端）、提供客戶端
context 的 `Tls`（`clientContext(caFile)`）、持有一組憑證與私鑰的 `TlsServer`，以及
`TlsException`／`TlsCertificateException`（後者的訊息帶著 OpenSSL 給的理由，因為
「憑證不受信任」只答了一半）。`HttpServer.ssl(certificate, privateKey)` 把 PEM 憑證鏈與
其私鑰的路徑交給伺服器——就是 Spring 的 `server.ssl.certificate` 與
`server.ssl.certificate-private-key`——從此它接到的每個連線都是 TLS，`isSecure()`
回答它是不是；那組檔案在**設定時**就被讀取與檢查，所以用不了的憑證在設定的地方失敗
（程式還說得出哪裡錯），而不是讓每一個進來的客戶端失敗。HTTP 客戶端走 `https://`
時就是同一條路。

**這一層只有碰得到才進執行檔。** 它是執行期唯一會連結「編譯器不附帶的函式庫」的部分，
所以它自己是一個檔案（`internal/runtime/src/tyrt_tls.c`），而「這個程式碰不碰得到
TLS」是由產生出來的 C 決定的：碰得到才編譯那個檔案、才加 `-lssl -lcrypto`。不用 TLS
的程式因此一個位元組都不付——hello world 還是 54.6 KB。要注意這個判斷是**可達性**，
不是實際執行：會反射的程式帶著一份指名每個類別的表格，所以它答「碰得到」，即使它從不
呼叫 TLS。

**這一層的要求是 OpenSSL 1.1，而且它是一個前置處理器的 `#error`**
（`OPENSSL_VERSION_NUMBER < 0x10100000L`）：`SSL_set1_host`、`BIO_meth_new`、
`TLS_client_method` 與 `SSL_CTX_set_min_proto_version` 都不在 1.0.x 裡。這件事在編譯
時就講清楚，而不是讓使用者在一個他沒寫過的執行期檔案裡逐個識別字地讀「未宣告的識別
字」。**只有 POSIX 有這一層**，其他目標是**指名拒絕**，而且在寫出任何輸出檔之前：

- `windows/amd64`：mingw-w64 沒有 OpenSSL，那個目標沒有 TLS 函式庫可以連結。
- `darwin/amd64`、`darwin/arm64`：macOS 出的是 SecureTransport，不是 OpenSSL。

被拒絕的是**程式**，不是那個呼叫：只要可達程式碼碰得到這一層，那個目標就編不出來，
訊息指名目標、原因與可以改用的目標。要點與寫法見 [docs/native.md](/docs/native)。

沒有任何呼叫可以把驗證關掉：給了 `caFile` 的客戶端把該檔案的憑證當成信任錨，其餘用
系統的錨。逾時是這一層最容易做錯的地方，所以有測試專盯它：
`tests/programs/t163_https_roundtrip.teyru`（伺服器與客戶端在同一個程式裡，憑證以路徑
給，驗證通過與被拒絕各一次，主體逐位元組比對）、`t191_tls_keepalive.teyru`（一次 TLS
連線上兩個請求）、`t192_tls_handshake_timeout.teyru`（對端完成 TCP 連線後就不說話，
逾時必須是 `SocketTimeoutException` 而不是被讀成串流結束）。

### 其他套件

| 套件 | 檔案 | 內容 |
|---|---|---|
| `java.time` | `lib/20` | `LocalDate`／`LocalTime`／`LocalDateTime`／`Instant`／`Duration`／`Period`／`DayOfWeek`／`Month`；曆法算在 epoch day 上；時區在 `lib/46`（見上面〈時區〉），而 `LocalDate.now()`／`LocalTime.now()`／`LocalDateTime.now()` 仍然把系統時鐘讀成 UTC——那是這個檔案剩下的一處偏差，分區的「現在」是 `ZonedDateTime.now()`。`LocalDate`、`Instant`、`Duration`、`DayOfWeek`／`Month` 的輸出與 JDK 逐位元組相同；四處不同：年份不補零也不加正號（`1-01-01`、`10000-01-01`，JDK 是 `0001-01-01`、`+10000-01-01`）、`LocalTime` 的 `plus*`／`minus*` 清掉奈秒（`00:00:00.000000001` 加一小時是 `01:00`）、`LocalDateTime` 的 `plusHours`／`plusMinutes`／`plusSeconds` 不跨日（`1899-01-01T23:00` 加 25 小時是 `1899-01-01T00:00`）、`Period.between` 與 `addTo`／`subtractFrom` 的算法與 JDK 不同（`2000-03-31` 到 `2000-04-30` 是 `P1M`，JDK 是 `P30D`） |
| `java.io` | `lib/16` | `File`（`listFiles`）、`Path`／`Paths`、`Files`（`readString`／`writeString`／`readAllLines`／`exists`／`createDirectories`） |
| `java.util.regex` | `lib/21` | `Pattern`／`Matcher`：回溯式比對，支援字面值、`.`、`*`／`+`／`?`／`{n,m}` 與其懶惰形式、字元類別、`\d`／`\w`／`\s`、`^`／`$`、`|`、捕獲與非捕獲群組、`replaceAll`／`replaceFirst`／`split`（含 `limit` 的三種正負號）；不支援的語法（佔有量詞、前後視、反向參考、`\p{...}`）在 `compile` 就被拒絕。`String.matches`／`replaceAll`／`replaceFirst`／`split` 就是這五個方法，不是另一套實作 |
| `java.net` | `lib/15` | `ServerSocket`、`Socket`、`SocketInputStream`／`SocketOutputStream`；同步阻塞的 POSIX socket，逾時以 `SocketTimeoutException` 回報；TLS 是同一條路上的一層（`TlsSocket`／`Tls`／`TlsServer`／`TlsException`，見上面〈TLS〉） |
| `java.util.Base64` | `lib/25` | 編碼（`encodeToString`）；沒有解碼 |
| `java.util.stream` | `lib/22` | `Stream`／`IntStream`／`LongStream`／`DoubleStream`、`Collectors`（26 個工廠）、`Collector`、`Spliterator`／`Spliterators`、`StreamSupport`、統計與 `OptionalInt` 家族；中間操作建管線、終端操作才拉，`Collection.stream()` 是入口 |
| `java.math` | `lib/23` | `BigInteger`（base-2^30 limb、符號與大小）、`BigDecimal`（unscaled value 與 scale）、`MathContext`、`RoundingMode`；演算法照 JDK 翻譯，因為小數位數、除法留下的 scale、進位方式都是可觀察的 |
| `java.text` | `lib/24` | `NumberFormat`／`DecimalFormat`／`DecimalFormatSymbols`（完整 pattern 語言）、`DateFormat`／`SimpleDateFormat`（四種 style 與 parse）、`DateTimeFormatter`、`MessageFormat`、`ChoiceFormat`、`ParseException`／`ParsePosition`。**沒有 `Locale`**（只做 ROOT／en-US），**沒有 `java.util.Date`**（`format`／`parse` 走 `Instant`），`format` 沒有 `FieldPosition` 多載 |
| `java.util` 其餘 | `lib/25` | `Properties`、`Random`（逐位元組照 java.util.Random）、`UUID`、`BitSet`、`StringTokenizer`、`Enumeration`、`ArrayOps`（陣列的範圍形式） |
| `java.security`／`java.util.zip` | `lib/40` | `MessageDigest`（`getInstance`、`update`、`digest`、`reset`、`getAlgorithm`、`getDigestLength`、`isEqual`）、`Checksum` 介面與 `CRC32`（Java 把它們放在 `java.util.zip`），以及 `GeneralSecurityException`／`NoSuchAlgorithmException`／`DigestException`。MD5、SHA-1、SHA-224、SHA-256、SHA-384、SHA-512 都在 Teyru 裡實作（`tests/programs/t173_digest.teyru`、`t174_crc32.teyru`）；`getInstance` 的名字比對不分大小寫，`getAlgorithm` 回報呼叫者寫的那個拼法（JDK 也是這樣）。JDK 21 還回答 SHA3-256 那一家族與 SHA-512/256、SHA-512/224，這裡的 `getInstance` 對它們丟 `NoSuchAlgorithmException`，而不是安靜地給另一種雜湊。`update` 收的是 `byte`（`java.security.MessageDigest` 沒有 `update(int)`，那是 `Checksum` 的，`CRC32` 有）；沒有 Provider、沒有 `getInstance(String, String)`、沒有 `clone()`、沒有 `update(ByteBuffer)`、沒有 `toString()` 覆寫 |
| `java.util.HexFormat` | `lib/41` | `of`／`ofDelimiter`、`withDelimiter`／`withPrefix`／`withSuffix`／`withUpperCase`／`withLowerCase`（每個都回傳新的實例，原物件不變）、`isUpperCase`／`delimiter`／`prefix`／`suffix`、`formatHex`、`parseHex`、`isHexDigit`／`fromHexDigit` 與兩個位數取出方法，以及六個 `toHexDigits`。沒有 `ByteBuffer`／`Appendable` 的多載（這個標準程式庫沒有那兩個型別），也沒有覆寫 `toString`／`equals`／`hashCode`（`tests/programs/t175_hexformat.teyru`） |
| `java.io` 資料流 | `lib/42` | `OutputStream`／`Reader`／`Writer` 介面、`ByteArrayInputStream`／`ByteArrayOutputStream`、`DataInputStream`／`DataOutputStream`、`BufferedReader`、`PrintWriter`、`UTFDataFormatException`。`writeUTF`／`readUTF` 用 Java 的 **modified UTF-8**（NUL 是 `C0 80`，BMP 之外的字是代理對的六個位元組），長度欄放不下時（65536 位元組以上）以 JDK 的訊息丟 `UTFDataFormatException`，而且是在寫出任何位元組**之前**檢查，所以失敗的呼叫不會留下半個 frame。`BufferedReader` 的行語法是 Java 的（LF、CRLF、單獨的 CR），但它沒有自己的緩衝區——它包裝的來源本來就整塊讀。沒有序列化、沒有檔案資料流（磁碟歸 `lib/16`）、沒有 `char[]` 的 `Writer` 方法、`DataInputStream` 沒有 `read(byte[], int, int)`（阻塞讀滿是 `readFully` 的契約，不是 Java 那個允許短讀的契約）、`SocketOutputStream` 不是 `OutputStream` |
| `java.util.Scanner` | `lib/43` | 只從一個 `String` 讀：`hasNext`／`next`、`hasNextInt`／`hasNextLong`／`hasNextDouble` 與對應的 `next*`、`hasNextLine`／`nextLine`，以及 `InputMismatchException`。分隔字元是 Java 的 `\p{javaWhitespace}+`，所以 `nextInt()` 之後的 `nextLine()` 拿到的是那一行剩下的部分；數值測試就是解析本身，不是正規表達式。沒有 `useDelimiter`、沒有進位基底的多載、沒有 `nextShort`／`nextFloat`、沒有 `hasNext(Pattern)`／`findInLine` 那一家族、沒有地區化數字格式，也沒有從資料流建構的建構子 |
| `java.util.zip` | `lib/44` | `Deflater`／`Inflater`（level 0–9，`-1` 是 6；`nowrap` 選 raw deflate 或 zlib 包裝；`deflate(..., flush)` 收 `NO_FLUSH`／`SYNC_FLUSH`／`FULL_FLUSH`）、`Adler32`、`GZIPOutputStream`／`GZIPInputStream`、`ZipException`／`DataFormatException`；RFC 1951 與 RFC 1952 都以 Teyru 撰寫，stored、固定 Huffman 與動態 Huffman 三種 block 都有。**level 0 的輸出與 zlib 逐位元組相同**（在輸出陣列放得下一整個 block 的呼叫方式下）；level 0 以上刻意不同，比對器是自己的。解碼端認得 JDK／zlib 在 level 0、1、6、9 的輸出，raw 與包裝都認、大小從 0 到 65536（`tests/programs/t177_deflate.teyru`），也認 JDK 的 gzip 輸出含兩個成員串接（`t178_gzip.teyru`）；Adler-32 對不上丟 `DataFormatException("incorrect data check")`，gzip trailer 對不上丟 `ZipException("Corrupt GZIP trailer")`。level 4／5 的鏈長與 zlib 不同，是量出來的選擇：zlib 的 level 4 在本專案自己的原始碼上比它的 level 3 **更差**（337,376 對 328,737 位元組），所以 level 4 用跟 level 3 一樣長的鏈再加上第二次搜尋（322,147），level 5 的鏈拉到 64 以維持在上（311,012）。記憶體約 600 KiB，比 zlib 預設的 256 KiB 多。**它比 zlib 大也比 zlib 慢**：在本專案自己的 `lib/*.teyru`（1,296,178 位元組）上跑 level 6，輸出比 JDK 的 `Deflater` 大 1.45%（307,048 對 302,659 位元組），慢 2.83 倍（92.9 ms 對 32.81 ms；同一台機器、暖機後取 5 次最佳、只計 deflate 本身、兩邊都把 `Deflater` 建構算在內）。**沒有的**：`DeflaterOutputStream`／`InflaterInputStream`／`CheckedOutputStream`／`CheckedInputStream`、`getLevel`／`getBytesRead`／`getBytesWritten`；`setStrategy` 只認 `DEFAULT_STRATEGY`／`FILTERED`／`HUFFMAN_ONLY`，`Z_FIXED` 在拒絕之列；來源不是 `ByteArrayInputStream` 時 `GZIPInputStream` 一個位元組一個位元組讀（這個標準程式庫的 `InputStream` 只有 `read()`），socket 因此一次呼叫換一個位元組 |
| `java.util.zip` 封存 | `lib/45` | `ZipEntry`、`ZipOutputStream`（STORED 與 DEFLATED、`putNextEntry`／`write`／`closeEntry`／`finish`、central directory 與 end record）、`ZipInputStream`（`getNextEntry`／`read`）、`ZipFile`（路徑、`File` 或位元組陣列；`entries()`／`getEntry`／`getInputStream`／`size()`）。格式決定照 JDK：呼叫者給了大小與 CRC-32（DEFLATED 還要自己設過壓縮後大小，那是 JDK 的 `csizeSet` 規則）就寫進 local header，否則設 general purpose bit 3、資料後面接 16 位元組的 data descriptor；STORED 沒有這個選項——讀者得先知道資料在哪裡結束——所以大小是必填，缺了以 JDK 的訊息拒絕，加密則兩個讀取端都以 JDK 的訊息拒絕。名字一律是 UTF-8 並設 bit 11，沒設也照 UTF-8 讀，而且沒有 `Charset` 參數：Teyru 字串本身就是它的 UTF-8 位元組。**ZIP64 是拒絕而不是寫一半**：裝不進 32 位元欄位的值丟 `ZipException` 指名那個欄位，讀到 `0xFFFFFFFF`／`0xFFFF` 這些魔術值就說這裡沒有 ZIP64；extra field 原樣帶過不解釋，所以不合成 extended timestamp，`getTime()` 一律回答 MS-DOS 欄位。兩個讀取端都會在資料讀完時檢查 CRC-32、大小與壓縮後大小——**JDK 的 `ZipFile` 不會**，這是本檔刻意與 JDK 不同的唯一一處，方向是寧可丟例外。`getInputStream` 回傳具體的 `ZipEntryStream` 而不是 `InputStream`，因為這個標準程式庫的 `InputStream` 只有 `read()`／`readln()`，沒有 `read(byte[], int, int)` 可以覆寫。時間是格式僅有的 MS-DOS 日期時間，`getTime()`／`setTime()` 走 epoch 毫秒並在 UTC 轉換（JDK 用 JVM 的預設時區，所以非 UTC 時差一個偏移）。驗證是三方對照：`tests/programs/t185_zip_archive.teyru` 與 `t186_zip_file.teyru` 和 JDK 雙向往返，另外 Teyru 寫出來的封存用 Info-ZIP 的 `unzip` 讀過（兩個項目列出、內容逐位元組抽出、`unzip -t` 無誤） |
| `java.util.concurrent` | `lib/37`、`lib/38` | 執行器與同步器兩塊——見上面〈並行工具〉 |
| `com.google.gson` | `lib/10`、`lib/19` | Gson 的樹狀 API，以及執行期讀取類別欄位的物件綁定（見 [docs/json.md](/docs/json)） |
| 框架 | `lib/17`、`lib/18`、`lib/30`、`lib/33`、`lib/34`、`lib/36` | Spring 形狀的容器與 web 層：`SpringApplication.run`、`application.properties` 與 `@ConfigurationProperties`／`@Profile`、`@ControllerAdvice`／`@ExceptionHandler`、`HandlerInterceptor`、靜態檔案、CORS、`ResponseEntity`、`MockServer`，HTTP/1.1 的 keep-alive、chunked、Cookie、HEAD／OPTIONS，WebSocket（`WebSocketHandler`／`WebSocketSession` + `server.addWebSocket`），會話（`HttpSession`／`Sessions`，含逾時），上傳（`MultipartFile`），回應壓縮（`HttpResponse.gzipBody`，用 `lib/44` 的 gzip），驗證（`Validation`／`ValidationException`），以及可以放上執行緒的接收迴圈（`ServerTask`）——見 [docs/framework.md](/docs/framework) |

### 名稱怎麼找

簡單名稱照 JLS 6.5.5：先看單一型別匯入（它蓋過同名的套件成員），再看檔案自己的
套件，再看 on-demand 匯入，最後才看程式整體的名字（預設套件與前綴）。兩個
`import p.*` 都提供同一個名字時是 `TY-TYP-0099`，不會照宣告順序挑一個。

**匯入本身會被檢查**（`TY-TYP-0115`）：一條 `import` 必須指向標準程式庫回答的套件
（`teyru`，以及相容用的 `java.util`、`com.google.gson`、`lombok`…，見上一節的
套件表）、這次建置裡某個檔案宣告的套件，或是完整名稱就是那條路徑的型別。名字在
Teyru 是照**簡單名稱**找的，前面寫什麼套件都一樣，所以 `import java.utli.List`
曾經是安靜地被忽略、然後照樣拿到 `List`；現在它是錯誤。模組匯入
（`example.com/dep/pkg`）由建置解析，不在此檢查範圍。

**單一型別匯入與 on-demand 匯入（`import p.*`）都可以。** 匯入寫的是套件**宣告的
名字**：在模組建置裡，一個套件的 identity 是它目錄的 import path
（`package todo` 在 `example.com/app` 裡是 `example.com/app/todo`），而 import 寫的
是 `todo`——兩種寫法都查得到。`import p.*` 提供該套件的所有公開名稱，標準庫回答的
那些套件名（`java.util.*`、`com.google.gson.*`、`lombok.*`…）也和單一型別匯入一樣
指向標準庫本身；兩個 on-demand 匯入都提供同一個名字時是 `TY-TYP-0099`。檔案
**自己宣告**的型別優先於 on-demand 匯入（JLS 6.5.5.1），所以 `import teyru.*` 旁邊
寫一個 `class Node` 不會被標準庫的 `Node` 蓋掉。

本專案自己的 Teyru 程式碼一律用 on-demand 形式：一個套件一行。靜態匯入同理，
`import static java.lang.Math.max` 寫成 `import static java.lang.Math.*`。

前綴的名字是全域的——這正是 `List`、`String` 不加 import 就能用的原因——但
**具名套件看不到預設套件**（JLS 7.4.2）。所以使用者在預設套件宣告 `class Node`
不會弄壞標準庫自己講的 `Node`；反過來，在 `package teyru` 裡宣告一個前綴已經有
的名字是 `TY-TYP-0001` 重複宣告，因為兩者的完整名稱相同。

### 沒有的東西

**這份清單現在是空的。** 標準程式庫的缺口都寫在它們所屬的地方——上面每個套件那一列或
那一節自己寫出它少了什麼——而且每個「沒有」都是決定，不是還沒做：`MessageDigest` 沒有
SHA-3 是因為 `getInstance` 寧可丟 `NoSuchAlgorithmException`，也不要給一個不是呼叫者
指名的那種雜湊；`shutdownNow` 不能打斷任務是因為這個語言沒有 `interrupt`；閏秒被拒絕
是因為差 27 秒的答案比沒有答案糟；`java.util.TimeZone` 沒做是因為這個標準程式庫沒有
`Date` 與 `Calendar` 給它服務。

需要自己的原生程式庫時，`native` 方法可以實作在 C 裡，見
[docs/native.md](/docs/native)。

## 12. 與 Java 的差異

1. **分號可省**（W7 之後寫了也收，`TY-SYN-0001` 已移除）：敘述以換行結束，`for` 標頭用冒號分隔三段。
2. `for` 標頭用冒號：`for (init : condition : update)`。
3. try-with-resources 以換行分隔資源。
4. enum 常數區與成員區用一個冒號分隔。
5. **原生 property**：欄位加 accessor 區塊；`field` 代表底層儲存。
6. **`val`**：推斷型別的不可重綁區域變數。
7. 捕獲的區域變數不要求 effectively final。
8. 沒有 annotation processor、沒有 JNI。註解可以反射，但有一個差別：元素是**按名字讀**（`ann.stringValue("value")`），不是 Java 的 `ann.value()`；值是陣列的元素不帶。
9. 泛型與 checked exception 的規則同 Java，但沒有 checked 檢查。
10. 型別引數推論比 javac 弱一層，靠目標型別而不是完整的約束求解（沒有 JLS 18）：
    - lambda 的型別引數會**從主體回推**：目標是 `Fn<String, ? extends R>` 而主體是
      `s -> s.length()` 時 `R` 定為 `Integer`。反過來不行——主體本身是一個需要目標
      型別的泛型呼叫時，兩邊互相依賴，單向代入停在那裡：
      `words.stream().flatMap(w -> Stream.of(w.split(" ")))` 單獨寫得出來，接上
      `.collect(...)` 之後 `collect` 就拿不到元素型別，要先把
      `Function<String, Stream<String>>` 寫出來。
    - 引數如果只有唯一一個候選方法，會拿該參數的型別當目標——所以巢狀的泛型呼叫
      可以推出來。
    - 顯式見證屬於它自己的呼叫：`pair(f, Builder.<Integer>make())` 的外層見證不會被
      內層覆蓋。
11. **沒有捕獲轉換**：`List<? extends Number>` 在這裡就是 `List<Number>`。Java 靠捕獲
    擋下的寫入（對 `? extends` 的容器 `add`）這裡擋不住；讀取則沒有差別
    （`list.get(0).doubleValue()` javac 也收，不是捕獲轉換擋的）。
12. **字串以 UTF-8 位元組為單位，不是 Java 的 UTF-16 code unit；字元分類與大小寫映射
    只認 ASCII。** `length`、`charAt`、`substring`、`indexOf`、`compareTo`、`hashCode`
    都按位元組算，所以同樣的運算式在 JDK 21 與這裡答案不同。實測（`teyru build` 後執行；
    JDK 21 的輸出並列）：

    | 運算式 | Teyru | JDK 21 |
    |---|---|---|
    | `"中文".length()` | `6` | `2` |
    | `(int) "中文".charAt(1)` | `184` | `25991` |
    | `"😀".length()` | `4` | `2` |
    | `"ab中c".indexOf("c")` | `5` | `3` |
    | `"中".compareTo("文")` | `-1` | `-5978` |
    | `"中文".hashCode()` | `-1887180642` | `646394` |
    | `Character.isLetter('中')` | `false` | `true` |
    | `Character.isWhitespace('\u3000')` | `false` | `true` |
    | `Character.isDigit('１')`／`Character.digit('１', 10)` | `false`／`-1` | `true`／`1` |
    | `"ß".toUpperCase()` | `ß` | `SS` |
    | `"ΟΔΟΣ".toLowerCase()` | `ΟΔΟΣ` | `οδος` |

    按 code unit 拆字串的 API（`codePointAt`／`codePointCount`／`offsetByCodePoints`）與
    `Character.getType`／`isSurrogate`／`toCodePoint`／`charCount` 不存在，見 §13。
13. **`char` 字面值只收一個 UTF-16 code unit，這裡比 javac 嚴。** `'😀'` 是兩個 code unit，
    所以這裡是 `TY-SYN-0008`（`tests/diagnostics/emojiCharLiteral`），而 **JDK 21 收下它**、
    取代理對的第一個 code unit（印出 `55357`）。兩邊要不要一致還沒定案；在那之前把它讀成
    「我們拒絕、javac 接受」，而不是「雙方一致」。
14. **例外的類別名與訊息（W6、決策 D8：報告 JDK 的全限定名）**：`Class.getName()` 報告
    JDK 的類別，所以未捕捉的例外印 `java.lang.NumberFormatException`、
    `java.lang.StackOverflowError`（`t251_exception_names`，期望值由 JDK 產生），
    `Throwable.toString()` 與訊息裡出現的類別名也一樣；`Class.forName` 兩種寫法都收
    （`java.lang.String` 與 `teyru.String` 是同一類別，因為查的是二元名）。訊息本身逐條
    對齊 JDK，還沒對齊的三條——cast 的 module／loader 括號、有幫助的
    NullPointerException 訊息、`ArrayStoreException` 的元素類別——都列在測試倉庫的
    `known-failures.txt`。

## 13. 尚未實作

- checked exception 的編譯期檢查（`throws` 只被解析；完全沒有追蹤，JDK 差分裡 javac 拒絕的 16 個案例有 8 個是這個原因，逐條寫在 `tests/jdk-diff-allow.txt`。這是刻意保留的差異，不是待辦）
- `sealed` 的 `permits` 子句沒有被驗證：沒有 `permits` 的 sealed 型別在
  switch 窮盡性上被視為不可判定而要求 `default`；switch **陳述式**的窮盡性
  仍從寬
- 執行緒只有一部分（`Thread`、`Runnable`、`synchronized` 與 `wait`／`notify` 已有，
  見 §11 的〈執行緒與同步〉）：`interrupt`、daemon、優先權、`ThreadGroup`、
  `ThreadLocal`、`join(long)`、`Thread.State` 沒有；GC 是合作式停止世界，一條既不
  迴圈、不配置也不阻塞的執行緒會讓收集等它
- 反射缺的部分：泛型型別參數的反射、每個元素型別的陣列類別
  （所有陣列共用一個類別）、原生型別取值器的 Java 拓寬（對 `byte` 欄位呼叫
  `getInt` 在 Java 會過，這裡是 `IllegalArgumentException`）
- 與 Java 生態互通（JAR、JDK 類別庫、JNI）
- 識別字中的 Unicode 逸出（`\u0041` 不能拼出識別字）
- 泛型建構子的顯式型別引數 `new <T>Foo(...)`
- 文字區塊的縮排細則（目前實作最小縮排去除）
- `java.lang.annotation` 套件（註解反射本身有，見 §11）：`@Retention` 收得下但沒有
  作用；Lombok 的 `@onX` 只把註解複製到產生的成員上，不會有任何執行期效果
- 模組系統的語意（`import module X` 會被剖析後忽略，執行期沒有模組系統；`module-info` 不支援）
- **`HashMap`／`HashSet` 的桶內樹化**：迭代順序照 JDK 21 的版面（W6、決策 D7：`h ^ (h >>> 16)`
  擾動、容量為 2 的冪、0.75 負載因子、新項目追加到桶尾、擴容時 lo／hi 拆分並保持相對順序、
  擴容時門檻加倍、`putMapEntries` 對還沒有表的 map 依來源大小事先定量），所以 `toString`／
  `keySet`／`values`／`entrySet` 與 `HashSet` 的迭代順序與 JDK 逐字相同（`t250_map_order`，
  期望值由 JDK 跑 `t250_map_order.java.ref` 產生：五個字串鍵迭代出 `banana, date, apple,
  cherry, elderberry`）。**未實作的是樹化**：桶裡有 8 個以上項目、且表已達 64 桶時 Java 會
  樹化該桶，而 `treeifyBin` 把樹根搬到桶的前端，於是那個桶的走訪順序取決於樹的形狀；非
  Comparable、雜湊又分不出高低的鍵用 `System.identityHashCode` 決勝，原理上不可重現。
  64 桶以下的表不會樹化。`LinkedHashMap` 的插入序與 `TreeMap` 的鍵序照 JDK（見 §11）。
- 陣列的執行期元素型別一律是 `teyru.Array`，所以 `String[].class` 與
  `int[].class` 是同一個物件（Java 是兩個）
- **Java 原始碼相容的已知缺口**（`javac` 收、這裡拒絕，都是實測）：`String.codePointAt`／
  `codePointCount`／`offsetByCodePoints` 不存在（`TY-TYP-0076` 找不到方法），
  `Character.getType`／`isSurrogate`／`toCodePoint`／`charCount` 同理、
  `new String(char[])` 與 `new String(char[], int, int)` 不存在（`TY-TYP-0072` 找不到
  建構子）。W7 收掉了兩條舊缺口：以 `switch` 結尾、每條分支（含 `default`）都 `return` 的
  方法不再被誤報 `TY-TYP-0020`（實測 `pick(2)` 得到 20），而分號也不再是錯誤（見 §12 第 1 條）。
- 標準程式庫缺口：`String.format` 的 `%t`／`%T`（日期時間轉換）未實作，遇到會以
  `ty_unimplemented` 停止而不是印出看起來合理的東西；其餘缺口寫在 §11 的套件表與
  〈並行工具〉（`Scanner` 只讀一個 `String`、`MessageDigest` 沒有 SHA-3 與
  SHA-512/256、`java.util.concurrent` 只有執行器與四個同步器、閏秒沒有、沒有 tzdata 的主機上時區是具名拒絕）
- 無法解析的完整限定名稱（例如 `com.example.Baz.qux(x)`）會回報
  `cannot find symbol com`——訊息指向鏈的第一段而不是整條路徑
