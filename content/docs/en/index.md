---
title: "Teyru"
description: "Teyru is an independently implemented programming language whose compiler is written entirely in Go and emits native executables directly — no JVM, no javac, no bytecode."
---

[繁體中文](/docs) · [简体中文](/zh-CN/docs) · **English**

**Teyru is an independently implemented programming language whose compiler is written entirely in Go and emits native executables directly — no JVM, no javac, no bytecode.**

The syntax will feel familiar to Java developers (classes, interfaces, generics, lambdas,
exceptions, records, enums, annotations), but Teyru drops semicolons, adds native
properties, and runs as **native machine code**: the compiler lowers the whole program to
C and hands it to clang/LLVM (or gcc). The runtime is about 5000 lines of C — a
conservative mark-and-sweep collector, strings, arrays and exceptions — with no virtual
machine of any kind.

```
Teyru source (.teyru)
      │  Go compiler: lexer → parser → semantic analysis → C generator
      ▼
  generated C  ──clang (Clang front end + LLVM middle/back end)──▶  LLVM IR  ──▶  native executable
                                                                        (no JVM, no bytecode)
```

The back end **is LLVM**: `./teyru emit-llvm` prints the IR module so it can go straight
into `opt`, `llc` or a custom pass; `./teyru emit` prints the generated C.

**Docs:** [Language reference](/en/docs/language) · [Native interop](/en/docs/native) · [Lombok layer](/en/docs/lombok) · [Diagnostics](/en/docs/diagnostics) · [Compiler architecture](/en/docs/architecture) · [Contributor rules](https://github.com/teyru-lang/Teyru/blob/main/AGENTS.md)

---

## Contents

- [Why it is faster than the JVM](#why-it-is-faster-than-the-jvm)
- [Quick start](#quick-start)
- [Language tour](#language-tour)
- [Language features](#language-features)
- [Standard library](#standard-library)
- [Editors and tooling](#editors-and-tooling)
- [Project layout](#project-layout)
- [Runtime model](#runtime-model)
- [Differences from Java](#differences-from-java)
- [Command line interface](#command-line-interface)
- [Development](#development)
- [License](#license)

---

## Why it is faster than the JVM

Measured on one machine (AMD Ryzen 7 5700X, Linux x86-64, clang 22.1.8, OpenJDK 21.0.11
Temurin; produced by `RUNS=5 sh scripts/bench.sh`, best of 5 runs per row. The numbers are
**wall-clock whole-program times, including process startup**):

| Metric | Teyru (native) | Java (HotSpot) | Difference |
|---|---|---|---|
| 100 startups | **0.0769 s** (0.77 ms each) | 1.9982 s (20.0 ms each) | **~26x faster** |
| Executable size (`-O2`) | **54.6 KB** | — | — |
| Peak RSS (hello) | **4232 kB** | 51124 kB | **~12.1x less** |
| `bench_fib` recursion | **0.0062 s** | 0.0266 s | **~4.3x faster** |
| `bench_loop` loops and integer math | **0.0243 s** | 0.0435 s | **~1.8x faster** |
| `bench_oop` objects and virtual calls | **0.0051 s** | 0.0260 s | **~5.1x faster** |
| `bench_string` string handling | **0.0153 s** | 0.0632 s | **~4.1x faster** |
| `bench_alloc` short-lived allocation | **0.0278 s** | 0.0304 s | **~1.09x faster** |
| `bench_invoke` 20M reflective calls (see `examples/bench_invoke.teyru`) | **0.6019 s** | 0.2543 s | **~2.4x slower** |

The `bench_invoke` row is now measured by the same script as every other row. It was not before: the Java file's class name did not match its filename, so the harness silently skipped the run and printed `-` in the Java column. That was a real defect in the script, and it is fixed (commit `1ad9b8c`); the harness now also prints `!no-class` instead of `-` when a Java file produces no runnable class. The row shows that the `Method.invoke` path is still about 2.4x slower than HotSpot's.

`bench_loop` fell from about 2.2x in the previous revision to about 1.8x because every loop back-edge now carries a safepoint check — the deliberate cost of a stop-the-world collector, which is **cooperative** here, as [docs/language.md](/en/docs/language) §11 explains. It is not measurement noise.

**The size row is a strength again, and the reason for the number is specific.** It is the
same hello world built with `-O2` and measured with `wc -c`: 55,920 bytes today (about
54.6 KB). The number comes from the compiler **pruning the vtable slots nothing dispatches**
— the mechanism is written up in [docs/architecture.md](/en/docs/architecture), under "Why
every binary carries the prelude". The number's history: 48,840 bytes at `74fa648` (9/13),
501,072 before any pruning, 95,832 with the first version (which only asked whether a slot
was dispatched at all), and 55,920 now, which also asks whether the class could be the
receiver of that dispatch. The 501,072 build had 1,262 functions surviving in a hello world,
951 of them prelude methods, only 42 reachable by being called — the rest were alive by
address through a vtable.

**The number only means anything with its optimisation level.** The same hello world is
75,232 bytes at `-O1`, 55,920 at `-O2` and 59,408 at `-O3`; this row and `scripts/bench.sh`
both use `-O2`, which is the default.

Before and after, on one machine with `-O2`: a hello world goes 501,072 -> 95,832 -> 55,920;
`t84_sealed_switch` 521,456 -> 113,904 -> 74,888, `t133_arrow_blocks` 509,536 -> 105,688 ->
61,064 and `t51_java25_tour` 523,696 -> 438,560 -> 253,328, with their output byte-identical
throughout. **A program that reflects is unaffected**: `t146_reflect` is 4,859,976 bytes and
`t101_gson` 4,823,592, the same before and after the pruning, because reflection attaches
every member table from `main` — which is why "reflection carries about 3 MB" still holds
below, and what the pruning buys is the size of programs that do not reflect. Speed did not
measurably change: six benchmarks, interleaved over twenty runs, every difference inside the
noise with all checksums identical.

**Where the floor is, and why it is not lower.** The C the pruned hello world emits has 628
vtable arrays; every one of them still answers slots 0, 1 and 2, and exactly **one** has a
filled slot at index 3 or above — `Class`'s own, for indices 7, 12, 13 and 16, because it is
the only class that can be a receiver of that dispatch. Slots 0, 1 and 2 stay filled for every
class and **cannot** be narrowed the same way: the runtime reads them by index on whatever it
is handed as `void *`/`tyobj *` (`print_uncaught` and the string helpers take `[0]`,
`ty_obj_hash` `[1]`, `ty_obj_equal` `[2]`), so their owner is the hierarchy root, and going
further would need the fact that a class is never instantiated, which the emitted C does not
decide — and a wrong answer there is a jump to `NULL` rather than a wasted byte.



**Where the speed comes from:**

1. **No JVM startup.** No class loading, no JIT warmup, no GC threads to spawn.
   That suits CLI tools, short-lived processes, container startup and serverless.
2. **Compile-time work stays at compile time.** Generics are erased, calls are
   addressed statically, string constants are allocated statically, `static final`
   constants are folded, and the compiler fills in the vtables and interface tables.
3. **No bytecode interpreter.** clang/LLVM optimises the whole program up front
   (LTO inlining across the module, constant propagation, loop vectorisation)
   instead of waiting for a JIT to find hot spots.
4. **Objects that do not need an allocation do not get one.** Escape analysis puts
   an object that stays inside its method on the C stack, and LLVM then promotes its
   fields to registers and deletes the object, the same result a JVM gets from scalar
   replacement. That is what makes `bench_alloc` faster than HotSpot.
5. **Allocation and bounds checks take an inlined fast path.** `ty_alloc` bumps a
   pointer inline in the header, array access only calls the slow path when it must,
   the collector releases chunks that are completely empty, and class initialisation
   tests a single flag.
6. **Predictable performance.** No deoptimisation, no warmup curve, no GC tuning.

**The honest boundary.** Escape analysis only covers objects that stay inside the
method that creates them. An object stored into a field, an array, a return value or
another object still goes to the heap and the mark-and-sweep collector, and HotSpot's
generational assumption wins on workloads where objects live long and are collected
repeatedly. Every number above includes process startup, so the absolute values are
small. Every number is reproducible with `sh scripts/bench.sh`, which measures the six
programs, the 100 startups, the executable size and the peak RSS, best of `RUNS=5` on the
machine above.

The size row measures a hello world, and its number is the one that will change when the
pruning is in the compiler: what the script measures is what the compiler produced from the
tree it ran on.

---

## Quick start

You need **Go 1.26+** and **clang** (or gcc).

```sh
# Build the compiler
go build -o teyru ./cmd/teyru

# Compile and run
./teyru run hello.teyru

# Produce an executable
./teyru build -O2 -o hello hello.teyru
./hello

# Inspect the generated C
./teyru emit hello.teyru

# Inspect the LLVM IR the back end feeds to LLVM (works with opt/llc)
./teyru emit-llvm hello.teyru

# Version
./teyru version
```

`hello.teyru`:

```teyru
class Hello {
  public static void main(String[] args) {
    System.out.println("Hello, Teyru!")
  }
}
```

Note: **Teyru has no semicolons.** Statements end at a newline, and a `for` header uses
two colons to separate its three parts.

---

## Language tour

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
  public double radius {      // native property
    get {
      return field            // field = backing storage
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

    // lambdas and method references
    Fn<Integer> f = (v) -> v + 1
    Fn<Integer> g = Main::twice
    System.out.println(f.apply(41))
    System.out.println(g.apply(21))

    // switch expressions and type patterns
    Color c = Color.GREEN
    String name = switch (c) {
      case RED -> "red"
      case GREEN -> "green"
      default -> "other"
    }
    System.out.println(name)
    System.out.println(describe(c))

    // exceptions
    try {
      System.out.println(10 / 0)
    } catch (ArithmeticException e) {
      System.out.println("division by zero")
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

### Java 25 syntax coverage

Teyru tracks the final (non-preview) Java SE 25 syntax and keeps Java semantics,
dropping only semicolons and adding native properties:

| JEP | Feature | Status |
|---|---|---|
| 512 | Compact source files, instance `main`, implicit `java.io.IO` (`println`/`print`/`readln`) | ✅ |
| 511 | `import module java.base` (parsed and ignored; no module system at run time) | ✅ parsed |
| 513 | Flexible constructor bodies (statements before `super()`) | ✅ |
| 440 | Record patterns (including nested and in `instanceof`) | ✅ |
| 441 | Pattern matching for switch with `when` guards | ✅ |
| 507 | Primitive type patterns (`case int i`, `o instanceof int i`, exact conversions; Java 25 still has this as a preview feature) | ✅ |
| 456 | Unnamed variables and patterns `_` | ✅ |
| 395 | Records (including compact constructors) | ✅ |
| 394 | `instanceof` patterns | ✅ |
| 409 | Sealed classes (`sealed`/`permits`/`non-sealed`) | ✅ parsed |
| 378 | Text blocks | ✅ |
| 361 | Switch expressions | ✅ |
| 286 | `var` local type inference | ✅ |

### Lombok compatibility

The compiler has Lombok built in. Annotations are expanded during semantic analysis
into ordinary Teyru members, which then take the same type-checking and code
generation path as hand-written code — no annotation processor is involved.

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

The full list and the differences are in **[docs/lombok.md](/en/docs/lombok)**:
`@Getter`/`@Setter`/`@ToString`/`@EqualsAndHashCode`/`@Data`/`@Value`/`@Builder`/
`@NonNull`/`@Cleanup`/`@SneakyThrows`/`@Synchronized`/`@With`/`@Accessors`/
`@FieldDefaults`/`@UtilityClass`/`@StandardException`/the `@Log` family/
`@ExtensionMethod`/`@FieldNameConstants`/`@Delegate`/`@Helper`/`@Tolerate`/`@Locked`/
`@NonFinal`/`@PackagePrivate` are all supported, including `@Singular`
(accumulate one at a time, add a whole collection, clear, and build() takes a
copy), `@SuperBuilder` over a whole hierarchy, and `@Builder.ObtainVia`.

### Language features

| Area | What is supported |
|---|---|
| Types | Primitives, classes, interfaces, enums, records, annotation types, generics (bounds, wildcards, diamond, generic methods), multi-dimensional arrays |
| Members | Fields, methods, constructors, varargs, static and instance initialiser blocks, nested/inner/local/anonymous classes, `sealed`/`permits` |
| Statements | `if`, `while`, `do-while`, basic `for` (colon header), enhanced `for`, `switch` (statement and expression, arrow and colon form, multi-label, enum, string, type patterns with `when` guards), `try`/`catch`/`finally`, try-with-resources, multi-catch, `throw`, `yield`, `assert`, `synchronized`, labels with `break`/`continue` |
| Expressions | Full operator set and precedence, conditional, casts, `instanceof` (including patterns), lambdas, method references (static, bound, unbound, constructor), anonymous classes, array initialisers, string concatenation, automatic boxing/unboxing |
| Native extensions | Semicolon-free syntax, `val` (inferred, non-reassignable local), `var`, native properties (`get`/`set`/`field`), colon-separated `for` header, newline-separated try-with-resources |

The complete syntax and semantics live in **[docs/language.md](/en/docs/language)**.

---

## Standard library

The standard library is written **in Teyru itself** (`lib/*.teyru`) and is compiled
and checked together with every program. It is one Teyru package (`teyru`), so an import
is one line: `import teyru.*` (or `import teyru.List` when a single class is all you
name). Java's spelling (`import java.util.*`, `import java.util.List`) is accepted too —
what is Java-compatible is **the import**. "Java source compiles unchanged" is **not**
claimed here: the differences between Java source and this compiler are listed in §12 of
the language reference (the syntax, whose first item is the semicolon) and §13 (the APIs
that are missing and the forms that are refused), and those two sections are what such a
claim would have to be limited to. They are not empty today. The claim becomes someone's
to write once those entries are gone and `tests/` programs stand behind it:

| Package | Contents |
|---|---|
| `java.lang` | `Object`, `Class`, `String` (`format`/`join`/`valueOf`/…), `StringBuilder`, `Math`, `System`, `PrintStream`, the eight wrappers and `Number`, the `Throwable` family, `Enum`, `Record` |
| `java.util` | `List`/`ArrayList`/`LinkedList`, `Set`/`HashSet`/`LinkedHashSet`/`TreeSet`, `Map`/`HashMap`/`LinkedHashMap`/`TreeMap`, `Deque`/`ArrayDeque`, `Arrays`, `Collections`, `Objects`, `Optional`, `StringJoiner`, `Properties`, `Random`, `UUID`, `BitSet`, `StringTokenizer` |
| `java.time` | `LocalDate`/`LocalTime`/`LocalDateTime`/`Instant`/`Duration`/`Period`; time zones are `ZoneId`/`ZoneOffset`/`ZoneRules`/`ZonedDateTime`, reading the host's own tzdata |
| `java.io` | `File`, `Path`/`Paths`, `Files` |
| `java.util.regex` | `Pattern`/`Matcher` |
| `java.net` | `ServerSocket`, `Socket` and their streams; TLS is a layer on that same path (`TlsSocket`/`Tls`/`TlsServer`/`TlsException`, using OpenSSL, POSIX only) |
| `java.util.stream` | `Stream`/`IntStream`/`LongStream`/`DoubleStream`, `Collectors`, `Collector`, `Spliterator`; lazy, entered through `Collection.stream()` |
| `java.math` | `BigInteger`, `BigDecimal`, `MathContext`, `RoundingMode` |
| `java.text` | `NumberFormat`/`DecimalFormat` (the full pattern language), `DateFormat`/`SimpleDateFormat`, `DateTimeFormatter`, `MessageFormat`; ROOT/en-US only, `format` takes an `Instant` |
| `java.io` streams | `Reader`/`Writer`/`OutputStream`, `ByteArrayInputStream`/`ByteArrayOutputStream`, `DataInputStream`/`DataOutputStream` (`writeUTF`/`readUTF` are Java's modified UTF-8), `BufferedReader`, `PrintWriter` |
| `java.util.HexFormat` | `of`/`ofDelimiter`, the `with*` mutators, `formatHex`/`parseHex`, `toHexDigits` and the digit classifications |
| `java.util.Scanner` | Reads one `String`: `hasNext`/`next` with the int, long and double forms, plus `nextLine` |
| `java.security` | `MessageDigest` (MD5, SHA-1/224/256/384/512, implemented in Teyru), plus `java.util.zip`'s `Checksum` and `CRC32` |
| `java.util.zip` | `Deflater`/`Inflater` (levels 0-9, zlib-wrapped or raw), `Adler32`, `GZIPOutputStream`/`GZIPInputStream`; RFC 1951 deflate is written in Teyru, and the web layer compresses responses with it |
| `java.util.zip` archive | `ZipEntry`/`ZipOutputStream`/`ZipInputStream`/`ZipFile`; an archive written here is read by the JDK and by Info-ZIP's `unzip` |
| `java.util.concurrent` | The executors (`Executors`/`Future`/`ThreadPool`) and the synchronizers (`CountDownLatch`, `AtomicInteger`/`AtomicLong`, `ConcurrentHashMap`); all monitors, nothing lock-free |
| `com.google.gson` | Gson's tree API plus an object binding that reads the class's fields at run time ([docs/json.md](/en/docs/json)) |
| threads | `Thread`/`Runnable`, real `synchronized` (including the method modifier) and `Object.wait`/`notify`/`notifyAll` ([docs/language.md](/en/docs/language) §11) |
| framework | A Spring-shaped container and web layer: settings and profiles, `@ControllerAdvice`, interceptors, static files, CORS, `ResponseEntity`, `MockServer`, WebSocket, sessions, multipart uploads, validation annotations, and an accept loop that runs on a thread ([docs/framework.md](/en/docs/framework)) |

Collections are written in Teyru, so `for` works on them directly:

```teyru
List<String> names = new ArrayList<String>()
names.add("ada")
names.add("grace")
for (String n : names) {
  System.out.println(n)
}
```

Dependencies are declared in `teyru.mod` and fetched and verified the way Go does
it ([docs/modules.md](/en/docs/modules)):

```sh
teyru mod init example.com/app
teyru get example.com/greeting@v0.1.0
teyru build ./...
```

There is no single list of what the standard library is missing: every gap is stated where
it belongs, in the package row or section about it ([docs/language.md](/en/docs/language)
§11), and each one is a decision — `MessageDigest` has no SHA-3, `Scanner` reads a `String`
only, a leap-second file is refused, and a host without tzdata gets a named refusal.

For your own native library, declare a `native` method and implement it in C:

```teyru
class Native {
  public static native int add(int a, int b)
}
```
```sh
teyru build --native-header native.h program.teyru   # the declarations to implement
teyru build --native impl.c program.teyru            # compile together
```

See [`docs/native.md`](/en/docs/native).

---

## Editors and tooling

- **VS Code**: the `vscode/` directory of the
  [`teyru-lang/editors`](https://github.com/teyru-lang/editors) repository adds TextMate
  syntax highlighting, language configuration and snippets for `.teyru` files. Package it with
  `npx @vscode/vsce package` and install the result with
  `code --install-extension teyru-0.1.0.vsix`.
- **tree-sitter**: `tree-sitter-teyru/` in the same repository is a complete grammar with
  highlight queries, indentation queries and corpus tests, usable from Neovim,
  Helix, Zed and anything else that loads tree-sitter parsers.
- **GitHub's language statistics** are decided by `.gitattributes`: `*.teyru` is
  declared `linguist-language=Teyru`, while `*.java.ref` (that is the spec — the
  `.expected` files are produced from javac's output) and `*.expected` (test data)
  are marked as not counted. Before that correction "Java" was the largest language
  in this repository and it barely existed. **What has to be said clearly is that
  the `linguist-language` line does not make Teyru appear**: Linguist only counts
  the languages it knows, so Teyru is still not an entry in the statistics, and it
  will not be until the language itself and the grammar in `teyru-lang/editors` are
  taken upstream.

---

## Project layout

| Path | Purpose |
|---|---|
| `cmd/teyru` | CLI entry point (`build`/`run`/`emit`/`emit-llvm`/`get`/`mod`/`version`) |
| `internal/driver` | Compile pipeline: wires the front end to the C back end, runs the C compiler, handles native sources and output options |
| `internal/source` | Files, position mapping, diagnostics |
| `internal/lexer` | Tokeniser; newlines are not tokens, each token carries a "newline before" flag |
| `internal/parser` | Recursive descent; statement termination uses newline significance plus prefix completeness |
| `internal/ast` | Syntax tree, symbols (class/method/field/variable), types |
| `internal/sema` | Name resolution, type checking, erasure and inference, overload resolution, vtable/selector layout, property lowering |
| `internal/codegen` | Two back ends: C (the default; classes to structs, virtual calls to vtables, interface calls to itables, GC root info) and LLVM (`--backend=llvm`; emits the program's own IR module) |
| `internal/util` | Shared helpers: name mangling, type descriptors, C layout |
| `internal/runtime/src` | C runtime: GC, strings, arrays, exceptions, boxing, threads and monitors, sockets; its operating-system half is `tyrt_plat.h`, implemented for POSIX and Windows. TLS is in `tyrt_tls.c` — the one file that links OpenSSL, compiled and linked only when the program's reachable code can reach it |
| `lib` | Standard library, written in Teyru |
| `tests/programs` | End-to-end programs plus expected output (`go test` compiles and diffs each one) |
| `tests/native` | Native-method interop test: Teyru declarations, a C implementation and the expected output (`TestNative`) |
| `examples` | Examples and the JVM comparison benchmarks (`bench_*.teyru` and `.java`) |
| `scripts` | Development scripts: `bench.sh`, the `pre-commit` hook |
| [`teyru-lang/docs`](https://github.com/teyru-lang/docs) | Language reference, diagnostics, architecture (a separate repository, namely this documentation site) |
| [`teyru-lang/editors`](https://github.com/teyru-lang/editors) | Editor support: the VS Code extension and the tree-sitter grammar (a separate repository) |

---

## Runtime model

- **Objects** are C structs whose first member is `tyobj { tyclass* cls }`. Each class
  has a `tyclass` record with its superclass, interfaces, vtable, interface table and the
  offsets of the reference fields the collector must trace.
- **Virtual calls** go through `obj->cls->vtable[slot]`; **interface calls** through
  `ty_itab(obj, selector)`. Every interface method has a globally unique selector and each
  class's interface table is filled in at compile time.
- **Generics** are erased at compile time; no generic information exists at run time
  (exactly like Java).
- **Exceptions** use a handler chain built on `setjmp`/`longjmp`; `finally` is implemented
  with a nested handler so it runs on every path, including a throw from inside a catch.
- **GC** is conservative mark-and-sweep. Roots are the native stack (scanned
  conservatively), a registry of static field addresses, and registers spilled by
  `setjmp`. Objects never move, so C-level temporaries stay valid across a collection.
  A collection stops every thread first and walks each stack (the stop is
  world-wide and **cooperative**, see [docs/language.md](/en/docs/language) §11).
- **Strings** are UTF-8 `tystr { tyobj obj; int64 len; char* data }`; literals are static
  objects that never enter the heap.
- **Arrays** are `tyarr { tyobj; len; data; esize; refs }` with the elements stored inline.

---

## Differences from Java

Teyru is not a subset of Java; it is a separate language designed to feel immediately
familiar to Java developers. The main differences:

1. **No semicolons.** A semicolon is rejected by the compiler (`TY-SYN-0001`).
2. **`for` headers use colons**: `for (int i = 0 : i < n : i++)`.
3. **try-with-resources separates resources with newlines**, not semicolons.
4. **Enum constants are separated from members by a single colon** (omitted when there are
   no members).
5. **Native properties**: a field followed by an accessor block becomes a property;
   `field` refers to the backing storage. A field with no accessor block is an ordinary
   Java field.
6. **`val`** declares an inferred, non-reassignable local (not deep immutability).
7. **No checked exception checking**; `throws` is parsed but not enforced.
8. **No annotation processors**; annotations are reflectable, but their elements
   are read **by name** (`ann.stringValue("value")`) rather than through Java's
   `ann.value()`.
9. **Not a bytecode platform**: no `.class` files, no `java.lang`, no JNI, and no
   interoperability with existing Java libraries — a deliberate trade-off.

The full list is in [docs/language.md](/en/docs/language) §12.

---

## Command line interface

```
teyru build [flags] <files...>                 compile to a native executable
teyru run   [flags] <files...> [-- args...]    compile and run
teyru emit  [flags] <files...>                 print the generated C
teyru emit-llvm [flags] <files...>             print the LLVM IR
teyru get <module>@<version>                   fetch a module into the cache and require it
teyru mod init <module-path>                   write teyru.mod for a new module
teyru mod tidy                                 make teyru.mod and teyru.sum match the sources
teyru version                                  print the version
teyru help                                     print usage
```

| Flag | Meaning |
|---|---|
| `-o <path>` | Output path (default `a.out`) |
| `-c <path>` | Keep the generated C at this path |
| `--cc <name>` | C compiler to use (defaults to `clang`, then `gcc`, then `cc`) |
| `-O0`…`-O3` | Optimisation level (default `-O2`) |
| `--llvm-ir <path>` | Also write the LLVM IR module here |
| `--native <file.c>` | Compile a C file into the program, implementing native methods (repeatable) |
| `--native-header <path>` | Write the declarations of the native methods (see [docs/native.md](/en/docs/native)) |
| `--link <arg>` | Extra argument for the link step, such as `--link -lm` |
| `--no-lto` | Disable LTO (the build retries without it when the toolchain lacks support) |
| `--target <os>/<arch>` | Which platform to build for (the default is this machine); an unknown target is refused by name |
| `--backend <c\|llvm>` | Which back end compiles the program (the default is `c`, see "Back ends and platforms" below) |
| `-v` | Print the compiler command being run |

---

## Back ends and platforms

**Two back ends, and C is the default.** The C back end generates C for the whole program
(see [docs/architecture.md](/en/docs/architecture)). `--backend=llvm` switches to the
back end that emits **the program's own LLVM IR module**: the runtime is still C and clang
only assembles and links. It refuses what it cannot lower rather than quietly falling back
to the C back end — a refusal is a `TY-INT-0100` diagnostic naming the construct.

That boundary is measured, not guessed: a sweep over `tests/programs` comes out at **76
byte-identical, 0 producing wrong output, 119 refused by the emitter, and 0 modules clang
rejects**. The refused ones, in the order the milestone lists them: closures (lambdas and
method references, plus local and anonymous classes), the members records, enums and
annotations synthesize, type patterns and guarded switch cases, inner classes, and the
rest. It compiles for linux/amd64 only, and refuses every other target with `TY-INT-0101`.

**The platform layer.** Everything the runtime asks of the operating system goes through
`internal/runtime/src/tyrt_plat.h`: time and CPU, mutexes and condition variables, threads,
startup, sockets and files — forty `typlat_*` functions, implemented in two halves,
`tyrt_plat_posix.c` and `tyrt_plat_win.c`. Only `tyrt.c`/`tyrt2.c`/`tyrt_thread.c`/
`tyrt_net.c`/`tyrt_tls.c` call them. (TLS is the one exception to this layer: it is written
on OpenSSL, compiled and linked only when the program's reachable code can reach it, so a
target without OpenSSL refuses it by name — see [docs/native.md](/en/docs/native).)

`teyru build --target <os>/<arch>` picks the compiler, the flags, which half of the
platform layer to compile and the output suffix; without it, the build targets this
machine. The target table has five rows, and **"it builds" and "it runs" are two different
questions** with different evidence, so it has two columns — putting one of them into the
other's cell is claiming a measurement that was never taken:

| Target | Build | Run |
|---|---|---|
| `linux/amd64` | ✅ | ✅ The full suite, natively on this machine: `go test ./...` and `TEYRU=<compiler> sh tests/run.sh` (250 cases) |
| `windows/amd64` | ✅ Cross-compiled with `x86_64-w64-mingw32-gcc`; **except a program that can reach TLS** (see below) | ✅ Run under Wine: 179 of the 195 test programs of the time were byte-identical (14 of the 16 that were not also failed on Linux with gcc under the pre-change compiler, and 2 were Windows path and filename facts) |
| `linux/arm64` | ✅ Cross-compiled with `aarch64-linux-gnu-gcc`; that target's sysroot had to be installed first (see below) | ✅ The full suite under qemu-aarch64: **all 250 cases passed** — all 222 test programs built, ran and were byte-identical, as were the 3 packages, the 23 rejection cases and the 2 native cases |
| `darwin/amd64`, `darwin/arm64` | ⚠️ **Compile and link only**, and not through `teyru build`: from this host the compiler refuses the Apple rows by name (`teyru: no C compiler for darwin/amd64 on a linux/amd64 host`). Bypassing that check and handing the C the compiler prints to `zig cc -target <arch>-macos`, **all 188 programs that cannot reach TLS compile and link** (the product is a Mach-O executable); the 34 that do reach TLS do not (see below) | ❌ There is no macOS here, so nobody has run them |

The evidence is measured separately, because "it builds" and "it runs" are different
questions, and the rows added here are `linux/arm64` and macOS.

**How `linux/arm64` was measured.** This machine had `aarch64-linux-gnu-gcc`, but its sysroot
was empty — not the wrong headers, no headers at all (`fatal error: stdint.h`). So the
sysroot was installed first: libc and its headers, `linux-libc-dev`, `libatomic`, and the
OpenSSL 3.6.4 that arm64's TLS needs (with the zlib and zstd libcrypto wants at run time),
all from Debian sid's arm64 packages, unpacked into the sysroot this cross compiler looks in
by default, `/usr/aarch64-linux-gnu/sys-root`. Two things had to be arranged for Fedora's
compiler: the two linker scripts Debian ships (`libc.so`, `libm.so`) name Debian's absolute
paths and were rewritten to paths inside the sysroot, and Fedora's gcc specs add
`-latomic_asneeded` unconditionally (a Fedora packaging device that links libatomic only when
something in it is needed) while this cross compiler ships no libatomic at all, so that name
was pointed at Debian's `libatomic.so.1`.

What ran was **`tests/run.sh` unmodified**, with exactly three things supplied from outside.
The compiler is a wrapper that adds `--target linux/arm64` — `run.sh` has nowhere to name a
target, it only ever says `teyru build -O1 -o <out> <src>`, so the target travels in the
compiler's name. `CC` is `aarch64-linux-gnu-gcc`, so the suite's own C test
(`native/net_c_test.c`) is built for arm64 too. `QEMU_LD_PREFIX` points at that sysroot:
Fedora's `qemu-user-static` has already registered a binfmt_misc handler, so an arm64
executable runs by being executed, but that qemu has no default sysroot compiled in and a
dynamically linked program needs the variable to find its loader. The result is **250 cases
passed, 0 failed**: every one of the 222 test programs built, ran and was byte-identical, and
so were the 3 packages, the 23 rejection cases and the 2 native cases (the native C test was
built for arm64 and run under qemu).

**The macOS rows reach "compiles and links", and how they got there matters.** From this
linux/amd64 host, `teyru build --target darwin/arm64` is a named refusal for **every**
program (`teyru: no C compiler for darwin/amd64 on a linux/amd64 host`): the Apple rows of
the target table have no C compiler, and `--cc` cannot supply one — `resolveTarget` reads the
table before the caller's compiler is ever consulted, so not even a hello world starts.
Past that check, the C the compiler prints does not depend on the target (`codegen.Emit`
takes only the program, not the target) and macOS and Linux compile the same
`tyrt_plat_posix.c`, so that C is the C a darwin build would compile. Handing the C
`teyru emit` printed, plus the runtime's six files, to `zig cc -target aarch64-macos` and
`zig cc -target x86_64-macos`: **all 188 programs that cannot reach TLS compile and link**,
and the product is a Mach-O 64-bit executable. The 34 that do reach TLS do not compile, for
the same reason the compiler refuses them: `tyrt_tls.c` includes `openssl/err.h`, and the
macOS SDK has no such header. One more thing to say plainly: those links are without
`-flto`, because zig answers `-flto` with `LTO requires using LLD`; the compiler already
falls back to a second attempt without `-flto` for a toolchain that has no LTO, so that is
one of its own success paths — but it is not the default one.

**All five targets are implemented, and this machine can now exercise four of them.**
`linux/amd64` runs the full suite natively, `windows/amd64` runs under Wine, `linux/arm64`
runs under qemu-aarch64 (all 250 cases), and `darwin/amd64` and `darwin/arm64` reach
compiles-and-links. The difference is the machine, not the toolchain: the arm64 row has
something that can execute it, the macOS rows have not — with no macOS anywhere near, that
cell cannot be a ✅, and nobody has run a line of a program on it.

**windows and macOS have no TLS, and what is refused is the program.** The TLS layer is
written on OpenSSL, mingw-w64 does not have it and macOS ships SecureTransport, so a program
that can reach TLS is a **named refusal** on those two targets (the message names the target,
the reason and the targets that would work), rather than being left to the linker to say
`undefined reference to SSL_CTX_new`. Note that "can reach" counts **reachability**: a
program that uses reflection carries a table naming every class, so it reaches TLS
automatically — that is how `t146_reflect`, `t101_gson` and `t102_web` (the Spring-shaped
layer scans classes) were refused on windows/amd64. A program that uses neither reflection
nor TLS is entirely unaffected, and a program that does not use TLS is not linked against
OpenSSL.
`linux/arm64` is not one of those two targets: that sysroot has arm64's OpenSSL in it, so
TLS on arm64 is measured — `t163_https_roundtrip`, `t191_tls_keepalive` and
`t192_tls_handshake_timeout` all ran under qemu and were byte-identical.

The table is **not a promise that every row has been run**, and today the only cell that is
missing is macOS: there is no cross compiler for it to name, so asking for one from another
host is an explicit error — and `--cc` does not fix that either, because when the target
table has no compiler for the Apple rows `resolveTarget` refuses before it ever reads
`--cc`. Using `zig cc` as the compiler for those rows is the manual route described above,
not something `teyru build` can do.

This project has **no CI**: there are no GitHub Actions, the gate for every change is those
two commands, run on this machine, which is why the numbers in these pages say how and where
they were measured. arm64 therefore no longer stands at "implemented, nobody has run it" —
it has been run, 250 cases, all of them passing; the two macOS rows still do, and with no CI
and no macOS they will stay that way.


---

## Development

```sh
go build ./...          # build
go test ./...           # end-to-end tests (compiles every program under tests/programs)
go vet ./...
sh scripts/bench.sh       # JVM comparison (the JVM half runs only if java is installed)
```

To add a test, drop `xxx.teyru` and `xxx.expected` into `tests/programs/`; if the program
takes command line arguments, add `xxx.args` (one argument per line); if the program is
*meant* to fail, add `xxx.exit` with the status it must exit with and `xxx.experr` with
what it should write to stderr. `go test` handles the rest.

Please read [AGENTS.md](https://github.com/teyru-lang/Teyru/blob/main/AGENTS.md) before contributing.

---

## License

See [LICENSE](https://github.com/teyru-lang/Teyru/blob/main/LICENSE) and [THIRD-PARTY-NOTICES.md](/en/docs/legal).
