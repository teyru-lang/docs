---
title: "Lombok 兼容层"
description: "编译器内置的 Lombok 兼容层：注解在语义分析阶段展开成普通的 Teyru 成员，不需要 annotation processor。"
---

Teyru 的编译器内置 Lombok 兼容层：注解（annotation）会被解析成带参数的语法树，
再于语义分析阶段展开成**普通的 Teyru 成员**，之后与手写代码走完全相同的
类型检查与代码生成路径。不需要 annotation processor，不需要 javac，也不会有
AST 注入。

```teyru
import lombok.*

@Data
@AllArgsConstructor
@Builder
class Person {
  private String name
  private int age
}

Person p = Person.builder().name("ada").age(36).build()
System.out.println(p.getName())        // ada
System.out.println(p)                  // Person(name=ada, age=36)
```

使用方式：`import lombok.X`（或直接写 `@lombok.X`）。导入只是为了可读性，
编译器以注解的**简单名称**比对，所以 `@Data`、`@lombok.Data`、
`@lombok.experimental.UtilityClass` 都认得。

---

## 1. 支持状态总表

| 注解 | 状态 | 说明 |
|---|---|---|
| `@Getter` | ⚠️ 部分 | 含 `AccessLevel`（只读位置形式）、`@Accessors` 影响命名；`lazy = true` 在第一次读取时计算一次并缓存（原生类型也支持），但没有 Lombok 的线程安全 |
| `@Setter` | ✅ 完整 | 含 `AccessLevel`（只读位置形式）、`@Accessors(chain)`、`@NonNull` 字段的检查；名称已被占用时不生成（与 Lombok 相同） |
| `@ToString` | ⚠️ 部分 | `of`／`exclude`／`callSuper`／`includeFieldNames`／`onlyExplicitlyIncluded`（配合字段上的 `@ToString.Include`／`@ToString.Exclude`）；`callSuper` 的格式与 Lombok 不同（见 §2） |
| `@EqualsAndHashCode` | ⚠️ 部分 | `of`／`exclude`／`callSuper`／`onlyExplicitlyIncluded`（`@EqualsAndHashCode.Include`／`@EqualsAndHashCode.Exclude`）；`hashCode` 的常量与 `canEqual` 与 Lombok 不同（见 §2） |
| `@NoArgsConstructor` | ⚠️ 部分 | `staticName` 会生成静态工厂；`access` 只读位置形式，而且类没有手写构造函数时生成的那一个会被隐式的无参构造函数挡掉，等于没有作用（见 §3） |
| `@RequiredArgsConstructor` | ✅ 完整 | final（无初始值）与 `@NonNull` 字段 |
| `@AllArgsConstructor` | ✅ 完整 | 略过已有初始值的 final 字段 |
| `@Data` | ⚠️ 部分 | getter + setter + `@RequiredArgsConstructor` + `@ToString` + `@EqualsAndHashCode`；隐式构造函数收 `@NonNull` 字段并在里面插入检查 |
| `@Value` | ⚠️ 部分 | private final 字段、getter、全参构造函数、`staticConstructor`；继承会被 `TY-TYP-0007` 拦下 |
| `@Builder` | ⚠️ 部分 | 类、构造函数与方法；`builderMethodName`／`buildMethodName`／`builderClassName`／`toBuilder`／`@Builder.Default`／`@Builder.ObtainVia`／`setterPrefix`（首字母会大写：`with` 加 `name` 是 `withName`） |
| `@NonNull` | ⚠️ 部分 | 字段与参数都检查：字段被收进生成的构造函数时插入检查，`@Setter` 生成的 setter 也检查，手写方法与构造函数的参数（只标在参数上即可）同样检查。直接赋值字段不检查（Lombok 也一样）；`@Builder` 的检查位置与 Lombok 不同（见 §3） |
| `@With` | ⚠️ 部分 | 字段上的 `@With` 生成 `withX(T)`，以全参构造函数复制；写在类上不会为所有字段生成（Lombok 会） |
| `@Accessors` | ⚠️ 部分 | `chain`／`fluent`／`prefix`；`fluent = true` 不会像 Lombok 那样连带把 setter 变成可链式（要另外写 `chain = true`，见 §3） |
| `@FieldDefaults` | ✅ 完整 | `level`／`makeFinal` |
| `@UtilityClass` | ⚠️ 部分 | 构造函数 private、成员 static；继承会被 `TY-TYP-0007` 拦下 |
| `@StandardException` | ⚠️ 部分 | 生成 4 个标准异常构造函数；`E(Throwable)` 用 `cause.getMessage()` 当消息。差异：全参构造函数是 `super(message, cause)`，Lombok 是 `super(message)` 加 `initCause(cause)` |
| `@Cleanup` | ✅ 完整 | 展开为 try-with-resources，任何退出路径都会 close |
| `@SneakyThrows` | ✅ 完整 | 展开为 try/catch(Throwable) 后重新抛出 |
| `@Synchronized` | ✅ 完整 | 方法体包进 synchronized；静态方法用生成的 `__lock$<类名>` 字段 |
| `@Log` 家族 | ✅ 完整 | `@Log`／`@Slf4j`／`@Log4j`／`@Log4j2`／`@CommonsLog`／`@JBossLog`／`@Flogger`／`@XSlf4j` 都生成 `private static final Logger log`（见 §5） |
| `@ExtensionMethod` | ✅ 完整 | 找不到方法时改写为 `Ext.method(receiver, ...)` |
| `@FieldNameConstants` | ⚠️ 部分 | 生成嵌套的 `Fields` 类；`prefix` 是加在常量的**值**上，不是加在名称上，与 Lombok（1.18.4 以前）相反 |
| `@Delegate` | ✅ 完整 | 为字段类型的公开方法生成委托方法 |
| `@Helper` | ✅ 完整 | 方法内的局部类：生成实例，声明之后同名的非限定调用都走它（实例必须有无参构造函数） |
| `@Tolerate` | ✅ 完整 | 被标的成员对生成器“不存在”：`@Setter private Instant date` 加上 `@Tolerate public void setDate(String)` 会同时有两个重载 |
| `@Locked` | ✅ 完整 | 用具名锁字段包住方法体 |
| `@NonFinal` | ⚠️ 部分 | 收得下注解，但没有任何作用：Lombok 用它让 `@FieldDefaults(makeFinal = true)`／`@Value` 放过一个字段，这里不读；标在类上时，继承检查在更早的阶段就已经跑过了 |
| `@PackagePrivate` | ⚠️ 部分 | 只有写在类上才有效，把该类字段与方法的访问修饰符拿掉；写在字段或方法上（Lombok 的用法：让 `@FieldDefaults(level = …)`／`@Value` 放过一个字段）没有作用 |
| `@Var` | ✅ 完整 | 已废弃的 Lombok 别名，无需生成任何东西 |
| `@SuperBuilder` | ✅ 完整 | 构造函数链上的所有字段都在同一个 builder；见 §4 |
| `@Singular` | ✅ 完整 | 逐项添加、批量添加、清除、`build()` 取得副本；`@Singular("name")` 可改名；见 §4 |
| `@Jacksonized` | ❌ 不适用 | 没有 Jackson，注解会被接受但不生成任何东西 |
| `@Builder.ObtainVia` | ✅ 完整 | `field`／`method`／`isStatic`，由 `toBuilder` 读取——与 Lombok 相同，`build()` 读的是 builder 自己的字段 |
| `@onMethod_`／`@onParam_`／`@onConstructor_` | ✅ 完整 | 注解会被复制到生成的 getter／setter 参数／构造函数上（见 §3.5） |
| `@CustomLog` | ✅ 完整 | 读取 `lombok.config` 的 `lombok.log.custom.declaration`（见 §3.5） |

“完整”的定义：`tests/programs/t16`–`t19`、`t54` 有对应的测试，`go test ./...` 会验证输出；
`t55_lombok_every.teyru` 在一支程序里把上表每一个 ✅ 的注解各用一次（只有 `@CustomLog`
与 `@onX` 家族不在里面，见下一句），输出逐行比对；
`t91_lombok_log.teyru` 覆盖 `@Log`、`@CustomLog`（含 `lombok.config`）与 `@onX` 家族；
`t144_lombok_parity.teyru` 覆盖 `@NonNull` 的各条路径、`@Tolerate`、
`onlyExplicitlyIncluded`、`setterPrefix`、方法上的 `@Builder`、`@Builder.ObtainVia`、
`@Helper`、`@Getter(lazy = true)` 与 `@StandardException`。
标 ⚠️ 的是“能接受注解、但行为与 Lombok 有差距”的行。

这张表是逐条编写程序、对照 Lombok 的文档和源码之后才标注的：`@Builder.ObtainVia`
以前在 `build()` 里被读取（Lombok 只在 `toBuilder` 读它），`@Helper` 与 `@Tolerate`
以前只是接收注解，`@Getter(lazy = true)` 的初始值会被计算两次且原生类型编译不过，
`@Data` 的构造函数不收 `@NonNull` 字段，`@Setter` 生成的 setter 不插入检查，
`@Value`／`@UtilityClass` 的 `final` 拦不住继承，`@StandardException` 的
`E(Throwable)` 不带消息——这些都已照 Lombok 的行为修掉，并且各有测试。

---

## 2. 生成的成员是什么样子

以 `@Data class Person { private String name; private int age }` 为例，
展开后等同于：

```teyru
class Person {
  private String name
  private int age

  public Person() {
  }

  public String getName() {
    return this.name
  }
  public int getAge() {
    return this.age
  }
  public void setName(String value) {
    this.name = value
  }
  public void setAge(int value) {
    this.age = value
  }
  public String toString() {
    return "Person(name=" + this.name + ", age=" + this.age + ")"
  }
  public boolean equals(Object o) {
    if (this == o) {
      return true
    }
    if (o == null || !(o instanceof Person)) {
      return false
    }
    Person other = (Person) o
    if (this.name == null) {
      if (other.name != null) {
        return false
      }
    } else if (!this.name.equals(other.name)) {
      return false
    }
    if (this.age != other.age) {
      return false
    }
    return true
  }
  public int hashCode() {
    int result = 1
    result = 31 * result + (this.name == null ? 0 : this.name.hashCode())
    result = 31 * result + this.age
    return result
  }
}
```

差异说明：

- `@Getter`／`@Setter` 必须与 `@Data`、`@Value` 或类级注解搭配才会覆盖所有字段；
  写在单个字段上只影响该字段。
- `@Data` 生成的构造函数是 `@RequiredArgsConstructor`（final 且无初始值的字段，加上
  标了 `@NonNull` 的字段，与 Lombok 相同）。如果类没有这类字段，就是无参构造函数；
  要全参构造函数请同时加上 `@AllArgsConstructor`。
- `@Builder` **不会**生成 getter，与 Lombok 相同。
- `@Getter(lazy = true)` 把字段的初始值搬进 getter：构造函数不再计算它，第一次读取时
  计算一次之后缓存（与 Lombok 相同）。持有的值是 boxed 的，所以原生类型也可以。差别是
  没有加锁：这门语言没有线程。
- `@EqualsAndHashCode` 的 `hashCode` 用 31 与 0（Lombok 用 59 与 43），字段顺序按声明
  顺序（Lombok 会排序），而且不生成 `canEqual`——所以父类和子类只要字段相同就相等，
  Lombok 会说它们不相等。
- `@ToString(callSuper = true)` 生成的字符串是 `Child(c=2; super=Base(b=1))`，
  Lombok 是 `Child(super=Base(b=1), c=2)`：自己的字段先写，super 那一段在最后。
- `@StandardException` 的 `E(Throwable)` 是
  `super(cause == null ? null : cause.getMessage(), cause)`，所以
  `new E(new RuntimeException("c")).getMessage()` 是 `c`（与 Lombok 相同）。全参
  构造函数走 `super(message, cause)`；Lombok 是 `super(message)` 之后
  `initCause(cause)`，差别只在“先明确表示没有 cause、之后还能 initCause”这个细节。

---

## 3. 与 Lombok 的差异（重要）

1. **没有 annotation processor。** 展开发生在编译器内部，`javac` 完全不参与。
2. **`@NonNull` 检查的位置。** 字段标了 `@NonNull`、又被收进生成的构造函数时会插入
   检查，`@Setter` 生成的 setter、手写方法与构造函数的参数（只标在参数上即可）也都
   会插入检查；直接赋值字段不检查——Lombok 的说明也只承诺“给这个字段**生成**的方法
   赋值”会插检查，这点两边一致。差别在 `@Builder`：Lombok 在 builder 的 setter 上
   就检查，`builder().name(null)` 当场抛出；这里的 builder setter 不检查，检查落在
   `build()` 调用的构造函数里。
3. **`@Singular` 传的是可变副本**，不是 `Collections.unmodifiableList` 包装（见 §4）。
4. **`@SuperBuilder` 生成一个扁平的 builder**，不是 builder 继承链（见 §4）。
5. **`@onX` 注解只会被复制，不会被执行。** 注解字面上会挂到生成出来的成员上，
   但 Teyru 没有 `java.lang.annotation` 的运行时，所以 `@Deprecated` 之类的标记
   不会有任何效果；需要反射读取注解的框架在这里不适用。
6. **只读取 `lombok.config` 的一个键。** `lombok.log.custom.declaration`
   （供 `@CustomLog` 使用）会被读取；其余键与 `config.stopBubbling` 都不读取，搜索一律
   走到文件系统根目录。
7. **`@Value` 的字段一定是 private final**；若字段已经有初始值，构造函数不会再收它。
   `final` 是在检查继承之后才由注解标上去的，所以 `class Ext extends V` 由一个
   补做的检查拦下（`TY-TYP-0007`，消息与 Lombok 的 `cannot inherit from final V`
   同义）。`@UtilityClass` 的 `final` 走同一条路。
8. **`@Builder` 的 `setterPrefix` 会把名字的首字母大写**：`setterPrefix = "with"`
   加字段 `name` 生成 `withName`（与 Lombok 相同）；没有 prefix 时名字就是字段名本身。
   挂在方法上的 `@Builder` 会把目标方法的参数当成字段，`build()` 调用该方法
   （static 的用 `<类>.<方法>(...)`，实例方法用一个新实例）；`@Builder.ObtainVia` 由
   `toBuilder` 读取，`method`／`isStatic` 两种形式都支持。
9. **`@Helper` 只认方法内的局部类。** 这里会生成一个实例，声明之后同名的非限定
   调用都走它；写在成员类上没有作用，只是把类标成 static（Lombok 会直接报错：
   `@Helper is legal only on method-local classes`）。
   `@Tolerate` 则是让生成器“看不到”被标的成员：`@Setter private Instant date` 加上
   `@Tolerate public void setDate(String)` 之后两个重载都在，与 Lombok 相同。
10. **`@Accessors(fluent = true)` 不会顺便开启链式。** Lombok 的 `fluent` 会连带把
    setter 的返回值改成自身，所以 `new F().n(5).n()` 在 Lombok 成立；这里的 setter
    仍是 `void`，要链式得自己加 `chain = true`。
11. **构造函数的 `access` 只读位置形式。** `@AllArgsConstructor(AccessLevel.PRIVATE)`
    有效，`@AllArgsConstructor(access = AccessLevel.PRIVATE)`（Lombok 的惯用写法）
    会被忽略而生成 `public` 构造函数。`@NoArgsConstructor` 更进一步：类没有手写构造函数
    时，隐式的公开无参构造函数已经占位，生成的那一个照 §6 的规则被跳过，所以
    `access` 完全没有作用——要它生效得先自己写一个别的构造函数。

---

## 3.5 `@onX` 家族与 `@CustomLog`

### `@onMethod_`／`@onParam_`／`@onConstructor_`

这些选项把一个注解复制到另一个注解生成出来的成员上：

```teyru
class Annotated {
  @Getter(onMethod_ = @Deprecated) String name
  @Getter @Setter(onParam_ = @Deprecated) int age
}

@AllArgsConstructor(onConstructor_ = @Deprecated)
class Made {
  String a
  int b
}
```

`onMethod_` 挂到 getter 上，`onParam_` 挂到 setter 的参数上，`onConstructor_`
挂到生成的构造函数上。两种写法都读：Lombok 的参数形式（含 javac7 时代的 `@__(...)`
包装）与紧挨在旁边的 `@onMethod_Deprecated` 裸写法。

只有**单个**注解能读回来：数组形式 `onMethod_ = {@A, @B}` 会被静默忽略，因为解析器
不会保留数组参数里的注解。

注解只是**被复制**，不会被执行——Teyru 没有 `java.lang.annotation` 的运行时，
所以标记本身没有作用，是给后续编译器阶段读取的。

### `@CustomLog`

Lombok 只用 `lombok.config` 配置这一个注解。Teyru 读取
`lombok.log.custom.declaration`，格式与 Lombok 相同：

```
lombok.log.custom.declaration = MyLog MyLog.of(NAME)
```

第一个词是 logger 类型，后面是创建它的模板；`NAME` 会被替换成挂注解的类名，
`TYPE` 在 Lombok 里是类对象。**Teyru 不支持 `TYPE`**：模板里的参数会传给一个
静态工厂，而 Teyru 的 `X.class`（见 `docs/language.md`）能表达的只有名称，
硬传会生成一个对不上工厂参数的东西，因此报告 `TY-INT-0006` 并要求改用 `NAME`。

搜索规则与 Lombok 相同：从源文件所在目录往上找最近的 `lombok.config`，每个键
以最近的一份为准。差别是 `config.stopBubbling` 不被读取，搜索一律走到根目录。

如果声明的类型找不到，报告 `TY-INT-0006`；找不到 `log` 符号时则是一般的
`TY-TYP-0048`。

---

## 4. `@Singular` 与 `@SuperBuilder`

### `@Singular`

```teyru
@Builder
class Order {
  @Singular private List<String> items
  @Singular private Map<String, Integer> counts
  @Singular("tag") private List<String> tags
}
```

生成（以 `items` 为例）：

| 成员 | 行为 |
|---|---|
| `addItems(E value)` | 第一次调用时创建 `ArrayList`，之后逐项添加 |
| `addItemsAll(List<E> values)` | 批量添加 |
| `clearItems()` | 清空（下次添加会重新创建） |
| `build()` | 传入**副本**，且永远不是 `null` |

Map 字段的添加方法用字段名本身：`counts(K key, V value)`、`countsAll(Map<K,V>)`、
`clearCounts()`。`@Singular("tag")` 会把添加方法改名为 `tag(E)`。

命名与 Lombok 不同：Lombok 对 `List` 字段 `items` 生成的是单数化的 `item(E)` 与
`items(Collection)`，对 `Map` 字段 `counts` 生成的是 `count(K,V)` 与 `counts(Map)`。
Teyru 一律是 `add<字段名>`／`add<字段名>All`，Map 的双参数版本直接叫字段名。

与 Lombok 的差别：Lombok 生成 `java.util.Collections.unmodifiableList` 包装，
Teyru 没有那个 API，所以传的是一份可变副本——**对象与 builder 不共用同一个集合**，
但拿到的人仍可修改它。

### `@SuperBuilder`

```teyru
@SuperBuilder
class Animal {
  private String name
  private int legs
}

@SuperBuilder
class Dog extends Animal {
  private String breed
}

Dog d = Dog.builder().name("rex").legs(4).breed("lab").build()
```

Lombok 用“builder 继承 builder，并以自引用的类型参数 `B extends Builder<B>` 返回
自身”来让链式调用跨层延续。Teyru 改成**单一扁平的 builder**：子类的 builder 覆盖
整条继承链的字段，`build()` 一次传给子类构造函数，构造函数再把父类那一份往上传。
链式写法完全一样，而且不需要泛型。

代价：`Animal.builder()` 与 `Dog.builder()` 是两个独立的类，`Dog` 的 builder
不是 `Animal` 的 builder 的子类。把 builder 当参数在继承链之间传递的代码
在 Lombok 可以编译，在这里不行——这种写法很少见。

## 5. 日志注解

Teyru 没有 SLF4J、Log4j 这些外部包，标准库提供一个简单的 `Logger`：

```teyru
class Logger {
  public Logger(String name)
  public void trace(String msg)
  public void debug(String msg)
  public void info(String msg)
  public void warn(String msg)
  public void error(String msg)
}
```

`@Slf4j` 等注解生成的字段是 `private static final Logger log = new Logger("<类名>")`，
输出格式为 `LEVEL <类名> - <信息>`，写到标准输出。要接真正的日志系统，请自行把
`log` 字段换成对应的实现。

---

## 6. 展开顺序

1. 类级的结构性注解（`@Value`、`@FieldDefaults`、`@UtilityClass`、`@Data`）先调整修饰符。
2. 成员级注解（`@Getter`、`@Setter`、`@NonNull`、`@With`、`@Delegate` …）逐字段处理。
3. 类级的生成器（`@ToString`、`@EqualsAndHashCode`、构造函数、`@Builder`）最后执行。
4. 生成的成员在 vtable 分配**之前**加入，因此它们和手写成员一样参与重写与多态。

如果同一个签名已经存在（手写或生成的），**构造函数**会被跳过，**方法**则是
`TY-TYP-0011` 重复定义的编译错误；标了 `@Tolerate` 的成员例外——生成器把它当成
不存在，于是照样生成自己的那一份（Lombok 的行为：两个重载，或者真正的重复定义
错误）。`@Setter`／`@Getter` 生成的访问器另外会先看名字有没有被占用，占用了就不
生成，这也是 Lombok 的规则。
