---
title: "JSON 与 Gson 兼容层"
description: "Gson 形状的树状 API，以及由编译器生成的对象绑定。"
---

Teyru 的 JSON 分成两层：`lib/10_json.teyru` 是 Gson 的**树状 API**（纯 Teyru，不需要
编译器配合），`lib/19_gson.teyru` 加上编译器的**对象绑定**。

## 树状 API（lib/10）

`JsonElement`、`JsonObject`、`JsonArray`、`JsonPrimitive`、`JsonNull`、
`JsonParser.parseString`、`Gson`、`GsonBuilder`、`JsonSyntaxException`，
行为对齐 Gson 2.10.0，包含几个容易做错的细节：

- `JsonNull` 继承 `JsonElement` 而不是 `JsonPrimitive`（Gson 2.10 的改动）。
- 解析后的数字保留原始字面量，所以 `1e5` 打印回来还是 `1e5`，不会变成 `100000.0`。
- 转义规则照 Gson 的替换表：`"` 与 `\` 会转义、五个短形式 `\b \t \n \f \r`、
  其余小于 0x20 的用 `\u00xx`（小写十六进制）、`/` **不**转义、非 ASCII 以 UTF-8
  输出而不是 `\u` 转义，只有 U+2028／U+2029 例外；`<`、`>`、`&`、`=`、`'` 只在
  htmlSafe 的写法（默认的 `new Gson()`）下转义，`JsonElement.toString()` 不转义。
- 空对象与空数组在 pretty print 时保持一行（`{}`、`[]`）。

与 Gson 的差异（刻意的）：

- `JsonParser.parseString` 是严格的（RFC 8259）。Gson 宽松模式接受的 `{a:1}`、
  `'单引号'`、`01`、`+1`、`.5`、`1.`、`NaN`、`[1,]` 一律拒绝并抛出
  `JsonSyntaxException`；空文档也拒绝，尾端多余数据一律拒绝。
- `entrySet()` 返回 `List<JsonMember>`、`keySet()` 返回 `List<String>`（Gson 给的是
  `Set`）；`JsonMember` 的 `getKey`／`getValue` 对应 `Map.Entry`。
- 数字只到 `long`，没有 `getAsBigDecimal`／`getAsBigInteger`。
- 数值访问器抛出 `IllegalArgumentException` 而不是 `NumberFormatException`
  （标准库没有后者；前者是它的父类，所以 catch 父类的代码不受影响）。

## 对象绑定（lib/19 加上编译器）

Gson 用反射把对象绑定到 JSON。这里**编译器代劳**：

```teyru
import teyru.*

class Address {
  String city
  String zip
}

class Person {
  String name
  int age
  @SerializedName("home_address") Address address
}

Gson gson = new Gson()
Person p = gson.fromJson(json, Person.class)   // 不需要 cast
String out = gson.toJson(p)
```

编译器看到 `fromJson(s, Person.class)` 就在 `Person` 上生成
`__teyruJsonRead(JsonElement)` 与 `__teyruJsonWrite()`，并把调用改写成它们。因此：

- **不需要 cast**：Gson 的 `<T> T fromJson(String, Class<T>)` 在 Teyru 无法表达
  （`Class` 不是泛型），但改写后的返回类型就是目标类本身。
- **字段类型没有映射是编译错误**（`TY-TYP-0110`；`List`／`Map` 这类 prelude 类是
  `TY-TYP-0108`），而不是运行时从反射适配器深处抛出的 `IllegalArgumentException`。
- 绑定是**按调用点生成**的：没有用到就不生成，而且字段列表是生成当时的（Lombok
  生成的成员也在内）。

支持的字段类型：`String`、`boolean`/`byte`/`short`/`char`/`int`/`long`/`float`/
`double` 与其装箱类型、enum（写成常量名称，读回来比对名称，与 Gson 相同）、其他
可绑定的类（递归）、`Object`（保留原始树：读进来的 `JsonObject` 原样写回去）。
`char` 和 Gson 一样写成单字符字符串、也从字符串读回来。`@SerializedName` 可以改名。
**不支持**：`List`／`Map`／数组字段、`@Expose`／`@Since`／`@Until`／`@JsonAdapter`
（已声明但未实现，用了不会有作用）。

### 运行时回退表

静态类型是 `Object` 的引用（`gson.toJson(someObject)`）编译器看不穿，这时走
`JsonBinding` 这张表：每个生成过绑定的类在自己的静态初始化里注册reader／
writer，查表用对象自己的类——这正是 Gson 反射给出的答案。

`Object` 可以装着程序里的任何类，所以**这种调用点一出现，编译器就替程序中声明的
每个类都生成一份绑定**（接口、抽象类、没有无参构造函数又无法从 JSON 读取的
类除外；那些生成不出来的就不登记，运行时问到会说没有绑定）。没有这个调用点的
程序仍然只为真正用到的类生成绑定。

## 相关测试

- `tests/programs/t93_json.teyru` — 树状 API：转义、数字、pretty print、往返。
- `tests/programs/t101_gson.teyru` — 对象绑定：嵌套类、`@SerializedName`、
  缺字段、运行时回退表。
- `tests/programs/t140_json_binding_edges.teyru` — 边界：`char` 往返、`Object`
  字段里的树、只通过 `Object` 传递的类、enum 与未知的常量名称。
