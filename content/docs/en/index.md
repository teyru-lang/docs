---
title: "Teyru"
description: "Teyru is an independently implemented programming language whose compiler is written entirely in Go and emits native executables directly — no JVM, no javac, no bytecode."
---

[繁體中文](/docs) · [简体中文](/zh-CN/docs) · **English**

**Teyru is an independently implemented programming language whose compiler is written entirely in Go and emits native executables directly — no JVM, no javac, no bytecode.**

The syntax will feel familiar to Java developers (classes, interfaces, generics, lambdas,
exceptions, records, enums, annotations), but Teyru drops semicolons, adds native
properties, and runs as **native machine code**: the compiler lowers the whole program to
C and hands it to clang/LLVM (or gcc). The runtime is **8,524 lines** of C (the eight
`.c` files under `internal/runtime/src`; 10,135 with the headers, by `wc -l`) — a
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

Measured on one machine (nobara-pc, AMD Ryzen 7 5700X (8c/16t), 31 GB, linux/amd64,
clang 22.1.8, OpenJDK 21.0.11 Temurin at default flags; `RUNS=5 JAVA=1 sh scripts/bench.sh`,
best of five per row, `-O2`, **whole-program wall clock including process start**, both sides
given the same scale argument, compiler from `130565a`). The script now prints its own method
header -- host, arch, core count, tree, `RUNS`/`JAVA`/`-O2`, and the 1/5/15-minute load entering
and leaving -- so that output is the method of record and is not restated here.

**Short scale** (each program's own default; a large part of what this group measures is startup):

| Program | Teyru | Java | Teyru/Java |
|---|---|---|---|
| `bench_alloc` | 0.0371 s | 0.0312 s | 1.19x the time |
| `bench_fib` | 0.0079 s | 0.0277 s | 0.29x |
| `bench_invoke` | 0.4094 s | 0.2517 s | 1.63x |
| `bench_loop` | 0.0249 s | 0.0467 s | 0.53x |
| `bench_oop` | 0.0062 s | 0.0265 s | 0.23x |
| `bench_string` | 0.0144 s | 0.0549 s | 0.26x |
| `bench_string_cjk` | 0.0165 s | 0.0781 s | sides disagree; a time, not a comparison |

**Long scale** (at least a second of work per row; scales are fib 44, loop 1000000 rounds,
oop 500000 rounds, string 16000000 joins, string_cjk 4000000, alloc 800000000 allocations,
invoke 200000000 calls):

| Program | Teyru | Java | Teyru/Java | Peak RSS (Teyru) |
|---|---|---|---|---|
| `bench_alloc` | 1.3982 s | 0.2042 s | **6.85x the time** | 4,408 kB |
| `bench_fib` | 1.8773 s | 1.7998 s | 1.04x (a tie) | 4,408 kB |
| `bench_invoke` | 4.0655 s | 1.8586 s | **2.19x** | 9,400 kB |
| `bench_loop` | 1.1335 s | 1.0068 s | 1.13x | 4,364 kB |
| `bench_oop` | 1.0016 s | 0.3572 s | **2.80x** | 4,408 kB |
| `bench_string` | 0.7496 s | 0.2848 s | **2.63x** | 8,732 kB |
| `bench_string_cjk` | 0.2338 s | 0.1602 s | sides disagree | 8,844 kB |

**Three numbers that are not programs:**

| Metric | Teyru | Java | Difference |
|---|---|---|---|
| Startup, 100 runs | **0.0763 s** | 2.1093 s | **about 27.6x faster** |
| hello executable (`-O2`, `wc -c`) | **66,808 B** | -- | -- |
| Peak RSS (hello) | **4,348 kB** | 51,420 kB | **about 11.8x less** |

**The long scale is the only group that can support a throughput claim, and what it says is that
Teyru wins nothing.** `fib(44)` is a tie (Java 4% faster) and every other row is Java's:
`loop` 1.13x faster, `string` 2.6x, `oop` 2.8x, `alloc` 6.8x, `invoke` 2.2x. The short group
looks the other way round because a large part of a whole-program time is JVM startup (about
20 ms against 0.77 ms on this machine) -- that is a difference in startup, not in throughput.

**The `bench_alloc` row needs saying separately.** It used to read "it wins against HotSpot
because of escape analysis": on the long scale (800M allocations) **Java is 6.8x faster**, and
even on the short scale Teyru is already 1.19x slower. It is also **not** a measurement of the
collector -- `TEYRU_GCTRACE=1` prints not one collection during that long run, because escape
analysis keeps the `Cell` on the stack, so that path neither writes to the heap nor triggers a
collection, and explaining its factor with "GC" is wrong.

**An old peak-RSS number may be broken.** The harness used to run the program as
`/usr/bin/time -v timeout LIMIT prog`, measuring the outer `timeout`, which floors every reading
at about 9.9 MB (a real 12x difference would print as 9,904 kB against 50,832 kB). That is fixed
today; the row above measures the program itself, and takes the **largest** of the five runs
(a peak is a maximum, not a best).

`bench_loop` is 0.53x on the short scale and 1.13x on the long one, the same startup difference
again; both keep the cost of the safepoint check (one per loop back edge), which is the
deliberate price of a stop-the-world collector -- see [docs/language.md](/docs/language) §11.

**The size row is a strength again, and the reason for the number is specific.** It is the
hello world from "Getting started" (`System.out.println("Hello, Teyru!")`) built with `-O2`
and measured with `wc -c`: **66,808 bytes today** (about 65.2 KB). Most of the number comes
from the compiler **pruning the vtable slots nothing dispatches** — the mechanism is written
up in [docs/architecture.md](/en/docs/architecture), under "Why every binary carries the
prelude": 48,840 bytes at `74fa648` (9/13), 501,072 before any pruning, 95,832 with the first
version (which only asked whether a slot was dispatched at all), and 55,920 when the second
version (which also asks whether the class could be the receiver of that dispatch) landed.
The 501,072 build had 1,262 functions surviving in a hello world, 951 of them prelude
methods, only 42 reachable by being called — the rest were alive by address through a vtable.

**It has grown back since 55,920, and both steps are measured** (one machine, `-O2`, the same
hello): the **boxing caches** (`#109`, which is what makes `Integer.valueOf(127) ==
Integer.valueOf(127)` agree with Java) added 6,016 bytes to 64,432, and the **stack-overflow
prologue check** (`#104`, one `ty_stack_check()` at the top of every generated function) added
2,256 more, to 66,688, and W9's TLS-link change (`#118`, the call graph decides instead of reflection) added 120 more, to **66,808 today**. The pruning bought the size of programs that do not reflect;
those two bought semantics and a catchable error, and neither was free.

**The number only means anything with its optimisation level.** The same hello world is
85,440 bytes at `-O1`, 66,808 at `-O2` and 70,248 at `-O3` today; this row and
`scripts/bench.sh` both use `-O2`, which is the default.

Before and after, on one machine with `-O2`, measured with `wc -c`: a hello world goes
501,072 before any pruning -> 95,832 with the first version -> 55,920 with the second ->
66,808 today; `t84_sealed_switch` is 89,712 today (521,456 before, 113,904 with the first
version), `t133_arrow_blocks` 71,704 (509,536, 105,688) and `t51_java25_tour` 283,648
(523,696, 438,560), with their output byte-identical throughout. **A program that reflects
gets no help from the pruning**: `t146_reflect` is 5,287,376 bytes today and `t101_gson`
5,251,024, because reflection attaches
every member table from `main` — so a reflecting program still pays for the whole table
(about 5.25 MB today rather than 3 MB), and what the pruning buys is the size of programs that
do not reflect. Speed did not
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
   replacement. The evidence for that path is that `bench_alloc`'s long run under
   `TEYRU_GCTRACE=1` prints **not one collection**; it does not make `bench_alloc` win on
   time (Java is 6.8x faster on the long scale -- see the table above), because that row's
   work is allocation itself, and HotSpot's TLAB bump plus generational collection do it
   faster.
5. **Allocation and bounds checks take an inlined fast path.** `ty_alloc` bumps a
   pointer inline in the header, array access only calls the slow path when it must,
   the collector releases chunks that are completely empty, and class initialisation
   tests a single flag.
6. **Predictable performance.** No deoptimisation, no warmup curve, no GC tuning.

**The honest boundary.** Escape analysis only covers objects that stay inside the
method that creates them. An object stored into a field, an array, a return value or
another object still goes to the heap and the mark-and-sweep collector, and HotSpot's
generational assumption makes long-lived, repeatedly-collected objects its home ground.
That is not a prediction: the long table above is that workload, and Teyru wins none of
its six rows -- **everything a compiler can decide at compile time Teyru already decides;
the gap that is left lives in the runtime's allocator and collector**. The short group's
advantage is startup, not throughput. Every number is reproducible with
`RUNS=5 JAVA=1 sh scripts/bench.sh`, which measures the seven programs, the 100 startups,
the executable size and the peak RSS, best of five on the machine above.

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
what is Java-compatible is **the import**. **Unmodified Java source does compile now, on
the subset that has been tested** (W7): a `.teyru` may keep its semicolons, a `.java` file
is accepted as input, JLS §14.22 reachability and definite assignment hold, and the common
inferences work (`xs.sort(naturalOrder())` and `Comparator.comparing(f).thenComparing(g)`
no longer need a type witness). **That is not "Java source compiles unchanged", which is a
claim with no bounds on it**: the bounds are §12 and §13 of the language reference, and
those are not empty today (`new String(char[])` and `String.codePointAt` are still
missing). A claim follows its corpus, not the word "Java", and the corpus (45 unmodified
Java programs) is on `teyru-lang/tests` main (`af41a7d`), and Teyru main's submodule pointer
reaches it only through PR [#128](https://github.com/teyru-lang/Teyru/pull/128):

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
| `cmd/teyru` | CLI entry point (`build`/`run`/`emit`/`emit-llvm`/`emit-java`/`get`/`mod`/`version`) |
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
- **Stack overflow**: every generated function compares its own frame address against the
  thread's `ty_stack_limit` (the stack bottom plus a **256 KB** margin) and throws the
  `StackOverflowError` **preallocated for that thread** when it is below it, so the throw
  path allocates nothing and recurses no further. It is catchable exactly as in Java
  (`catch (Error)` and `catch (VirtualMachineError)` both reach it, and the message is
  `null`), and the thread and the process carry on; uncaught, it prints
  `Exception in thread "main" teyru.StackOverflowError` and exits 1. When native code
  really does run the stack out, the SIGSEGV handler on its `sigaltstack` prints
  `stack overflow in native code` and calls `abort()` — it does **not** `longjmp` out of a
  signal handler. The tests are `t214` (caught, by parent class, as an `Error`, and on
  another thread), `t215` and `t216`; a deep recursion inside a web handler is `t241`.
- **GC** is conservative mark-and-sweep. Roots are the native stack (scanned
  conservatively), a registry of static field addresses, and registers spilled by
  `setjmp`. Objects never move, so C-level temporaries stay valid across a collection.
  A collection stops every thread first and walks each stack (the stop is
  world-wide and **cooperative**, see [docs/language.md](/en/docs/language) §11).
- **Strings** are `tystr { tyobj obj; int64_t blen; int32_t ulen; uint32_t flags }` with the
  **WTF-8** bytes **inline after the header** (`TY_STR_DATA`, there is no second pointer): `blen` is
  the byte length and `ulen` the UTF-16 code unit count. A non-ASCII string also grows a breadcrumb
  table after the terminating NUL (one entry per 64 code units, built on first use, so a string that
  is never indexed pays nothing). `String.length()` still counts **bytes** today (W5's second piece
  is what turns it into code units); literals are static objects that never enter the heap.
- **Arrays** are `tyarr { tyobj; len; data; esize; refs }` with the elements stored inline.

---

## Differences from Java

Teyru is not a subset of Java; it is a separate language designed to feel immediately
familiar to Java developers. The main differences:

1. **Semicolons are optional.** Statements end at a newline and a semicolon is ignored (since W7;
   `TY-SYN-0001` is removed), which is what lets an unmodified `.java` compile.
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
teyru emit-java [flags] <files...>             print the equivalent Java source
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
| `--cc-flag <arg>` | Extra argument for the C compile step (repeatable), such as `-I <dir>` to put a `--native-header` on the include path |
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

That boundary is measured, not guessed: on 2026-09-17 a sweep over `tests/programs` with the
compiler built from main (256 programs, the test repository at `34584f2`, `teyru build --backend=llvm`, every program that
builds then run and compared byte for byte with its `.expected`, plus `exit` and `experr`)
comes out at **159 that build**, of which **153 produce exactly the expected output** and
**6 differ** (those six are the W5/W6 JDK probes, whose expectations came from the JDK and
which are listed in `known-failures.txt`; the difference is what those work items are for),
**93 refused by the emitter with `TY-INT-0100`**, **4 refused by the semantic analysis before
the back end is reached** (also probes in `known-failures.txt`) and **0 modules clang
rejects**. The refusals by count: an annotation on the program's own declaration (38 — the
Lombok, Spring and Gson declarations that only exist because of an annotation), a switch
case with a type pattern, a guard or `null` (12), an `instanceof` pattern that binds a
variable (8), a thread (8), an inner class (7, local ones included; the message is that the
enclosing-instance chain is not lowered), a reflective call (7), try-with-resources (5),
`synchronized` (3), boxing a `void` (2), and interface `super` calls and the rest (2).
**Lambdas and method references are no longer among the reasons** (this list used to put
them first). It compiles for linux/amd64 only, and refuses every other target with
`TY-INT-0101`.

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
| `linux/arm64` | ✅ Cross-compiled with `aarch64-linux-gnu-gcc`; that target's sysroot had to be installed first (see below) | ✅ The full suite under qemu-aarch64 (the pre-W9 pair: **all 250 cases passed**). Re-measured after W9 with `TEYRU_TARGET=linux/arm64`: **271 passed, 5 failed, 10 known out of 286** -- and **every one of the five fails identically when built natively on this machine** (checked case by case), so none of them is an arm64 failure (see below) |
| `darwin/amd64`, `darwin/arm64` | ⚠️ **Compile and link only**: `teyru build --target darwin/arm64 --cc <zig wrapper>` (after W9, `resolveTarget` checks the compiler the build will actually run) builds and links **240 of the 257** programs in `tests/programs`, refuses **9 by name** for TLS and is refused by that compiler for **8** (APIs and checker work that landed after it). **The two architectures agree program for program**: `darwin/amd64` measured the same 240/9/8 with the same script, and the refused and rejected programs are the same seventeen, to the program. The product is a Mach-O executable and **not one line has been executed** (see below) | ❌ Nothing here can run macOS, so no one has run them |

The evidence is measured separately, because "it builds" and "it runs" are different
questions, and the rows added here are `linux/arm64` and macOS. **Read the table's numbers with
the tree they were measured on**: the suite figures for `linux/amd64`, `windows/amd64` and `linux/arm64`
were all measured on 2026-09-17, when `tests/programs` held 222 programs and the whole suite was 250
cases; that directory holds more now (257), so those two are records of that day rather than
today's count. The macOS rows have been re-measured with `--cc` (below), and the `linux/arm64` row
now carries both numbers: the pre-W9 run with all 250 cases passing, and the post-W9 run under
`TEYRU_TARGET` with 286 cases (271 passed, 5 failed -- each of the five fails natively too, see
below).

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
dynamically linked program needs the variable to find its loader. That run used the wrapper.
`tests/run.sh` and `go test` read `TEYRU_TARGET` now, so the target is a variable and `.skip` is read against it; the wrapper is history. The result of that run is **250 cases
passed, 0 failed**: every one of the 222 test programs built, ran and was byte-identical, and
so were the 3 packages, the 23 rejection cases and the 2 native cases (the native C test was
built for arm64 and run under qemu).

The post-W9 re-run takes the other route (`TEYRU_TARGET=linux/arm64 CC=aarch64-linux-gnu-gcc
QEMU_LD_PREFIX=/usr/aarch64-linux-gnu/sys-root sh run.sh`, with no compiler wrapper) and it has
finished: **271 passed, 5 failed, 10 known, 0 skipped out of 286 cases** (`tests` at `e4268a6`,
compiler `5ac017b`, 2026-09-17). The three programs that could not be **built** for arm64 at all
before W9 — `t138_request_mapping_forms`, `t140_json_binding_edges` and
`t141_web_param_errors` — all PASS now.

**None of the five failures is an arm64 failure, and each one was checked natively on this same
machine:** `t226`, `t227` and `t241` want `RawClient.ask(String)`, which W5 and W7 bring (a native
`teyru build` refuses them with the same `TY-TYP-0076`); `t240_progen_array_bounds` is **that
compiler's** wording of the message (a lowercase `index ...`) against the JDK's capital `Index ...` in
`tests` -- that fix is on main (W6), and rebuilding the same program with main prints `Index 7 out of
bounds for length 3` on amd64 and on arm64 and passes on both; and `native/net_c_test` is
that C test failing to link `TY_UNSUP`/`ty_make_ex`/`ty_throw` (the same `undefined reference`
natively). The ten known failures are the W5/W7 entries `known-failures.txt` lists (`t196` and the
`t230`-`t239` probes): they are expected to fail and are recorded, not ignored.

**The macOS rows reach "compiles and links", and how they got there matters.** `teyru build`
is the route now: the Apple rows of the target table have no C compiler, but `resolveTarget`
checks the compiler the build will actually run, so a `--cc` from the caller counts. Without
one the answer is still a named refusal (`teyru: no C compiler for darwin/arm64 on a
linux/amd64 host: building for it needs a compiler that runs here and targets it, and
neither this table nor --cc names one`); with one — for instance a two-line wrapper,
`exec …/zig cc -target aarch64-macos "$@"` —
`teyru build --target darwin/arm64 --cc <wrapper> -o hello-darwin hello.teyru` produces a
Mach-O 64-bit arm64 executable. zig answers `-flto` with `LTO requires using LLD`; the
compiler already falls back to a second attempt without `-flto` for a toolchain that has no
LTO, so that is the attempt that succeeds, not the default one.

A program that reaches TLS on darwin is a **named refusal from the driver, before the C
compiler** (`teyru: TLS is not available for darwin/arm64: macOS ships SecureTransport
rather than OpenSSL, …`), not the old `tyrt_tls.c: openssl/err.h not found`.

**How it was counted, and why both halves need saying.** 2026-09-17, `zig 0.16.0`, a two-line
wrapper around `zig cc -target aarch64-macos` passed as `--cc`, `-O1`, four programs at a time
(`tests` at `e4268a6`, the compiler at `5ac017b`, where W9 landed). Of the 257 programs, **240
build and link**; **9 are refused by the driver by name** (`t154_http_client`,
`t162_http_roundtrip`, `t163_https_roundtrip`, `t191_tls_keepalive`,
`t192_tls_handshake_timeout`, `t207_http_server_certificate`, `t210_http_gzip_edges`,
`t212_stream_end_of_stream`, `t225_http_serve_loop`); and the remaining **8 are not darwin
failures** but programs that compiler does not accept yet (`t180_http_gzip`,
`t196_string_bytes`, `t226`/`t227`/`t241`, `t237`/`t238`/`t239` — W5's and W7's APIs and
checker), which a re-run with today's main compiler should drop.
**`darwin/amd64` is the same script with the target changed to `x86_64-macos`** (same P=4,
`-O1`, same compiler and same `tests`), and it produced the same three numbers, with the
same nine refused and the same eight rejected, to the program -- so the two table rows
share one sentence instead of each having its own. **Nothing was executed.**

The bypass of the W9 era (the C from `teyru emit` plus the runtime's six files, handed to
`zig cc`) and the two numbers it produced (188 programs that cannot reach TLS compiled and
linked, the 34 that do reach TLS did not) are kept here as history, and both halves of that
pair are stale: 188 was measured when there were 222 programs, and the 34 were "reaches TLS"
under the **old** rule, where any program that reflected counted as reaching it. Since W9 the
rule is the program's own call graph, so most of those 34 build now and the 9 above are what is
left.
One more thing to say plainly: those links were without
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
`undefined reference to SSL_CTX_new`. Note that "can reach" counts **reachability**, and
since W9 it is reachability over **the program's own call graph**: the reflection member
tables and the `Class.forName` class table no longer count (the emitter marks those lines
and the TLS fixpoint does not follow them), so `t146_reflect`, `t101_gson` and `t102_web`
(the Spring-shaped layer scans classes) all build now — `t101_gson`'s PE32+ imports only
`KERNEL32.dll`, `WS2_32.dll` and `msvcrt.dll`, and under Wine it prints exactly its
`.expected`. A call that reaches a TLS method through reflection is answered by the weak
symbol in `tyrt_net.c` with a named, catchable `UnsupportedOperationException`
(`Net.tlsClientContext0: this program was not linked against OpenSSL`) rather than a jump to
`NULL`. A program that does not use TLS is not linked against OpenSSL.
`linux/arm64` is not one of those two targets: that sysroot has arm64's OpenSSL in it, so
TLS on arm64 is measured — `t163_https_roundtrip`, `t191_tls_keepalive` and
`t192_tls_handshake_timeout` all ran under qemu and were byte-identical.

The table is **not a promise that every row has been run**, and today the only cell missing is
macOS's **run**: it compiles (point `--cc` at a compiler that runs here and targets macOS),
but nothing here can execute it, so that cell is ❌. W9 closed the two gaps that were open:
`tests/run.sh` and `go test` read `TEYRU_TARGET`, so the target no longer has to arrive by
renaming the compiler, and `resolveTarget` honours the caller's `--cc`, so the Apple rows no
longer have to go around the target table.

There is **no CI on a push or a pull request**: the gate for every change is those two
commands, run on this machine by a person, which is why the numbers in these pages say how
and where they were measured. `.github/workflows/release.yml` is this repository's **only**
workflow and it runs when a release is published: it builds that tag, runs the whole suite
against it and attaches the executables to the release, calling the same targets a person
does (`make ci`, `make java-compat`, `make jdk-diff`, `make backend-matrix`, `make notices`,
`tests/run.sh`). arm64 therefore no longer
stands at "implemented, nobody has run it" — it has been run, and the two macOS rows still
stand there, and with no macOS machine they will stay that way.


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

Three files in the test repository decide what counts as passing today (see `README.md` in
`teyru-lang/tests`):

- `known-failures.txt`: one `<case> <work item> <reason>` per line. A case listed here that
  fails is a **known failure** — reported, but it does not fail the run; a listed case that
  *passes* fails the run, so an entry cannot outlive the bug it describes. Both drivers
  (`go test` in the compiler repository and `tests/run.sh`) read the same file, and an entry
  without a reason is not accepted.
- `jdk-diff-allow.txt`: `<case> <kind> <work item> <reason>`, for a difference from the JDK
  that has been **decided** (or that Java cannot express). An entry without a work item, or
  an explicit `none`, is not accepted.
- `<part>/<case>.skip`: the platforms a case cannot run on (`windows`, `darwin/arm64`, or
  `!linux` for the one platform it can), with the reason after `#`.
- `scripts/backend-matrix-allow.txt` (in the Teyru repository): the divergences **between back
  ends** that the matrix is allowed to find, one `<program> <work item> <reason>` per line. Same
  mechanism as `known-failures.txt`; what is different is what it excuses, because the suite's own
  drivers build one back end and so cannot see two of them disagree.

The make targets wrap these up (`make` on its own is `make build`):

| target | what it does |
|---|---|
| `make check` | what to run before a commit: `lint` (`go vet` plus a `gofmt` diff check), `notices` (the third-party notices agree with the tree) and `test` |
| `make ci` | everything a CI job would run, run here by hand instead: `lint`, the whole suite built once with clang and once with gcc, and the JDK differential when `TEYRU_JDK` is set. With only one C compiler installed, the gcc half says out loud that it did not run |
| `make jdk-diff` | compile and run every translatable program in `tests/programs/` with JDK 21 and compare stdout and exit status; `TEYRU_JDK` must point at a JDK 21 home |
| `make java-compat` | compile and run every **unmodified Java** program in `tests/java-compat/` and compare with `.expected` (the corpus and its cases are described in `teyru-lang/tests`) |
| `make progen` | the random-program differential: `internal/tools/progen` generates 200 programs from fixed seeds and builds each spelling and diffs them |
| `make backend-matrix` | every program × six back-end cells (C+clang, C+gcc, LLVM at `-O0` and `-O2`), each cell compared with the suite and the cells with each other; the divergences allowed are in `scripts/backend-matrix-allow.txt` |
| `make notices` | check `THIRD-PARTY-NOTICES.md` against the tree (see [docs/legal.md](/en/docs/legal)) |
| `make bench` / `make examples` | the performance comparison, and the examples |

The runtime has two diagnostic switches for this work: `TEYRU_GC_STRESS=N` forces a
collection every Nth allocation, and `TEYRU_GCTRACE=1` prints one line per collection —
what asked for it, how long the pause was, and the heap size before and after.

Please read [AGENTS.md](https://github.com/teyru-lang/Teyru/blob/main/AGENTS.md) before contributing.

---

## License

See [LICENSE](https://github.com/teyru-lang/Teyru/blob/main/LICENSE) and [THIRD-PARTY-NOTICES.md](/en/docs/legal).
