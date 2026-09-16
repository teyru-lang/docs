---
title: "原生互操作：用 C 编写 Teyru 的 native 方法"
description: "native 方法就是一个 C 函数：编译器生成调用与声明，你提供定义，两者一起编译成同一个可执行文件。"
---

Teyru 没有 JNI、没有 FFI 绑定生成器，也没有运行期解释层。`native` 方法就是一个
C 函数：编译器生成调用、生成声明，你提供定义，两者一起编译成同一个可执行文件。

```
program.teyru  ──┐
                 ├─► C ─► clang/LLVM ─► 原生可执行文件
impl.c ──────────┘
```

## 1. 三个步骤

**第一步：声明 native 方法。** 写在普通的类里，不需要 body：

```teyru
class Native {
  public static native int add(int a, int b)
  public static native String greeting(String who)
  public native int scale(int v)

  private int factor

  public Native(int factor) {
    this.factor = factor
  }
}
```

**第二步：让编译器生成声明。**

```sh
teyru build --native-header native.h program.teyru -o program
```

程序里有 native 方法又没给 `--native` 时，这个命令写完头文件就停下来，不会尝试链接
（链接必定会以 `undefined reference to 'tyn_...'` 失败），所以它会成功结束，只留下
头文件。接着做第三步即可。

`native.h` 只包含你必须实现的东西：

```c
#include "tyrt.h"

/* Native.add */
int32_t tyn_Native_add_I_I(int32_t a0, int32_t a1);

/* Native.greeting */
void * tyn_Native_greeting_String(void * a0);

/* Native.scale */
int32_t tyn_Native_scale_I(void *self, int32_t a0);
```

**第三步：实现，然后一起编译。**

```c
#include "tyrt.h"
#include "native.h"

int32_t tyn_Native_add_I_I(int32_t a, int32_t b) { return a + b; }

void *tyn_Native_greeting_String(void *who) {
  tystr *prefix = ty_str_new("hello, ", 7);
  return ty_str_concat(prefix, (tystr *)who);
}

int32_t tyn_Native_scale_I(void *self, int32_t v) {
  struct { tyobj obj; int32_t f_factor; } *me = self;
  return v * me->f_factor;
}
```

```sh
teyru build --native impl.c --native-header native.h program.teyru -o program
```

`tests/native/` 有一份完整可运行的版本，`go test -run TestNative` 会编译并执行它。

---

## 2. 符号命名

```
tyn_<类>_<方法>_<参数类型…>
```

- 类与方法名由 `util.Mangle` 转写：`.` 与 `$` 变成 `_`。
- 参数类型是描述符：`I` int、`J` long、`D` double、`F` float、`Z` boolean、
  `B` byte、`S` short、`C` char、`O` 类型变量，其他类用其简单名称
  （例如 `String`）。
- 数组是 `A` **再加元素描述符**：`int[]` 是 `AI`、`int[][]` 是 `AAI`、
  `String[]` 是 `AString`。
- 没有参数就没有后缀。重载会自然得到不同的名字，不需要额外规则。

不必自己推导：`--native-header` 生成的就是这个名字。

---

## 3. 类型对应

| Teyru | C | 备注 |
|---|---|---|
| `int` | `int32_t` | |
| `long` | `int64_t` | |
| `short` / `byte` | `int16_t` / `int8_t` | |
| `char` | `uint16_t` | UTF-16 码元 |
| `boolean` | `int32_t` | 0 或 1 |
| `float` / `double` | `float` / `double` | |
| `void` | `void` | |
| 对象、数组、接口、泛型 | `void *` | 运行期表示法，见下节 |
| 实例方法的接收者 | `void *self`（第一个参数） | 静态方法没有 |

对象参数一律是 `void *`，所以 `native.h` 不依赖生成出来的 struct 名称，
可以在任何地方 include。

---

## 4. 读写 Teyru 对象

对象就是以 `tyobj` 开头的 C struct，字段按声明顺序平铺（父类的字段在前）。
要读字段就在 C 端声明同样的开头：

```c
struct { tyobj obj; int32_t f_factor; } *me = self;
int32_t f = me->f_factor;
```

`f_` 前缀是编译器对字段的命名，`f_factor` 就是 `private int factor`。
如果不想依赖布局，把值用一般的 Teyru getter 传进来就好——原生的接口
越小，越不容易随编译器改动而失效。

运行期提供给原生代码的常用工具（都在 `tyrt.h`）：

| 函数 | 用途 |
|---|---|
| `ty_str_new(const char *bytes, int64_t len)` | 创建字符串 |
| `ty_str_concat(tystr *a, tystr *b)` | 拼接 |
| `ty_str_len(tystr *s)` | 长度 |
| `ty_array_new(int64_t len, int64_t elemsize)` | 创建数组 |
| `ty_array_len(tyarr *a)` | 数组长度 |
| `ty_alloc(size_t)` | 从 GC 堆分配（会被自动回收） |
| `ty_throw(void *e)` | 抛出 Teyru 异常 |
| `ty_itab(void *obj, int selector)` | 获取接口方法的函数指针 |

---

## 5. 回调：从 C 调用 Teyru

`--native-header` 也会输出接口方法的 selector（数值由编译器分配，这里列出的是目前的
样子）。名字是 `TY_SEL_<接口>_<方法>_<参数描述符>`，方法没有参数时就没有后缀
（例如 `TY_SEL_AUTOCLOSEABLE_CLOSE`）：

```c
#define TY_SEL_TRANSFORM_TRANSFORM_I 275

int32_t tyn_Native_apply_Transform_I(void *t, int32_t v) {
  int32_t (*fn)(void *, int32_t) =
      (int32_t (*)(void *, int32_t))ty_itab(t, TY_SEL_TRANSFORM_TRANSFORM_I);
  return fn(t, v);
}
```

于是 C 可以调用任何实现该接口的 Teyru 对象——包括 lambda：

```teyru
Transform t = x -> x * 10
System.out.println(Native.apply(t, 4))   // 40
```

---

## 6. 其他构建选项

| 标志 | 用途 |
|---|---|
| `--native <file.c>` | 加入一个 C 文件一起编译（可重复） |
| `--link <arg>` | 传给链接步骤的参数，例如 `--link -lm` 或 `--link libfoo.a` |
| `--native-header <path>` | 生成 native 方法的声明 |
| `--cc <name>` | 更换 C 编译器（默认 clang） |
| `--no-lto` | 关闭 LTO（工具链不支持时会自动回退） |

---

## 7. 运行期唯一需要原生函数库的一层：TLS

运行期是自足的——它只依赖 C 函数库——**除了 TLS**。那一层写在 OpenSSL 上，所以它是
一个自己的文件（`internal/runtime/src/tyrt_tls.c`）：只有程序的**可达**代码碰得到
它的其中一个函数时，构建才编译它、才加上 `-lssl -lcrypto`。不用 TLS 的程序因此一个
字节都不付——这是「运行期不需要附带的函数库」这个原则的例外，而它被关在一个文件里。

用 `native` 方法的程序与这件事无关：那是你自己的 C 文件与 `--native`，要链接什么由你
决定。

**这一层的要求是 OpenSSL 1.1，而它是一个预处理器的 `#error`**，不是一页未声明的
标识符：

```c
#if OPENSSL_VERSION_NUMBER < 0x10100000L
#error "the TLS layer needs OpenSSL 1.1 or newer (SSL_set1_host, BIO_meth_new, TLS_client_method and SSL_CTX_set_min_proto_version are not in 1.0.x)"
#endif
```

`SSL_set1_host`、`BIO_meth_new`、`TLS_client_method` 与
`SSL_CTX_set_min_proto_version` 都不在 1.0.x 里，所以旧的 OpenSSL 在编译那个文件时
用一句话讲清楚，而不是让使用者在一个他没写过的运行期文件里逐个标识符地读「未声明的
标识符」。

**没有 OpenSSL 的目标是具名拒绝，不是链接阶段失败。** 只有 POSIX 有这一层：
`windows/amd64` 的 mingw-w64 没有 OpenSSL，`darwin/amd64` 与 `darwin/arm64` 的 macOS
出的是 SecureTransport——两者都在**写出任何输出文件之前**被拒绝，消息指名目标、原因与
可以改用的目标，而不是留给链接器去说 `undefined reference to SSL_CTX_new`（那会指名
一个程序作者从没提过的函数库里的符号）。被拒绝的是**程序**：只要可达代码碰得到这一
层就编不出来，而可达性是生成出来的 C 算的，所以会用到反射的程序（带着指名每个类的
表格）即使从不调用 TLS 也算碰得到。

以 C 实现 native 方法的人要知道的就是这些：这一层不是你可以 include 的头文件，它是一
个运行期文件，而它进不进可执行文件由编译器依可达性决定。API、政策与测试见
[docs/language.md](/zh-CN/docs/language) 的〈TLS〉。

---

## 8. 已知限制

- **没有自动绑定。** 头文件由编译器生成，实现要自己写；没有 C++ 名称修饰解析、
  没有结构体描述符、没有内存布局协商。
- **`native` 方法不能有 body。** 构造方法可以是 native（`lib/02_string.teyru` 的
  `String(String original)` 就是），`--native-header` 会一并声明它：符号是
  `tyn_<类>__init__<参数描述符>`，实例构造方法的第一个参数是 `void *self`。
- **GC 不会移动对象，所以 C 端可以放心保存 `void *`——但只在那个对象还活着的时候。**
  如果要在 C 端长期持有引用，请用 `ty_gc_register_static` 注册一个根，
  否则回收器会在下次回收时把对象收走。
- **`native.h` 会随编译器版本变动。** 符号命名稳定，但字段 `f_` 布局是生成出来的；
  把它当 ABI 用就要接受这件事。
