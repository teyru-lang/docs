---
title: "Teyru 诊断码一览"
description: "每个诊断的稳定代码格式 TY-<阶段>-<四位数字>，以及各阶段的代表性消息。"
---

每个诊断都有稳定代码，格式为 `TY-<阶段>-<四位数字>`。阶段前缀：

| 前缀 | 阶段 | 代表 |
|---|---|---|
| `TY-SYN` | 词法与语法分析 | 分号、括号、换行、字面量 |
| `TY-TYP` | 语义分析（名称、类型、成员） | 找不到符号、类型不匹配、重载 |
| `TY-PROP` | 原生 property 规则 | accessor 冲突、存储需求 |
| `TY-INT` | 编译器内部／前导库 | 前导库损坏、不支持的节点 |
| `TY-IO` | 文件访问 | 读不到源文件 |

输出格式为 `文件:行:列: error[码]: 信息`，例如：

```
hello.teyru:4:11: error[TY-TYP-0051]: incompatible types: String cannot be converted to int
```

`TY-SYN-0001`、`0002`、`0004`–`0011` 由词法分析器产生（`TY-SYN-0003` 例外：它是解析器
在语句结尾与 `throw` 换行时发出的），`TY-SYN-0100` 之后也由解析器产生。

---

## TY-SYN：词法与语法

| 代码 | 消息 | 说明与修复方法 |
|---|---|---|
| TY-SYN-0001 | `';' is not Teyru syntax; end statements with a newline` | Teyru 没有分号。删掉分号，让语句以换行结束；`for` 头部改用冒号分隔。 |
| TY-SYN-0002 | `unexpected character %q` | 出现了不属于任何 token 的字符（多半是全角标点或粘贴进来的控制字符）。 |
| TY-SYN-0003 | `expected end of line, found %s`／`throw expression must start on the same line` | 语句后面还有残余 token；或者 `throw` 的表达式被换行截断。把表达式写在同一行，或者用 `(` 开头让它跨行。需要值的 `yield` 没有这条消息：换行后它被当成标识符，会得到 `cannot find symbol yield`。 |
| TY-SYN-0004 | `unterminated block comment` | `/*` 没有对应的 `*/`。 |
| TY-SYN-0005 | `invalid unicode escape` | `\uXXXX` 不是四位十六进制。 |
| TY-SYN-0006 | `unterminated string literal`／`unterminated text block` | 字符串在换行前没有收尾，或者 text block 少了结尾的 `"""`。 |
| TY-SYN-0007 | `text block must start with a line break after """` | `"""` 之后必须立刻换行。 |
| TY-SYN-0008 | `unterminated character literal`／`character literal does not fit in a char` | 字符字面量没有收尾，或者超过 U+FFFF。 |
| TY-SYN-0009 | `malformed integer literal`／`malformed floating-point literal` | 数字格式错误（例如 `0x` 后面没有数字、`1e` 没有指数）。 |
| TY-SYN-0010 | `integer literal out of range` | 整数字面量超出可表示的位数：十进制 `int` 上限 2^31-1、`long` 上限 2^63-1，非十进制 `int` 上限 `0xFFFFFFFF`、`long` 上限 `0xFFFFFFFFFFFFFFFF`（边界值会绕成负数）。需要更大的值请加 `L` 后缀。 |
| TY-SYN-0011 | `invalid escape sequence \%c` | 字符串或字符字面量里有 Teyru 不认识的转义序列（例如 `\q`）。合法的有 `\n` `\t` `\r` `\b` `\f` `\s` `\0` `\\` `\'` `\"`、八进制 `\nnn` 与 `\uXXXX`。 |
| TY-SYN-0100 | `expected '%s', found %s` | 少了预期的 token（`)`、`]`、`{`、`}`、`:` 等）。 |
| TY-SYN-0101 | `expected identifier, found %s` | 需要标识符的位置放了别的东西；常见于把关键字当作名称使用。 |
| TY-SYN-0102 | `unexpected %s at top level` | 文件最上层只允许 package／import／类型声明，或者直接写成员（隐式类形式）。 |
| TY-SYN-0103 | `unexpected %s in class body` | 类成员声明不完整。 |
| TY-SYN-0104 | `expected ',' ':' or '}' after enum constants` | enum 常量区与成员区之间要用一个 `:` 分隔。 |
| TY-SYN-0105 | `expected 'get' or 'set' accessor, found %s` | accessor 块里只能有 `get` 和 `set`。 |
| TY-SYN-0106 | `unexpected %s` | 块内出现无法解析的语句。 |
| TY-SYN-0107 | `try resources must be separated by line breaks` | try-with-resources 的每个资源用换行分隔，不能用分号。 |
| TY-SYN-0108 | `try requires catch or finally` | `try` 至少要有一个 `catch` 或 `finally`。 |
| TY-SYN-0109 | `expected 'case' or 'default', found %s` | switch 块里只能有 `case`／`default`。 |
| TY-SYN-0110 | `cannot mix '->' and ':' case labels` | 同一个 switch 只能用一种标签形式。 |
| TY-SYN-0111 | `expected expression, found %s` | 需要表达式的位置放了别的 token。 |
| TY-SYN-0112 | `array dimension expression after empty dimension` | `new int[3][]` 之后不能再写 `[5]`。 |
| TY-SYN-0113 | `array creation with both dimensions and initializer` | `new int[3]{1,2,3}` 不合法；要么给大小，要么给初始值。 |

## TY-TYP：类型与符号

### 声明与成员（0001–0025）

| 代码 | 消息 | 说明与修复方法 |
|---|---|---|
| TY-TYP-0001 | `duplicate type %s (also declared at %s)`／`duplicate nested type %s` | 同名类型重复声明。 |
| TY-TYP-0002 | `type variable %s cannot have type arguments` | 类型变量不能再带类型参数。 |
| TY-TYP-0003 | `cannot find type %s` | 找不到类型名称；检查拼写、import 或前导库。 |
| TY-TYP-0004 | `type %s expects %d type arguments, found %d` | 泛型参数个数不符。 |
| TY-TYP-0005 | `primitive type %s cannot be a type argument; use its box type` | 泛型不能用基本类型，请用包装类。 |
| TY-TYP-0006 | `class cannot extend interface %s` | 类要用 `implements` 接口。 |
| TY-TYP-0007 | `cannot extend final class %s` | 被 `final` 的类不能被继承。当 `final` 是由 `@Value`／`@UtilityClass` 标上去的时候，这一条在注解展开之后才报（“拦下继承”的检查原本跑在展开之前，所以那两个注解没有作用）。 |
| TY-TYP-0008 | `cyclic inheritance involving %s` | 继承关系成环。 |
| TY-TYP-0009 | `%s is not an interface` | `implements` 后面只能是接口。 |
| TY-TYP-0010 | `duplicate field %s in %s` | 同一个类重复声明字段。 |
| TY-TYP-0011 | `duplicate method %s in %s`／`duplicate constructor %s` | 参数擦除后签名相同的方法或构造器重复。 |
| TY-TYP-0012 | `varargs parameter must be last` | `...` 只能放在最后一个参数。 |
| TY-TYP-0013 | `interface method with a body must be default, static or private` | 接口方法有 body 时要标 `default`／`static`／`private`。 |
| TY-TYP-0014 | `method %s needs a body` | 非抽象方法要有 body。 |
| TY-TYP-0015 | `abstract or native method %s cannot have a body` | `abstract`／`native` 方法不能有 body。 |
| TY-TYP-0016 | `abstract method %s in non-abstract class %s` | 有抽象方法的类必须标 `abstract`。 |
| TY-TYP-0017 | （已移除） | `native` 方法现在可以声明在任意类中，并由 `--native` 提供的 C 实现。 |
| TY-TYP-0018 | `'%s' is only allowed for local variables; fields need an explicit type` | `var`／`val` 不能用在字段、参数或返回类型。 |
| TY-TYP-0019 | `%s must implement %s from %s` | 具体类没有实现接口或父类的抽象方法。 |
| TY-TYP-0020 | `missing return statement` | 有返回值的方法在某些路径上没有 `return`。 |
| TY-TYP-0021 | `duplicate local variable %s` | 同一个作用域重复声明局部变量。 |
| TY-TYP-0022 | `break outside of loop or switch` | `break` 只能出现在循环或 switch 内（带标签的除外）。 |
| TY-TYP-0023 | `continue outside of loop` | `continue` 只能出现在循环内。 |
| TY-TYP-0024 | `thrown value must be a Throwable, found %s` | `throw` 的对象必须继承 `Throwable`。 |
| TY-TYP-0025 | `cannot synchronize on void` | `synchronized` 的锁不能是 void 表达式。 |

### 语句（0026–0044）

| 代码 | 消息 | 说明与修复方法 |
|---|---|---|
| TY-TYP-0026 | `local variables cannot be declared final; use 'val'` | 局部变量的不可重新绑定请用 `val`。 |
| TY-TYP-0027 | `'%s' requires an initializer` | `var`／`val` 一定要有初始值。 |
| TY-TYP-0028 | `'%s' cannot infer a type from null` | `null` 无法推断类型，请写出明确类型。 |
| TY-TYP-0029 | `'%s' cannot infer a functional interface type; declare it explicitly` | lambda 需要目标类型，请明确声明接口类型。 |
| TY-TYP-0030 | `for-each requires an array or Iterable, found %s` | 增强 `for` 只能用在数组或 `Iterable`。 |
| TY-TYP-0031 | `incompatible types: %s is not assignable to %s` | 循环变量类型与元素类型不匹配。 |
| TY-TYP-0032 | `return value required for %s` | 有返回值的方法不能空手 `return`。 |
| TY-TYP-0033 | `cannot return a value from a void method` | void 方法不能返回值。 |
| TY-TYP-0034 | `catch type must be a Throwable, found %s` | `catch` 的类型必须是 `Throwable` 家族。 |
| TY-TYP-0035 | `switch selector must be a char, byte, short, int, Character, Byte, Short, Integer, String or enum type, found %s` | switch 的选择子类型不合法。 |
| TY-TYP-0036 | `duplicate default label` | 同一个 switch 只能有一个 `default`。 |
| TY-TYP-0037 | `incompatible pattern type %s for switch on %s` | `case 型別 名` 与选择子类型无关。 |
| TY-TYP-0038 | `case label must be a constant expression` | case 标签必须是编译期常量。 |
| TY-TYP-0039 | `duplicate case label` | 同一个 switch 内标签重复。 |
| TY-TYP-0040 | `array required, found %s` | 对非数组使用 `[]`。 |
| TY-TYP-0041 | `inconvertible types: %s cannot be cast to %s` | 这个 cast 永远不可能成立。 |
| TY-TYP-0042 | `incompatible pattern type %s for %s` | `instanceof` pattern 的类型与左边无关。 |
| TY-TYP-0043 | `not an enclosing class: %s` | `Outer.this` 的外层类不存在。 |
| TY-TYP-0044 | `no superclass` | 没有父类却使用 `super`。 |

### 名称与访问（0045–0048）

| 代码 | 消息 | 说明与修复方法 |
|---|---|---|
| TY-TYP-0045 | `cannot access instance field %s from a static context` | 静态方法内不能直接读实例字段。 |
| TY-TYP-0046 | `%s has private access in %s` | 私有成员只能在自己的类内访问。property 看的是 **accessor 的修饰符**（底层存储一律 private，所以存储字段的修饰符不能拿来判断）；`x.p = v` 看 setter，`p.x` 和 `p.x += 1` 看 getter。同一个 nest（同一个最外层类）内互通。 |
| TY-TYP-0048 | `cannot find symbol %s` | 找不到名称：检查拼写、作用域、import，或者是否忘了声明。 |

### 类型转换与运算符（0049–0067）

| 代码 | 消息 | 说明与修复方法 |
|---|---|---|
| TY-TYP-0049 | `null is not assignable to %s` | `null` 不能赋给基本类型。 |
| TY-TYP-0050 | `possible lossy conversion from %s to %s` | 需要窄化转换，请加 cast。 |
| TY-TYP-0051 | `incompatible types: %s cannot be converted to %s` | 最常见的类型错误：赋值、传参、返回的类型不兼容。 |
| TY-TYP-0052 | `operator '!' cannot be applied to %s` | `!` 只能用在 `boolean`。 |
| TY-TYP-0053 | `operator '~' requires an integral operand` | `~` 只能用在整数。 |
| TY-TYP-0054 | `operator '%s' requires a numeric operand` | 一元 `+`／`-` 只能用在数值。 |
| TY-TYP-0055 | `operator '%s' requires a numeric operand` | `++`／`--` 只能用在数值。 |
| TY-TYP-0056 | `cannot apply '%s' to a non-assignable expression` | `++`／`--` 的目标必须可以被赋值。 |
| TY-TYP-0057 | `cannot assign a value to final variable %s` | `val` 或 `final` 变量不能再次赋值。 |
| TY-TYP-0058 | `cannot assign a value to final field %s` | 不能给其他类的 final 字段赋值。 |
| TY-TYP-0059 | `incompatible operand types %s and %s` | `==`／`!=` 两边的类型无法比较。 |
| TY-TYP-0060 | `incomparable types: %s and %s` | 两个引用类型之间不可能相等。 |
| TY-TYP-0061 | `operator '%s' cannot be applied to %s and %s` | 大小比较只能用在数值。 |
| TY-TYP-0062 | `operator '%s' requires integral or boolean operands` | `&`／`\|`／`^` 的操作数类型不合法。 |
| TY-TYP-0063 | `operator '%s' requires integral operands` | 移位运算符只能用在整数。 |
| TY-TYP-0064 | `operator '%s' cannot be applied to %s and %s` | 算术运算符的操作数不是数值（常见：对象忘了 unbox）。 |
| TY-TYP-0065 | `left-hand side of an assignment must be a variable` | 赋值的左边不能是任意表达式。 |
| TY-TYP-0066 | `operator '%s' cannot be applied to boolean` | `boolean` 不能做加减乘除。 |
| TY-TYP-0067 | `array dimension must be non-negative` | 数组大小是负的常量。 |

### 构造与实例化（0068–0075）

| 代码 | 消息 | 说明与修复方法 |
|---|---|---|
| TY-TYP-0068 | `cannot instantiate %s` | 这个类型不能用 `new`。 |
| TY-TYP-0069 | `%s is abstract; cannot be instantiated` | 抽象类不能直接 `new`。 |
| TY-TYP-0070 | `cannot extend final class %s`／`cannot subclass enum %s` | 匿名类不能继承 final 类或 enum。 |
| TY-TYP-0071 | `an enclosing instance of %s is required` | 内部类需要在有外层实例的地方创建。 |
| TY-TYP-0072 | `no suitable constructor found for %s(%s)` | 没有匹配的构造器；检查参数个数与类型。 |
| TY-TYP-0073 | `array clone takes no arguments` | `clone()` 不接受参数。 |
| TY-TYP-0074 | `this(...) and super(...) may only be called from a constructor` | `this(...)`／`super(...)` 只能写在构造器里（可以是 JEP 513 允许的“`super()` 之前的语句”之一，见 docs/language.md §4.2）。 |
| TY-TYP-0075 | `recursive constructor invocation` | 构造器递归调用自己。 |

### 方法解析、lambda 与 pattern（0076–0094）

| 代码 | 消息 | 说明与修复方法 |
|---|---|---|
| TY-TYP-0076 | `cannot find method %s(%s)`／`cannot find method %s for this functional interface` | 找不到方法：检查名称、参数类型、可见性，或者接收者类型。 |
| TY-TYP-0077 | `non-static method %s cannot be referenced from a type name` | 用类名只能调用静态方法。 |
| TY-TYP-0078 | `cannot invoke %s on %s` | 对这个类型调用方法不合法。 |
| TY-TYP-0079 | `%s has %s access in %s` | 方法可见性不足。 |
| TY-TYP-0080 | `cannot find symbol %s in %s`／`on array` | 成员不存在于该类型。 |
| TY-TYP-0081 | `cannot infer the functional interface for this lambda; declare the target type`／`cannot infer the functional interface for this method reference` | lambda／方法引用没有目标类型，请明确指定。 |
| TY-TYP-0082 | `lambda target type must be a functional interface, found %s`／`method reference target type must be a functional interface` | 目标类型不是接口。 |
| TY-TYP-0083 | `%s is not a functional interface` | 接口有多个抽象方法，不能作为 lambda 目标。 |
| TY-TYP-0084 | `lambda has %d parameters but %s requires %d` | lambda 参数个数不匹配。 |
| TY-TYP-0085 | `cannot construct %s` | 构造器引用的目标不能被构造。 |
| TY-TYP-0086 | `cannot resolve static import %s` | 静态 import 找不到对应成员。 |
| TY-TYP-0087 | `record pattern requires a record type, found %s` | 解构 pattern 的左边不是 record 类型（`case Point(int x, int y)` 的 `Point` 必须是 record）。 |
| TY-TYP-0088 | `record pattern for %s needs %d components, found %d` | 解构的绑定个数与 record 成员数不匹配；嵌套解构也要逐一对应。 |
| TY-TYP-0089 | `'case null' requires a reference selector` | `case null` 只能用在引用类型的 switch 选择子上，基本类型请改用 `default`。 |
| TY-TYP-0090 | `%s does not name a super interface` | `Interface.super.method()` 的 `Interface` 不存在或者不是接口。 |
| TY-TYP-0091 | `%s is not a super interface of %s` | 限定的 `super` 只能指向自己（直接或间接）实现的接口。 |
| TY-TYP-0092 | `a primitive pattern needs a name to bind the value to` | 基本类型 pattern 一定要绑定变量：`o instanceof int i`，不能只写 `o instanceof int`。 |
| TY-TYP-0093 | `boolean cannot be converted to %s` | `boolean` 只能和 `boolean` pattern 配对。 |
| TY-TYP-0094 | `primitive pattern %s needs a boxed value, found %s` | 选择子既不是引用类型也不是基本数值。 |
| TY-IO-0101 | 模块文件本身的错误（`teyru.mod` 无法解析、版本语法不对…） | 消息来自 `internal/mod`，指出文件与原因。 |
| TY-IO-0102 | `cannot read package %s: %v` | 导入的包在模块缓存里找不到，或者它的源文件读不出来。先跑 `teyru mod tidy` 或 `teyru get`。 |
| TY-IO-0103 | `teyru.sum` 的哈希不匹配 | 缓存里的模块内容与 `teyru.sum` 记录的不一样。要么是依赖被改过，要么是缓存被动过；构建会停下来而不是继续用下去。 |
| TY-IO-0104 | `%s declares package %s, but %s in the same directory declares %s` | 同一个目录里的两个文件声明了不同的包。 |
| TY-TYP-0095 | `cannot infer the type arguments of %s(%s)` | 泛型方法的类型参数推不出来：没有带类型的实参，也没有目标类型可用（lambda 参数最常见）。写出类型参数或者给一个带类型的实参。 |
| TY-TYP-0096 | `switch expression does not cover all possible input values` | switch **表达式**必须穷尽：`int`／`String` 选择子一定要有 `default`，枚举选择子要覆盖每一个常量。switch 语句不受此限。 |
| TY-TYP-0097 | `native methods %s and %s both need the C symbol %s` | 两个重载 native 方法编码后得到同一个 C 符号（例如类名 `AI` 与 `int[]`）。改名或者改参数类型。 |
| TY-TYP-0098 | `non-static %s cannot be referenced from a static context` | lambda 主体用到书写处的 `this`（含未限定的实例方法调用、裸字段名与 `super`），但 lambda 写在 static 方法或 static 初始化块里，没有实例可捕获。Java 同样拒绝。 |
| TY-TYP-0108 | （已移除） | JSON 绑定改由运行期读取类，没有“生成绑定”这个步骤。 |
| TY-TYP-0109 | （已移除） | 同上：`@SerializedName` 造成的同名在读取时才看得出来。 |
| TY-TYP-0112 | （已移除） | 从 JSON 读取的类由运行期建立，构造器的限制改在 `newInstance` 时浮现。 |
| TY-TYP-0111 | （已移除） | controller 的返回值一律由绑定写成 JSON，没有映射不了的类型。 |
| TY-TYP-0110 | （已移除） | 字段类型能不能绑定，是读取时才知道的事。 |
| TY-TYP-0114 | `not a statement: %s has no effect` | 没有副作用的表达式语句（JLS 14.8）。这个语言在换行处结束表达式，所以 `long x = a` 换行 `+ b` 是两个语句，第二个是安静的一元加号——`x` 少一项而没有任何消息。现在会报出来。 |
| TY-TYP-0113 | `resource type %s is not a subtype of AutoCloseable` | try-with-resources 的资源类型必须是 `AutoCloseable` 的子类型。隐含的 `close()` 是一次接口调用，所以“刚好有 `close()` 方法”的类会编译成对象没有条目的 itable 调用，运行期才爆。 |
| TY-TYP-0115 | `cannot resolve import %s` | 导入路径指不到任何东西。名字在 Teyru 里是按**简单名称**找的，前面写什么包都一样，所以 `import java.utli.List` 这种拼错的包以前是被安静地忽略、然后照样拿到 `List`。现在导入必须指向：标准库响应的包（`teyru` 本身，以及兼容用的 `java.util`、`com.google.gson`、`lombok`…，见 docs/language.md §11）、本次构建中某个文件声明的包，或者是一个完整名称就是这条路径的类型。 |
| TY-TYP-0100 | （已移除） | 容器改读类之后，重名 bean 在 `refresh()` 时被拒绝。 |
| TY-TYP-0101 | `%s is declared by the framework and cannot be redefined` | `__TeyruFramework` 是容器注册用的合成类，名字被保留。 |
| TY-TYP-0102 | `@Bean method %s must not be static`／`@Bean method %s must return the bean's type`／`@Bean method %s does not return a class type` | `@Bean` 方法必须不是 static、且返回类型是一个类（基本类型会装箱）。 |
| TY-TYP-0103 | （已移除） | 缺少 bean 现在是 `refresh()` 时的异常——Spring 也是启动时才发现。 |
| TY-TYP-0104 | （已移除） | 两个候选是 `refresh()` 时的异常，消息里带着两个名字。 |
| TY-TYP-0105 | （已移除） | 构造器选择改在运行期：标了 `@Autowired` 的、唯一的那个、或无参的那个。 |
| TY-TYP-0106 | （已移除） | `@PostConstruct` 的签名改在调用时才检查。 |
| TY-TYP-0107 | （已移除） | 依赖成环是 `refresh()` 时的异常，消息里有环。 |
| TY-TYP-0099 | `reference to %s is ambiguous: it is declared in both %s and %s` | 两个 `import p.*` 都提供同一个简单名称（JLS 6.5.5.1）。写出完整名称，或者用单类型导入（`import a.Widget`）消歧义。 |

## TY-PROP：原生 property

| 代码 | 消息 | 说明与修复方法 |
|---|---|---|
| TY-PROP-0001 | `a property declaration must declare exactly one name` | 一个 property 只能声明一个名称。 |
| TY-PROP-0002 | `duplicate get accessor`／`duplicate set accessor` | `get`／`set` 各只能出现一次。 |
| TY-PROP-0003 | `computed property %s cannot use storage modifiers` | 没有存储的 property 不能用 `final`／`volatile`／`transient`。 |
| TY-PROP-0004 | `final property %s cannot declare a setter` | `final` property 不能有 setter。 |
| TY-PROP-0005 | `property %s has no getter` | 只有 setter 的 property 不能被读取；在 accessor 内请用 `field`。 |
| TY-PROP-0007 | `property %s has no setter` | 只有 getter 的 property 不能被赋值。 |
| TY-PROP-0008 | `property %s needs a getter for compound assignment` | `p.x += 1` 需要 getter 和 setter。 |

## TY-INT 与 TY-IO

| 代码 | 消息 | 说明 |
|---|---|---|
| TY-INT-0001 | `prelude is missing class %s` | 前导库损坏或类被覆盖，属于编译器内部错误。 |
| TY-INT-0002 | `unsupported expression %T` | 语义分析遇到未处理的节点，属于编译器内部错误（请报告）。 |
| TY-INT-0004 | `@Singular goes on a builder field, not on the class` | 写在类上没有意义。 |
| TY-INT-0005 | `@Singular needs a List or Map field, found %s` | `@Singular` 只能用在集合字段。 |
| TY-INT-0006 | `@CustomLog needs %s in a %s file in the source file's directory or above it`／`@CustomLog cannot pass TYPE: …`／`@CustomLog: cannot resolve the factory class %q named by %s` | `@CustomLog` 要靠 `lombok.config` 的 `lombok.log.custom.declaration` 才知道怎么建 logger（读法见 docs/lombok.md）：没有这个键、样式用了 `TYPE`，或者样式指的类找不到，都在这里报。也可以改用 `@Log` 或自己声明字段。 |
| TY-IO-0001 | `cannot read %s: %v` | 源文件读不到，检查路径与权限。 |

## 运行期错误

运行期的失败不是诊断码，而是 `Throwable` 家族：

| 异常 | 触发时机 |
|---|---|
| `NullPointerException` | 对 `null` 拆箱，或者读写字段、调用方法（`String` 的方法、`clone()`、接口方法与虚调用都是）、读写数组元素或取 `length` |
| `ArrayIndexOutOfBoundsException` | 数组索引超出 `[0, length)`（读与写都是；`null` 数组先抛 `NullPointerException`） |
| `IndexOutOfBoundsException` | `ArrayList.get`／`set`／`remove` 的索引超出 `[0, size)` |
| `NoSuchElementException` | 已经没有元素却再调用 `Iterator.next()` |
| `ArithmeticException` | 整数除以零或取余数为零 |
| `ClassCastException` | `cast` 或 `instanceof` 失败的强制转换 |
| `NegativeArraySizeException` | 数组长度为负 |
| `AssertionError` | `assert` 失败 |
| `IllegalArgumentException` | `enum.valueOf` 找不到常量等 |

没有被 catch 的异常会打印出 `Exception in thread "main" …` 并以状态 1 结束。
如果执行到没有实现的抽象方法，会打印出 `teyru: no implementation for …` 并以状态 70 结束。
