---
title: "Native interop: writing Teyru native methods in C"
description: "A native method is a C function: the compiler generates the call and the declaration, you provide the definition, and the two are compiled into the same executable."
---

Teyru has no JNI, no FFI binding generator, and no runtime interpretation layer. A
`native` method is simply a C function: the compiler generates the call and the
declaration, you provide the definition, and the two are compiled into the same
executable.

```
program.teyru  ──┐
                 ├─► C ─► clang/LLVM ─► native executable
impl.c ──────────┘
```

## 1. Three steps

**Step one: declare the native method.** Write it inside an ordinary class; no body is
needed:

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

**Step two: have the compiler generate the declarations.**

```sh
teyru build --native-header native.h program.teyru -o program
```

When the program contains native methods and `--native` is not given, this command stops
once it has written the header file and does not attempt to link (linking would
inevitably fail with `undefined reference to 'tyn_...'`), so it finishes successfully and
leaves only the header file behind. Then just do step three.

`native.h` contains only the things you have to implement:

```c
#include "tyrt.h"

/* Native.add */
int32_t tyn_Native_add_I_I(int32_t a0, int32_t a1);

/* Native.greeting */
void * tyn_Native_greeting_String(void * a0);

/* Native.scale */
int32_t tyn_Native_scale_I(void *self, int32_t a0);
```

**Step three: implement it, then compile both together.**

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

There is a complete, runnable version in `tests/native/`; `go test -run TestNative`
compiles and runs it.

---

## 2. Symbol naming

```
tyn_<class>_<method>_<parameter types…>
```

- Class and method names are transcribed by `util.Mangle`: `.` and `$` become `_`.
- Parameter types are descriptors: `I` int, `J` long, `D` double, `F` float, `Z` boolean,
  `B` byte, `S` short, `C` char, `O` a type variable, and other classes use their simple
  name (for example `String`).
- Arrays are `A` **followed by the element descriptor**: `int[]` is `AI`, `int[][]` is
  `AAI`, `String[]` is `AString`.
- No parameters means no suffix. Overloads naturally get different names, and no extra
  rules are needed.

You do not have to derive this yourself: this is exactly the name that `--native-header`
generates.

---

## 3. Type mapping

| Teyru | C | Notes |
|---|---|---|
| `int` | `int32_t` | |
| `long` | `int64_t` | |
| `short` / `byte` | `int16_t` / `int8_t` | |
| `char` | `uint16_t` | UTF-16 code unit |
| `boolean` | `int32_t` | 0 or 1 |
| `float` / `double` | `float` / `double` | |
| `void` | `void` | |
| Objects, arrays, interfaces, generics | `void *` | Runtime representation, see the next section |
| Receiver of instance methods | `void *self` (first parameter) | Static methods have none |

Object parameters are always `void *`, so `native.h` does not depend on generated struct
names and can be included anywhere.

---

## 4. Reading and writing Teyru objects

An object is a C struct that starts with `tyobj`, with fields laid out flat in declaration
order (the parent class's fields come first). To read a field, declare the same prefix on
the C side:

```c
struct { tyobj obj; int32_t f_factor; } *me = self;
int32_t f = me->f_factor;
```

The `f_` prefix is the compiler's naming for fields, and `f_factor` is
`private int factor`. If you do not want to depend on the layout, just pass the value in
through an ordinary Teyru getter — the smaller the native interface, the less likely it is
to stop working when the compiler changes.

The common utilities the runtime offers to native code (all in `tyrt.h`):

| Function | Purpose |
|---|---|
| `ty_str_new(const char *bytes, int64_t len)` | Create a string |
| `ty_str_concat(tystr *a, tystr *b)` | Concatenate |
| `ty_str_len(tystr *s)` | The **UTF-16 code unit** count (`ulen`), which is what `String.length()` answers; native code that walks or writes bytes wants `ty_str_blen(s)` (`blen`) instead. The storage is WTF-8 with the bytes inline after the header (`TY_STR_DATA(s)`, no second pointer) -- see §12 item 12. An unpaired surrogate is the three-byte form, and `getBytes`/`println` write it as one `?` |
| `ty_array_new(int64_t len, int64_t elemsize)` | Create an array |
| `ty_array_len(tyarr *a)` | Array length |
| `ty_alloc(size_t)` | Allocate from the GC heap (collected automatically) |
| `ty_throw(void *e)` | Throw a Teyru exception |
| `ty_itab(void *obj, int selector)` | Get the function pointer for an interface method |

---

## 5. Callbacks: calling Teyru from C

`--native-header` also emits the selectors of interface methods (the values are assigned
by the compiler; the ones listed here are what they currently look like). The name is
`TY_SEL_<interface>_<method>_<parameter descriptor>`, and when a method has no parameters there is no
suffix (for example `TY_SEL_AUTOCLOSEABLE_CLOSE`):

```c
#define TY_SEL_TRANSFORM_TRANSFORM_I 275

int32_t tyn_Native_apply_Transform_I(void *t, int32_t v) {
  int32_t (*fn)(void *, int32_t) =
      (int32_t (*)(void *, int32_t))ty_itab(t, TY_SEL_TRANSFORM_TRANSFORM_I);
  return fn(t, v);
}
```

So C can call any Teyru object that implements the interface — including lambdas:

```teyru
Transform t = x -> x * 10
System.out.println(Native.apply(t, 4))   // 40
```

---

## 6. Other build options

| Flag | Purpose |
|---|---|
| `--native <file.c>` | Add a C file to compile together (repeatable) |
| `--link <arg>` | Arguments passed to the link step, for example `--link -lm` or `--link libfoo.a` |
| `--native-header <path>` | Generate declarations for native methods |
| `--cc <name>` | Use a different C compiler (default clang) |
| `--no-lto` | Disable LTO (falls back automatically when the toolchain does not support it) |

---

## 7. The one layer of the runtime that needs a native library: TLS

The runtime is self-contained — it depends on the C library and nothing else — **except for
TLS**. That layer is written on OpenSSL, so it is a file of its own
(`internal/runtime/src/tyrt_tls.c`): only when the program's **reachable** code can reach one
of its functions does the build compile it and add `-lssl -lcrypto`. A program that does not
use TLS therefore pays not one byte — this is the exception to "the runtime needs no library
you have to ship", and it is shut inside one file.

A program that uses `native` methods has nothing to do with this: that is your own C file and
`--native`, and what gets linked is your decision.

**This layer requires OpenSSL 1.1, and it is a preprocessor `#error`**, not a page of
undeclared identifiers:

```c
#if OPENSSL_VERSION_NUMBER < 0x10100000L
#error "the TLS layer needs OpenSSL 1.1 or newer (SSL_set1_host, BIO_meth_new, TLS_client_method and SSL_CTX_set_min_proto_version are not in 1.0.x)"
#endif
```

`SSL_set1_host`, `BIO_meth_new`, `TLS_client_method` and `SSL_CTX_set_min_proto_version` are
all absent from 1.0.x, so an old OpenSSL says so in one sentence while that file is being
compiled, rather than letting the user read "undeclared identifier" one identifier at a time
in a runtime file the user did not write.

**A target without OpenSSL is a named refusal, not a link failure.** Only POSIX has this
layer: `windows/amd64`'s mingw-w64 has no OpenSSL, and `darwin/amd64` and `darwin/arm64`'s
macOS ships SecureTransport — both are refused **before any output file is written**, with a
message naming the target, the reason and the targets that would work, rather than being left
to the linker to say `undefined reference to SSL_CTX_new` (which would name a symbol in a
library the author of the program never mentioned). What is refused is the **program**: as
soon as reachable code can reach this layer it does not build, and reachability is computed
from the generated C, so a program that uses reflection (carrying a table naming every class)
counts as reaching it even if it never calls TLS.

That is everything someone implementing a native method in C needs to know: this layer is not
a header you can include, it is a runtime file, and whether it goes into the executable is
decided by the compiler from reachability. The API, the policy and the tests are in "TLS" in
[docs/language.md](/en/docs/language).

---

## 8. Known limitations

- **No automatic bindings.** The header file is generated by the compiler and the
  implementation is yours to write; there is no C++ name mangling resolution, no
  structural descriptors, and no memory layout negotiation.
- **A `native` method cannot have a body.** Constructors can be native (the
  `String(String original)` in `lib/02_string.teyru` is), and `--native-header` declares
  it as well: the symbol is `tyn_<class>__init__<parameter descriptor>`, and the first parameter of an
  instance constructor is `void *self`.
- **The GC does not move objects, so the C side can safely keep a `void *` — but only
  while that object is still alive.** If you want to hold a reference on the C side for a
  long time, register a root with `ty_gc_register_static`; otherwise the collector will
  take the object away at the next collection.
- **`native.h` changes with the compiler version.** The symbol naming is stable, but the
  field `f_` layout is generated; if you use it as an ABI, you have to accept that.
