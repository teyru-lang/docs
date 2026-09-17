---
title: "Teyru Language Reference"
description: "The syntax and semantics of Teyru 0.2: source files and lexing, types, declarations, native properties, statements, generics, lambdas, exceptions and the standard library."
---

This document describes the syntax and semantics of Teyru 0.2. It follows the implementation:
every language feature written here has a corresponding test in `tests/programs/`, and
`go test ./...` verifies each one; the standard library API, however, is only partially covered —
whatever `tests/programs/` exercises is verified, and what it does not exercise (for example
`Map.putAll`) has no test watching it, so test coverage is still incomplete.

- [1. Source files and lexing](#1-source-files-and-lexing)
- [2. Newlines and statement termination](#2-newlines-and-statement-termination)
- [3. Types](#3-types)
- [4. Declarations](#4-declarations)
- [5. Native properties](#5-native-properties)
- [6. Statements](#6-statements)
- [7. Expressions](#7-expressions)
- [8. Generics](#8-generics)
- [9. Lambdas and method references](#9-lambdas-and-method-references)
- [10. Exceptions](#10-exceptions)
- [11. Standard library](#11-standard-library)
- [12. Differences from Java](#12-differences-from-java)
- [13. Not yet implemented](#13-not-yet-implemented)

---

## 1. Source files and lexing

- Source files are UTF-8, with the extension `.teyru`. A leading BOM is ignored.
- Comments: `//` line comments, `/* ... */` block comments (may span lines).
- Identifiers: start with a letter, `_`, `$` or a non-ASCII letter, and may continue with
  digits.
- The same keyword set as Java (`class`, `interface`, `enum`, `record`, `new`, `switch`…),
  plus `var` and `val` (see §3.4).
- Literals: integers (decimal, `0x`, `0b`, `0`-prefixed octal, `_` separators, `L` suffix),
  floating point (`f`/`d` suffix, exponents), `char`, `String`, text block `"""…"""`,
  `true`/`false`/`null`.
- Escape sequences: `\n \t \r \b \f \s \0-7 \uXXXX` and `\\ \' \"`; `\<newline>` continuation
  applies in both ordinary strings and text blocks. An escape sequence outside this list is an
  error and yields `TY-SYN-0011` (`\q` is not `q`).

**No semicolons.** A semicolon is not a legal token and produces `TY-SYN-0001` outright;
semicolons inside strings, character literals, comments and text blocks are data and are
unaffected.

## 2. Newlines and statement termination

The lexer does not produce NEWLINE tokens: each token merely records "whether a newline
preceded it". The parser treats a newline as the end of a statement when two conditions hold at
the same time:

1. **The newline is significant here**: it is not significant inside parentheses, brackets and
   argument lists (`f(a,\n b)` is legal); it is significant at block level and class member
   level.
2. **The prefix is already complete**: in the following cases a newline is not an end even so —
   - the expression ends with an operator, comma, `.`, `::`, `->`, `?` or `:`;
   - the next line starts with `.` or `::` (method chain);
   - a delimiter has not been closed yet.

In the implementation this is decided by `parser.continues()`; when the next line starts with
`+ - ! ~ ( [ { @ <` it does **not** continue, to avoid confusing "the next line is a new
statement" with "the previous line is not finished yet".

Special cases:

- A newline directly after `return` means returning no value; to return a value the expression
  must start on the same line, or use `return (` to let it span lines.
- The same for `throw`: if the expression is not on the same line it is `TY-SYN-0003`. `yield`
  cannot take the next line's value either, but it is treated as an identifier, so the message
  is `cannot find symbol yield`.
- `++`/`--` do not attach across lines: a postfix operator must be on the same line as its
  operand.
- You cannot cram several statements onto one line with `;`; use separate lines.
- No semicolon after `do { … } while (c)`.

## 3. Types

### 3.1 Primitive types

`boolean byte short char int long float double void`, with the same sizes and ranges as Java.

### 3.2 Reference types

Classes, interfaces, enums, records, arrays, type variables. `Object` is the root of all
classes, and `null` is assignable to any reference type.

### 3.3 Arrays

`T[]`, `T[][]`, `new int[10]`, `new int[2][3]` (which creates the inner arrays),
`new String[]{"a","b"}`, `{1,2,3}` initializer lists. Arrays have a `length` field and a
`clone()` method; element access is bounds-checked (both reads and writes; a null array throws
`NullPointerException` before the bounds check, the same order as Java).

Arrays are covariant (`Object[] o = new String[2]` is legal), but the element type is recorded
at creation, so writing a value that does not fit through a wider view throws
`ArrayStoreException`:

```teyru
Object[] o = new String[2]
o[0] = "hello"
o[0] = Integer.valueOf(5)   // ArrayStoreException
```

### 3.4 `var` and `val`

```teyru
var n = 10        // int, reassignable
val name = "ada"  // String, cannot be reassigned
```

- Both can only be used for local variables (including the variable of an enhanced `for` and
  try-with-resources); they cannot be used for fields, parameters or return types.
- An initializer is always required; `null` cannot be used to infer a type; a lambda needs a
  target type.
- `val` means "cannot be rebound", not deeply immutable.
- Fields and parameters must always spell out their type.

## 4. Declarations

### 4.1 Classes, interfaces, enums, records

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

  :  // separator between the constant section and the member section
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

- Modifiers: `public protected private static final abstract native synchronized
  transient volatile strictfp sealed non-sealed default`.
- Nested classes, inner classes (with an enclosing instance), local classes and anonymous
  classes are all supported.
- In an `enum` the constant section and the member section are separated by **a single colon**;
  the colon is omitted when there are no members; when there are no constants but there are
  members, the section starts with a colon.
- A `record` automatically gets private final fields, accessors, `toString`, `hashCode`,
  `equals` and the canonical constructor; you can also write a compact constructor to add
  validation.
- Annotation types (`@interface`) can be declared and used, and they are reflectable
  (see §11); `annotation` is not a keyword.

### 4.2 Fields and methods

```teyru
class Counter {
  private int count          // an ordinary Java field
  public static final int MAX = 100
  public int step = 1        // a field with an initializer

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

- Static and instance initializer blocks: `static { … }` and `{ … }`.
- Constructors can be overloaded; `this(...)`/`super(...)` may only be written in a
  constructor, but **do not have to be** the first statement — statements before `super()` run
  first (JEP 513, Java 25's flexible constructor bodies), and the actual output is the same as
  javac 25.
- Varargs: `void log(String fmt, Object... args)`.
- Abstract methods can only be in an abstract class or an interface; an interface method with a
  body must be `default`, `static` or `private`.

## 5. Native properties

A field declaration followed by an accessor block becomes a property:

```teyru
class Person {
  public String name        // an ordinary field
  private int age
  public int years {        // property
    get {
      return field          // field = the backing storage
    }
    set {
      field = value < 0 ? 0 : value
    }
  }
  public String label {     // a computed property with only a getter
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

Rules:

| Topic | Behavior |
|---|---|
| Storage | Storage is needed only when there is an initializer, a default accessor, a setter, or `field` is used inside an accessor; otherwise it is a computed property, and `final`/`volatile`/`transient` cannot be used. |
| `field` | Only inside that property's accessors does it denote the backing storage; `field` anywhere else is still an ordinary identifier. |
| Visibility | A property's modifiers are the accessors' default visibility; the backing storage is always `private`. |
| Access | `p.years` reads by calling the getter, `p.years = v` calls the setter, and `p.years += 1` calls the getter and then the setter. Only an initializer on the property declaration writes to the storage directly; an assignment in a constructor or initializer block calls the setter like anywhere else. |
| Naming | JavaBeans: getter `getX` (`isX` may be used for `boolean`), setter `setX`. You can also call `p.getYears()` directly. |
| Inheritance | Accessors take part in overriding, visibility and generic substitution just like ordinary methods. |
| `final` | A `final` property cannot have a setter. |
| Static | A `static` property's accessors are static too. |

## 6. Statements

### 6.1 Basic for uses colons

```teyru
for (int i = 0 : i < 10 : i++) {
  System.out.println(i)
}
for ( : : ) {          // infinite loop
  break
}
```

The three sections are separated by **two top-level colons**. A `:` inside parentheses,
brackets or braces as well as the ternary operator's is not treated as a separator, so
`for (int i = a > b ? 0 : 1 : i < 3 : i++)` is legal.

### 6.2 Enhanced for

```teyru
for (String s : names) { … }
for (var s : names) { … }
for (int v : new int[]{1,2,3}) { … }
```

Arrays and `Iterable` are supported.

### 6.3 try-with-resources

Resources are separated by **newlines**, not semicolons:

```teyru
try (
  Reader r = open("a.txt")
  Writer w = create("b.txt")
) {
  copy(r, w)
}
```

The close order is the reverse of the declaration order, the same as Java.

### 6.4 switch

Statements and expressions, both the `->` and `:` forms, multiple labels, enums, strings, type
patterns and `when` guards are supported:

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

- The `:` form keeps Java's fall-through; the `->` form does not.
- The same switch cannot mix the two forms.
- A switch **expression** must be exhaustive: when there is no `default` and not all values are
  covered it is the compile error `TY-TYP-0096` (`int`/`String` selectors always require a
  `default`; an enum selector must list every constant), rather than producing a result that is
  silently computed as the zero value. A switch **statement** has no such requirement.

### 6.5 Others

`if`/`else`, `while`, `do…while` (no trailing semicolon), `return`, `break`/`continue` (labels
may be added), `throw`, `yield`, `assert`, `synchronized (lock) { … }`, labelled statements.

## 7. Expressions

- The full operator precedence is the same as Java: `||` `&&` `|` `^` `&` `==` `!=`
  `< > <= >= instanceof` `<< >> >>>` `+ -` `* / %`, unary, postfix, ternary, assignment.
- Integer division and remainder check for division by zero (throwing `ArithmeticException`).
- `==` on reference types is **reference equality**, the same as Java; `==` on `String` is
  reference equality too, so use `equals` to compare contents.
- String concatenation: when either side of `+` is a `String` it concatenates, and the other
  operands are automatically converted to strings (`null` becomes `"null"`).
- `instanceof` supports type patterns: `if (o instanceof String s) { … }`, as well as record
  deconstruction patterns: `if (o instanceof Point(int x, int y)) { … }`.
- **Primitive type patterns** (JEP 507): `if (o instanceof int i)`, `case byte b ->`.
  The matching condition is **exact conversion**, with the same rules as Java, split by the two
  kinds of selector:
  - When the selector is a **reference type**, it matches only if its wrapper type is exactly
    that primitive type: `Integer(42)` matches `int`, but not `long`, `double` or `byte`.
  - When the selector is a **primitive number**, it matches only if the value converts exactly
    to that type: `42` matches `byte`, `16777217` does not match `float` (it loses precision),
    while `16777216` does.
  `boolean` only pairs with `Boolean`, and `null` never matches.
  A primitive type pattern must always have a variable name.

  ```teyru
  String kind = switch (o) {
    case int i when i > 100 -> "large int"
    case int i -> "int " + i
    case double d -> "double " + d
    default -> "other"
  }
  ```
- `Interface.super.method()` binds statically to that interface's default implementation:
  `A.super.hello()`; the interface must be a super interface of the current class.
- cast: conversion between numeric types, a runtime check between reference types (failure
  throws `ClassCastException`).
- **A narrowing conversion from floating point to integer follows JLS 5.1.3, not C's
  `(int)`/`(long)`.** A value that does not fit is undefined in C, so both back ends emit a
  runtime call (`ty_d2i`/`ty_d2l`): NaN → `0`, `+∞` → the target type's maximum, `-∞` → the
  minimum, too large → the maximum, too small → the minimum, and the rest truncates towards
  zero. When the target is narrower than `int` (`byte`/`short`/`char`) a second step follows
  — saturate to `int` first, then truncate — the same two steps as Java's, which is why
  `(byte) 1.0e20` is `-1` and not `127`.

  ```teyru
  System.out.println((int) Double.NaN)                 // 0
  System.out.println((int) Double.POSITIVE_INFINITY)   // 2147483647
  System.out.println((long) 1.0e20)                    // 9223372036854775807
  System.out.println((long) -1.0e20)                   // -9223372036854775808
  System.out.println((int) 3.99)                       // 3 (truncated towards zero)
  System.out.println((byte) 1.0e20)                    // -1
  ```

  This conversion used to be undefined, and visibly so: the same `(long) 1.0e20` gave four
  answers across four builds — the C back end at `-O2` said `160`, at `-O0`
  `-9223372036854775808`, at `-O3` `0`, and the LLVM back end `48` — because constant folding
  handed it to C's undefined behaviour. With a defined call emitted, constant folding is
  defined too: all four optimisation levels and both back ends now answer
  `9223372036854775807`. The end-to-end test is
  `tests/programs/t193_narrowing_saturation.teyru` (the expected values are produced by javac,
  and both back ends are identical line for line).
- boxing/unboxing happens automatically, and unboxing `null` throws `NullPointerException`.
- Object initializer lists: `new int[]{…}`, `int[] xs = {1,2,3}`, nested `{{1,2},{3}}`.

## 8. Generics

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

- Type parameters, bounds (`<T extends Number>`), multiple bounds (`&`), wildcards (`?`,
  `? extends`, `? super`), generic methods and the diamond `new Box<>("x")` are supported.
- A generic method can infer its type parameters from the arguments (primitive arguments are
  boxed automatically), or they can be specified explicitly:
  `Main.<String>identity("x")`, `box.<Integer>map(v -> v.length())`.
- **Generics are erased at compile time**: at runtime only the class is known, and there is no
  generic checking beyond `ClassCastException`; `List<String>` and `List<Integer>` are the same
  type at runtime.
- A primitive type cannot be a type argument (`Box<int>` is illegal); use the wrapper class.

## 9. Lambdas and method references

```teyru
interface Fn<R> {
  R apply(int v)
}

Fn<Integer> f = (v) -> v + 1
Fn<Integer> g = v -> v * 2          // a single untyped parameter may omit the parentheses
Fn<Integer> h = (int v) -> {
  return v - 1
}
Fn<Integer> m = Main::twice         // static method
Fn<String>  c = String::valueOf     // overload resolved by the target type

interface Maker<T> {
  T make()
}
Maker<Rect> s = Rect::new           // constructor reference (the target interface must declare it)
```

- The target type must be a **functional interface** (an interface with exactly one abstract
  method).
- When a lambda captures an outer local variable, it is copied into a field of the synthetic
  class; the captured variable can still be used after the lambda, but
  **writes to the captured variable are not written back** (the same as Java, except that Teyru
  does not require the variable to be effectively final in order to capture it).
- Method references support: `Type::staticMethod`, `obj::instanceMethod`,
  `Type::instanceMethod` (unbound, with the first parameter as the receiver), `Type::new`.

## 10. Exceptions

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

- The `Throwable` family: `Exception`, `RuntimeException`, `NullPointerException`,
  `ArithmeticException`, `IndexOutOfBoundsException` and its two subclasses
  `ArrayIndexOutOfBoundsException`/`StringIndexOutOfBoundsException`, `ClassCastException`,
  `IllegalArgumentException`, `IllegalStateException`, `NoSuchElementException`,
  `NegativeArraySizeException`, `ArrayStoreException`, `AssertionError`,
  `UnsupportedOperationException`.
- **The out-of-bounds hierarchy is the same as Java's**: `IndexOutOfBoundsException` is the
  parent, an array index throws `ArrayIndexOutOfBoundsException`, a string or `StringBuilder`
  index or range throws `StringIndexOutOfBoundsException` — both of them under the parent —
  and a container (the `ArrayList` family) throws `IndexOutOfBoundsException` itself. So the
  Java idiom `catch (IndexOutOfBoundsException e)` catches all three here; for when each one
  is thrown see "Runtime errors" in [docs/diagnostics.md](/en/docs/diagnostics).
- Reading or **writing** a field on `null`, calling a method, and reading or writing array
  elements (including taking `length`) all throw `NullPointerException`.
- `catch` uses `|` for multiple types; `finally` always runs (including when a catch block
  throws again).
- **There is no checked exception checking**: `throws` is parsed but not enforced.
- An uncaught exception prints a message and exits with status 1.

## 11. Standard library

The standard library is written in **Teyru itself** (`lib/*.teyru`) and is compiled and checked
together with the user's program on every compilation — it has no special standing: the files
under `lib/` are ordinary programs written in Teyru. The standard library is **one** Teyru
package: `teyru`. The classes inside it take Java's names, so Teyru code brings the whole thing
in with one on-demand import: `import teyru.*` (using only one class, `import teyru.List`,
works the same way). The Java-style `import java.util.*` and `import java.util.List` are
accepted just as well: a `java.*` name resolves to the class of that name in the standard
library, see "How names are found" below. **That is not the same thing as "Java source code
compiles unchanged".** A semicolon is not a legal token (`TY-SYN-0001`, §1), so Java source
has to have its semicolons removed to compile; the other syntax differences are in §12 and
the missing APIs and misreported forms are in §13. Whether a semicolon becomes optional is
undecided.

### java.lang (`lib/01`–`lib/07`)

`Object`, `Class`, `String` (`format`/`join`/`valueOf`/`compareTo`/`startsWith`/`replace`/
`split`/`strip`/`repeat`…), `StringBuilder` and `StringBuffer`, `Math` (including `floorDiv`/
`floorMod`/`round`/trigonometric functions), `System` (`out`/`err`/`currentTimeMillis`/
`nanoTime`/`arraycopy`/`getenv`/`exit`), `PrintStream`, `InputStream`, `IO` (`println`/
`readln`), `Number` and the eight wrapper classes (the static API such as
`Integer.parseInt`, `Long.toHexString` and `Character.isDigit` — **not** the complete set; what
is missing is in §12 item 12 and §13), the `Throwable` family, `Enum`, `Record`,
`Comparable`/`Iterable`/`Iterator`/`Cloneable`/`AutoCloseable`, `Logger`.

### java.util (`lib/08`, `lib/14_*`)

`Collection`, `List`/`ArrayList`/`LinkedList`, `Set`/`HashSet`/`LinkedHashSet`/`TreeSet`,
`Map`/`HashMap`/`LinkedHashMap`/`TreeMap` (red-black tree), `SortedSet`/`NavigableSet`/
`SortedMap`/`NavigableMap`, `Queue`/`Deque`/`ArrayDeque`, `Iterator`/`ListIterator`, `Arrays`,
`Collections`, `Objects`, `Optional`, `StringJoiner`.

The contracts follow the JDK: `LinkedHashMap` is insertion-ordered, `TreeMap` is key-ordered,
`TreeSet`'s `headSet`/`tailSet`/`subSet` are **live views** (an `add` inside the range writes
into the original collection, outside the range it is
`IllegalArgumentException: key out of range`; the view from `TreeMap.keySet()` refuses
additions just as the JDK does), and `computeIfAbsent`/`merge`/`forEach` are all there.
`Stream.of(array)` flattens the array into elements (the same overload resolution as javac:
`of(T...)` is more specific than `of(T)`).
`java.lang.reflect` (`lib/26`) provides `Class`, `Field`, `Method`, `Constructor`,
`Modifier` and `Array`, plus the six reflection exceptions. They read the static tables
the compiler emits per class, so a lookup is an array walk and nothing is built at run
time. The member tables ship only when a program can reach reflection: one that can carries
all of them (a hello world with one extra `Class.forName` and `getDeclaredFields()` call goes
from 54.6 KB to about 4.6 MB at `-O2`), and one that cannot carries none. Where they differ from Java:
the class names are Teyru's (`String.class.getName()`
is `teyru.String`, and `forName` takes either spelling), annotations are reflectable but
their elements are read **by name** (`ann.stringValue("value")`, not Java's `ann.value()`),
all arrays share one class (so there is no `getComponentType`), there is no reflection of
generic type arguments, the primitive getters take an exactly matching box rather than
widening, and access control is not checked (only `final` is held back).
`java.util.function` (`lib/09`) provides `Function`/`BiFunction`/`Consumer`/`Supplier`/
`Predicate`/`Runnable`/`Comparator`.

```teyru
List<String> names = new ArrayList<String>()
names.add("ada")
for (String n : names) {
  System.out.println(n)
}
```

### Threads and synchronization (`lib/35`)

A thread is a **real operating system thread**: the runtime keeps one registry entry per
thread in `internal/runtime/src/tyrt_thread.c`, and the collector stops every one of them
and walks each stack before it traces the heap.

What is there is `Thread` (`Thread()`, `Thread(Runnable)`, `Thread(String)`,
`Thread(Runnable, String)`; `start`, `run`, `join`, `isAlive`, `getId`, `getName`,
`setName`, and `Thread.sleep(long)`, `Thread.yield()`, `Thread.currentThread()`) and the
`Runnable` interface, plus real `synchronized` (both the block and the **method modifier**,
where the method holds the monitor for its whole body, and the monitor is reentrant) and
`Object.wait(long)`/`notify`/`notifyAll`. An id is given to the `Thread` object when it is
built and never changes, and the main thread is 1.

**What is not there** (declared nowhere, so writing it is a missing symbol): `interrupt`,
daemon threads, thread priorities, `ThreadGroup`, `ThreadLocal`, `join(long)` with a
timeout, `Thread.State`, and an uncaught-exception handler — the runtime prints the line
Java's default handler prints, then the thread ends and the process carries on.

The collector is a **cooperative** stop-the-world, and that is the limitation worth
knowing: safepoints are the top of every loop body (which the generator emits), the
allocation slow path, waiting on the heap lock, and every call that blocks. So a thread
that neither loops nor allocates nor blocks (one stuck in a native `read()`, say) makes a
collection wait for it to come back. Allocation in a single-threaded program is
unchanged (every thread has its own allocation area). The end-to-end test is
`tests/programs/t159_threads.teyru`.

### Concurrency tools (`lib/37`, `lib/38`)

The two halves of `java.util.concurrent` this library carries: the executor half
(`Callable`, `Future`, `FutureTask`, `Executor`, `ExecutorService`, `ThreadPool`, and
`Executors` with `newFixedThreadPool`/`newSingleThreadExecutor`/`newCachedThreadPool`) and
the synchronizer half (`CountDownLatch`, `AtomicInteger`, `AtomicLong`,
`ConcurrentHashMap`), plus `ExecutionException`, `CancellationException` and
`RejectedExecutionException`. A task runs on one of the pool's threads, so its stack, its
allocation and its monitors belong to that thread; the `Future` `submit` answers waits in
`get()` until the task is done, and a task that threw is reported as an
`ExecutionException` whose cause is the throwable the task raised.

**Every one of these is a monitor, not lock-free.** The runtime has no hardware atomics, so
the pool's work queue is an `ArrayDeque` under the pool's monitor, `AtomicInteger` is the
object's monitor (not a CAS), and `ConcurrentHashMap` is one hash table behind one monitor
(no striping, no lock-free read path). Each call is atomic and any number of threads may use
them at once, but none of it scales the way `java.util.concurrent` scales: four threads
taking tasks from one queue contend on that one monitor. The waiting itself is
`Object.wait`, not polling: an object has exactly one monitor, a timed wait goes by the
monotonic clock, and a `notify`/`notifyAll` is not lost (every thread already waiting when
it happened wakes for it, and a thread that arrives later waits for the next one).

**`shutdownNow` is not Java's.** This language has no `interrupt`, so it cannot stop a task
that is already running: it refuses new work, hands back the tasks that never started, and a
task that is inside `run()` runs to its end. No method here takes Java's
`mayInterruptIfRunning`; a nominal flag that silently did nothing would be worse than no
flag.

**What is not there** (declared nowhere, so writing it is a missing symbol): `TimeUnit`
(every duration here is milliseconds, as in `Thread.sleep`), `invokeAll`/`invokeAny`,
`submit(Runnable)`, the scheduled executor, fork/join, `CompletionService`, `ThreadFactory`,
`CyclicBarrier`/`Semaphore`/`Phaser`/`Exchanger`, the atomic field updaters, and
interruptible waits (there is no `InterruptedException`). `ConcurrentHashMap` is not a
`Map`: no `clear`/`putAll`/`keySet`/`values`/`entrySet`, and `keys()` answers a snapshot
`Enumeration`.

### Time zones (`lib/46`)

The other half of `java.time.zone`, reading **the host's own IANA database** (the TZif
format): pure Teyru over `byte[]`, no natives and no new C, using only the file,
environment and string helpers that already existed. `ZoneId`, `ZoneOffset`, `ZoneRules`,
`ZoneOffsetTransition` and `ZonedDateTime`, plus `ZoneRulesException` (a subclass of
`DateTimeException`); `ZoneId.getAvailableZoneIds()` and `getAvailableIDs()` (the latter a
sorted `String[]`, the shape `java.util.TimeZone` has), `systemDefault()`,
`ZoneRules.getOffset(instant)`, `ZonedDateTime`'s arithmetic (a `plusDays` across a DST
boundary is the interesting one) with `withZoneSameInstant`/`withZoneSameLocal`, and the
overlap and gap pair (`withEarlierOffsetAtOverlap`/`withLaterOffsetAtOverlap`) — the ones a
program gets wrong when the layer does not have them.

**The format decisions**, each of them the difference between right and approximately right:
the version octet decides which block is read, and for version 2 and later the first block is
skipped by calculating its length from its header rather than parsed (reading it would be the
same transitions at 32 bits); the lookup is a binary search over the transitions; before the
first transition it uses the first type that is not DST (RFC 8536 says type 0 and
`tzfile(5)` says the first non-DST type — on the host this was written against every file
agrees, and the code says it follows the second, because that is what the C library does);
and **at or after the last transition the footer's POSIX rule string decides** — which is
what makes the *present* right, since most zones' last transition is in the past
(`Asia/Taipei`'s is 1979, `Europe/Moscow`'s 2014, New York's 2037), so a reader that stops at
the table answers the last rule the zone ever changed under, for ever. That POSIX TZ string
is a grammar of its own: the `Jn`, `n` and `Mm.w.d` rule forms, a `/time` in the wall time of
the offset in force before the transition, and offsets in POSIX's inverted sense (`CST-8` is
+08:00 east of UT); one it cannot read raises `ZoneRulesException` naming the source (a file
path, or `TZ=...`) and the part it could not read.

**What is deliberately absent**: `java.util.TimeZone` is not implemented *by decision* — this
library's whole date and time layer is java.time's, there is no `Date` and no `Calendar` for
it to serve, and the three things it would be asked for (`getAvailableZoneIds`,
`systemDefault`, `getOffset`) are here; the rule-*object* view (`ZoneOffsetTransitionRule`
and `ZoneRules.getTransitionRules`) is not here either, because the parsed POSIX string
answers the same questions; `getDisplayName` needs the CLDR locale data this library does not
have; a leap-second file is **refused rather than approximated** (the transition times in a
`right/` file are leap seconds, so a reader that ignored the corrections would be 27 seconds
wrong after 1972 — an answer that is wrong by 27 seconds is worse than no answer); and there
is **no compiled-in database**, so a host without tzdata (Windows, or a container that did
not install it) gets a named refusal — a `ZoneRulesException` whose message says which
directory was not there and what to install or set — rather than an offset. Only UTC, GMT, UT
and the numeric ids like `+08:00` are built in, because a program that needs only UTC should
not need tzdata.

**Where it differs from Java**: `ZoneId` implements `Comparable` (Java's does not, which is
why sorting zones there needs a `Comparator`); `setSystemDefault`, `setZoneInfoDir`,
`getZoneInfoDir` and `getAbbreviation` are this library's own additions (`getAbbreviation`
answers the file's designation, where a JVM reaches a CLDR name through a formatter); rules
are cached per id rather than shared, so `Europe/Kiev` and `Europe/Kyiv` read the file twice
and hold two equal objects where a JVM's provider shares one; and an id comes back from
`getId` exactly as the caller wrote it, not canonicalised.

`tests/programs/t188_timezone.teyru` is javac 21's output byte for byte,
`t189_timezone_lookup.teyru` is the policy side (the id list, the refusals, `TZDIR`/`TZ`, the
default zone), and `t190_timezone_tzif.teyru` proves which block is read with synthetic files
it writes itself rather than asserting it.

### TLS (`lib/15`, `lib/18`, `lib/32`)

TLS is the one layer of this standard library that it **does not implement itself**: the
cryptography underneath is OpenSSL, running on POSIX sockets. The pure-Teyru half is policy
and lifecycle — `TlsSocket` (`start(plain, host)` and `start(plain, host, caFile)` on the
client side, `accept(plain, ctx)` on the server side), `Tls` handing out a client context
(`clientContext(caFile)`), `TlsServer` holding one certificate and private key, and
`TlsException`/`TlsCertificateException` (the latter's message carries the reason OpenSSL
gave, because "certificate not trusted" answers only half of the question).
`HttpServer.ssl(certificate, privateKey)` hands the server the paths of a PEM certificate
chain and its private key — Spring's `server.ssl.certificate` and
`server.ssl.certificate-private-key` — and from then on every connection it accepts is TLS
and `isSecure()` answers whether it is; the pair of files is read and checked **at
configuration time**, so an unusable certificate fails where it is set up (where the program
can still say what is wrong) rather than making every client that arrives fail. An HTTP
client going to `https://` travels the same path.

**The layer only enters the executable if it can be reached.** It is the only part of the
runtime that links against a library the compiler does not ship, so it is a file of its own
(`internal/runtime/src/tyrt_tls.c`), and "whether this program can reach TLS" is decided by
the generated C: only if it can is that file compiled and `-lssl -lcrypto` added. A program
that does not use TLS therefore pays not one byte — hello world is still 54.6 KB. Note that
this decision is **reachability**, not actual execution: a program that uses reflection
carries a table naming every class, so it answers "can reach" even if it never calls TLS.

**This layer requires OpenSSL 1.1, and that is a preprocessor `#error`**
(`OPENSSL_VERSION_NUMBER < 0x10100000L`): `SSL_set1_host`, `BIO_meth_new`,
`TLS_client_method` and `SSL_CTX_set_min_proto_version` are all absent from 1.0.x. That is
said at compile time rather than letting the user read "undeclared identifier" one identifier
at a time in a runtime file the user did not write. **Only POSIX has this layer**; the other
targets are a **named refusal**, and it comes before any output file is written:

- `windows/amd64`: mingw-w64 has no OpenSSL, so there is no TLS library to link for that
  target.
- `darwin/amd64`, `darwin/arm64`: macOS ships SecureTransport, not OpenSSL.

What is refused is the **program**, not the call: as soon as reachable code can reach this
layer that target does not build, and the message names the target, the reason and the
targets that would work. The points and how to write it are in [docs/native.md](/en/docs/native).

No call can turn verification off: a client that was given a `caFile` takes that file's
certificate as a trust anchor and the system's for the rest. Timeouts are where this layer is
easiest to get wrong, so a test watches it specifically:
`tests/programs/t163_https_roundtrip.teyru` (server and client in one program, the
certificate given by path, verification passing and being refused once each, the body
compared byte for byte), `t191_tls_keepalive.teyru` (two requests on one TLS connection),
`t192_tls_handshake_timeout.teyru` (the peer completes the TCP connection and then says
nothing; the timeout must be a `SocketTimeoutException` and not be read as end of stream).

### Other packages

| Package | Files | Contents |
|---|---|---|
| `java.time` | `lib/20` | `LocalDate`/`LocalTime`/`LocalDateTime`/`Instant`/`Duration`/`Period`/`DayOfWeek`/`Month`; the calendar arithmetic is done on epoch days; time zones are `lib/46` (see "Time zones" above), and `LocalDate.now()`/`LocalTime.now()`/`LocalDateTime.now()` still read the system clock as UTC — that is the one deviation left in this file, and a zoned "now" is `ZonedDateTime.now()`. `LocalDate`, `Instant`, `Duration` and `DayOfWeek`/`Month` output byte-for-byte identically to the JDK; four places differ: the year is neither zero-padded nor given a plus sign (`1-01-01`, `10000-01-01`, where the JDK has `0001-01-01`, `+10000-01-01`), `LocalTime`'s `plus*`/`minus*` clear the nanoseconds (`00:00:00.000000001` plus one hour is `01:00`), `LocalDateTime`'s `plusHours`/`plusMinutes`/`plusSeconds` do not cross the day (`1899-01-01T23:00` plus 25 hours is `1899-01-01T00:00`), and `Period.between` and `addTo`/`subtractFrom` compute differently from the JDK (`2000-03-31` to `2000-04-30` is `P1M`, where the JDK has `P30D`) |
| `java.io` | `lib/16` | `File` (`listFiles`), `Path`/`Paths`, `Files` (`readString`/`writeString`/`readAllLines`/`exists`/`createDirectories`) |
| `java.util.regex` | `lib/21` | `Pattern`/`Matcher`: backtracking matching, supporting literals, `.`, `*`/`+`/`?`/`{n,m}` and their lazy forms, character classes, `\d`/`\w`/`\s`, `^`/`$`, `|`, capturing and non-capturing groups, `replaceAll`/`replaceFirst`/`split` (including all three signs of `limit`); unsupported syntax (possessive quantifiers, lookaround, backreferences, `\p{...}`) is rejected at `compile` time. `String.matches`/`replaceAll`/`replaceFirst`/`split` are exactly these five methods, not another implementation |
| `java.net` | `lib/15` | `ServerSocket`, `Socket`, `SocketInputStream`/`SocketOutputStream`; synchronous blocking POSIX sockets, with timeouts reported as `SocketTimeoutException`; TLS is a layer on that same path (`TlsSocket`/`Tls`/`TlsServer`/`TlsException`, see "TLS" above) |
| `java.util.Base64` | `lib/25` | The encoder (`encodeToString`); no decoder |
| `java.util.stream` | `lib/22` | `Stream`/`IntStream`/`LongStream`/`DoubleStream`, `Collectors` (26 factories), `Collector`, `Spliterator`/`Spliterators`, `StreamSupport`, statistics and the `OptionalInt` family; intermediate operations build the pipeline and only terminal operations pull, with `Collection.stream()` as the entry point |
| `java.math` | `lib/23` | `BigInteger` (base-2^30 limbs, sign and magnitude), `BigDecimal` (unscaled value and scale), `MathContext`, `RoundingMode`; the algorithms are translated from the JDK, because the number of decimal digits, the scale left behind by division and the rounding are all observable |
| `java.text` | `lib/24` | `NumberFormat`/`DecimalFormat`/`DecimalFormatSymbols` (the full pattern language), `DateFormat`/`SimpleDateFormat` (four styles and parsing), `DateTimeFormatter`, `MessageFormat`, `ChoiceFormat`, `ParseException`/`ParsePosition`. **There is no `Locale`** (only ROOT/en-US), **there is no `java.util.Date`** (`format`/`parse` go through `Instant`), and `format` has no `FieldPosition` overload |
| Rest of `java.util` | `lib/25` | `Properties`, `Random` (byte-for-byte like java.util.Random), `UUID`, `BitSet`, `StringTokenizer`, `Enumeration`, `ArrayOps` (the range form of arrays) |
| `java.security`/`java.util.zip` | `lib/40` | `MessageDigest` (`getInstance`, `update`, `digest`, `reset`, `getAlgorithm`, `getDigestLength`, `isEqual`), the `Checksum` interface and `CRC32` (Java keeps those two in `java.util.zip`), plus `GeneralSecurityException`/`NoSuchAlgorithmException`/`DigestException`. MD5, SHA-1, SHA-224, SHA-256, SHA-384 and SHA-512 are implemented in Teyru (`tests/programs/t173_digest.teyru`, `t174_crc32.teyru`); `getInstance` matches the name case-insensitively and `getAlgorithm` answers the caller's own spelling, as the JDK does. The JDK at 21 also answers for SHA3-256 and its siblings and for SHA-512/256 and SHA-512/224; `getInstance` throws `NoSuchAlgorithmException` for those rather than quietly answering with a different digest. `update` takes a `byte` (`java.security.MessageDigest` has no `update(int)`; that one is on `Checksum`, where `CRC32` has it). No Provider, no `getInstance(String, String)`, no `clone()`, no `update(ByteBuffer)`, no `toString()` override |
| `java.util.HexFormat` | `lib/41` | `of`/`ofDelimiter`, `withDelimiter`/`withPrefix`/`withSuffix`/`withUpperCase`/`withLowerCase` (each answers a new instance and leaves the original alone), `isUpperCase`/`delimiter`/`prefix`/`suffix`, `formatHex`, `parseHex`, `isHexDigit`/`fromHexDigit`, the two digit extractors, and six `toHexDigits` overloads. No `ByteBuffer`/`Appendable` overloads (this library has neither type), and `toString`/`equals`/`hashCode` are not overridden (`tests/programs/t175_hexformat.teyru`) |
| `java.io` streams | `lib/42` | The `OutputStream`/`Reader`/`Writer` interfaces, `ByteArrayInputStream`/`ByteArrayOutputStream`, `DataInputStream`/`DataOutputStream`, `BufferedReader`, `PrintWriter`, `UTFDataFormatException`. `writeUTF`/`readUTF` use Java's **modified UTF-8** (NUL is `C0 80`, a character above the BMP is the six bytes of its surrogate pair), and a string whose encoded length does not fit the unsigned short is a `UTFDataFormatException` with the JDK's message — checked **before** anything is written, so a refused string leaves the stream as it was. `BufferedReader` has Java's line grammar (LF, CRLF, a lone CR) but no buffer of its own, because the sources it wraps already read in blocks. No serialization, no streams over a file (the disk belongs to `lib/16`), no char[] `Writer` methods, no `DataInputStream.read(byte[], int, int)` (a blocking full read is `readFully`'s contract, not Java's short-read one), and a `SocketOutputStream` is not an `OutputStream` |
| `java.util.Scanner` | `lib/43` | Reads one `String`: `hasNext`/`next`, `hasNextInt`/`hasNextLong`/`hasNextDouble` with their `next*` forms, `hasNextLine`/`nextLine`, and `InputMismatchException`. The delimiter is Java's `\p{javaWhitespace}+`, so a `nextLine()` after `nextInt()` answers the rest of the line; the numeric tests are the parse itself, not a regular expression. No `useDelimiter`, no radix overloads, no `nextShort`/`nextFloat`, no `hasNext(Pattern)`/`findInLine` family, no locale-sensitive number formats, and no constructor from a stream |
| `java.util.zip` | `lib/44` | `Deflater`/`Inflater` (levels 0-9, `-1` meaning 6; `nowrap` picks raw deflate or the zlib wrapper; `deflate(..., flush)` takes `NO_FLUSH`/`SYNC_FLUSH`/`FULL_FLUSH`), `Adler32`, `GZIPOutputStream`/`GZIPInputStream`, `ZipException`/`DataFormatException`; RFC 1951 and RFC 1952 are written in Teyru, with stored, fixed-Huffman and dynamic-Huffman blocks all present. **Level 0 output is byte-identical to zlib's** (for a caller whose output array holds a whole block); above level 0 the bytes differ on purpose, because the match finder is this file's own. The decoder understands the JDK's and zlib's output at levels 0, 1, 6 and 9, raw and wrapped, for sizes from 0 to 65536 (`tests/programs/t177_deflate.teyru`), and the JDK's gzip output including two concatenated members (`t178_gzip.teyru`); a mismatched Adler-32 raises `DataFormatException("incorrect data check")` and a mismatched gzip trailer `ZipException("Corrupt GZIP trailer")`. Levels 4 and 5 use chains that differ from zlib's, which was a measured choice: zlib's level 4 came out **worse** than its level 3 on this repository's own sources (337,376 against 328,737 bytes), so level 4 searches as far as level 3 and spends the second search on top of it (322,147), and level 5's chain grows to 64 to stay above it (311,012). Memory is about 600 KiB, more than zlib's 256 KiB default. **It is also larger and slower than zlib**: deflating this repository's own `lib/*.teyru` (1,296,178 bytes) at level 6 produces output 1.45% larger than the JDK's `Deflater` (307,048 against 302,659 bytes) and takes 2.83x as long (92.9 ms against 32.81 ms; same machine, one warmup then best of five, timing the deflate work itself with `Deflater` construction included on both sides). **What is not there**: `DeflaterOutputStream`/`InflaterInputStream`/`CheckedOutputStream`/`CheckedInputStream`, `getLevel`/`getBytesRead`/`getBytesWritten`; `setStrategy` answers only for `DEFAULT_STRATEGY`/`FILTERED`/`HUFFMAN_ONLY`, with `Z_FIXED` among the refused; and when its source is not a `ByteArrayInputStream`, `GZIPInputStream` reads one byte at a time (this library's `InputStream` declares `read()` and nothing else), so a socket pays a call per byte |
| `java.util.zip` archive | `lib/45` | `ZipEntry`, `ZipOutputStream` (STORED and DEFLATED, `putNextEntry`/`write`/`closeEntry`/`finish`, the central directory and its end record), `ZipInputStream` (`getNextEntry`/`read`) and `ZipFile` over a path, a `File` or a byte array (`entries()`/`getEntry`/`getInputStream`/`size()`). The format decisions follow the JDK, because a reader has to agree with the other implementations: sizes and the CRC-32 go in the local header when the caller supplied them (and for DEFLATED only when the caller also set the compressed size, the JDK's `csizeSet` rule), otherwise general purpose bit 3 is set and a 16-byte data descriptor follows the data; STORED has no such option — a reader has to know where its data ends before the first byte — so its sizes are required and refused with the JDK's message, and encryption is refused by both readers with the JDK's messages. Names are UTF-8 with bit 11 set, a name without the bit is still read as UTF-8, and there is no `Charset` parameter: a Teyru string *is* its UTF-8 bytes. **ZIP64 is refused rather than half-written**: a value that does not fit a 32-bit field is a `ZipException` naming that field, and a reader that meets one of the magic `0xFFFFFFFF`/`0xFFFF` values says ZIP64 is not implemented here; the extra field is carried and not interpreted, so no extended-timestamp field is synthesized and `getTime()` always answers from the MS-DOS fields. Both readers check the CRC-32, the size and the compressed size when an entry's data has been read to its end — **the JDK's `ZipFile` does not**, and that is the one place this file deliberately disagrees with the JDK, in the direction of an exception rather than a silent wrong answer. `getInputStream` returns the concrete `ZipEntryStream` rather than `InputStream`, because this library's `InputStream` declares `read()` and `readln()` with no `read(byte[], int, int)` to override. A time is the MS-DOS date and time the format has, and `getTime()`/`setTime()` work in epoch milliseconds converting in UTC (where the JDK uses the JVM's default zone, so they differ by that offset outside UTC). Verified against two other implementations: `tests/programs/t185_zip_archive.teyru` and `t186_zip_file.teyru` round-trip through the JDK in both directions, and an archive written here was read by Info-ZIP's `unzip` (two entries listed, the content extracted byte for byte, `unzip -t` reporting no errors) |
| `java.util.concurrent` | `lib/37`, `lib/38` | The executor and synchronizer halves — see "Concurrency tools" above |
| `com.google.gson` | `lib/10`, `lib/19` | Gson's tree API, plus an object binding that reads the class's fields at run time (see [docs/json.md](/en/docs/json)) |
| framework | `lib/17`, `lib/18`, `lib/30`, `lib/33`, `lib/34`, `lib/36` | A Spring-shaped container and web layer: `SpringApplication.run`, `application.properties` with `@ConfigurationProperties`/`@Profile`, `@ControllerAdvice`/`@ExceptionHandler`, `HandlerInterceptor`, static files, CORS, `ResponseEntity`, `MockServer`, HTTP/1.1 keep-alive, chunked, cookies, HEAD and OPTIONS, WebSocket (`WebSocketHandler`/`WebSocketSession` + `server.addWebSocket`), sessions (`HttpSession`/`Sessions`, with expiry), uploads (`MultipartFile`), response compression (`HttpResponse.gzipBody`, using `lib/44`'s gzip), validation (`Validation`/`ValidationException`), and an accept loop that runs on a thread (`ServerTask`) — see [docs/framework.md](/en/docs/framework) |

### How names are found

Simple names follow JLS 6.5.5: first look at single-type imports (which shadow a package member
of the same name), then at the file's own package, then at on-demand imports, and only last at
the program-wide names (the default package and the prefix). When two `import p.*` both provide
the same name it is `TY-TYP-0099`, and one is not picked according to declaration order.

**The import itself is checked** (`TY-TYP-0115`): an `import` must point at a package the
standard library answers for (`teyru`, plus the compatibility ones `java.util`,
`com.google.gson`, `lombok`…, see the package table in the previous section), at a package
declared by some file in this build, or at a type whose fully qualified name is exactly that
path. In Teyru a name is found by its **simple name**, whatever package is written in front, so
`import java.utli.List` used to be silently ignored and then still got you `List`; now it is an
error. Module imports (`example.com/dep/pkg`) are resolved by the build and are outside the
scope of this check.

**Both single-type imports and on-demand imports (`import p.*`) work.** An import writes the
package's **declared name**: in a module build, a package's identity is its directory's import
path (`package todo` inside `example.com/app` is `example.com/app/todo`), while the import
writes `todo` — both spellings resolve. `import p.*` provides all the public names of that
package, and the package names the standard library answers for (`java.util.*`,
`com.google.gson.*`, `lombok.*`…) point at the standard library itself just like single-type
imports do; when two on-demand imports both provide the same name it is `TY-TYP-0099`. A type
the file **declares itself** takes precedence over on-demand imports (JLS 6.5.5.1), so writing
a `class Node` next to `import teyru.*` is not shadowed by the standard library's `Node`.

This project's own Teyru code always uses the on-demand form: one line per package. The same
goes for static imports; `import static java.lang.Math.max` is written as
`import static java.lang.Math.*`.

Prefix names are global — that is exactly why `List` and `String` work without an import — but
**a named package cannot see the default package** (JLS 7.4.2). So a user declaring
`class Node` in the default package does not break the `Node` the standard library itself
talks about; conversely, declaring a name in `package teyru` that the prefix already has is the
duplicate declaration `TY-TYP-0001`, because the two fully qualified names are the same.

### What is missing

**This list is empty now.** The standard library's gaps are stated where they belong — each
row of the package table above, or the section about it, names what its own package does not
have — and each of those is a decision rather than unfinished work: `MessageDigest` has no
SHA-3 because `getInstance` would rather throw `NoSuchAlgorithmException` than answer with a
digest the caller did not name; `shutdownNow` cannot stop a running task because this
language has no `interrupt`; a leap-second file is refused because an answer 27 seconds wrong
is worse than none; and `java.util.TimeZone` is not implemented because this library has no
`Date` or `Calendar` for it to serve.

Reflection is there (`java.lang.reflect`, §11). What it does not have: generic type
arguments, a class per array type (every array value belongs to one class, so there is no
component type to ask for), and Java's widening in the primitive getters — `Field.getInt` on a
`byte` field is an `IllegalArgumentException` here and a widening in Java.

When you need your own native library, a `native` method can be implemented in C, see
[docs/native.md](/en/docs/native).

## 12. Differences from Java

1. **No semicolons** (`TY-SYN-0001`).
2. The `for` header uses colons: `for (init : condition : update)`.
3. try-with-resources separates resources with newlines.
4. The enum constant section and member section are separated by a single colon.
5. **Native properties**: field plus accessor block; `field` denotes the backing storage.
6. **`val`**: a type-inferred local variable that cannot be rebound.
7. A captured local variable is not required to be effectively final.
8. No annotation processors, no JNI. Annotations are reflectable, with one difference: an annotation's elements are read by name (`ann.stringValue("value")`) rather than through the annotation interface's own methods, and an element whose value is an array is not carried.
9. The rules for generics and checked exceptions are the same as Java, but there is no
   checked-exception checking.
10. Type argument inference is one level weaker than javac, relying on the target type rather
    than full constraint solving (there is no JLS 18):
    - A lambda's type arguments are **inferred back from the body**: when the target is
      `Fn<String, ? extends R>` and the body is `s -> s.length()`, `R` is fixed as `Integer`.
      The other direction does not work — when the body itself is a generic call that needs a
      target type, the two depend on each other and the one-way substitution stops there:
      `words.stream().flatMap(w -> Stream.of(w.split(" ")))` can be written on its own, but once
      `.collect(...)` is attached `collect` cannot get the element type, so
      `Function<String, Stream<String>>` must be written out first.
    - If an argument has only one candidate method, that parameter's type is used as the
      target — so nested generic calls can be inferred.
    - **A generic call with free type variables gets no target type as a chained-call receiver**:
      `xs.sort(naturalOrder())` needs the type witness written out
      (`Comparator.<String>naturalOrder()`); `comparing(...).thenComparing(...)` gets no target
      type either, and a witness only takes effect when every type variable of that call is
      written out (`Comparator.<String,Integer>comparing(...)`), so otherwise it must first go
      into a variable with a declared type (`Comparator<String> c = comparing(...)`, then
      `c.thenComparing(...)`). javac handles both spellings.
    - An explicit witness belongs to its own call: in `pair(f, Builder.<Integer>make())` the
      outer witness is not overridden by the inner one.
11. **No capture conversion**: `List<? extends Number>` here is just `List<Number>`. The writes
    Java blocks through capture (`add` on a `? extends` container) are not blocked here; reads
    are no different (`list.get(0).doubleValue()` is accepted by javac too, so it is not
    capture conversion that holds it back).
12. **Strings are sequences of UTF-8 bytes, not Java's UTF-16 code units, and character
    classification and case mapping are ASCII-only.** `length`, `charAt`, `substring`,
    `indexOf`, `compareTo` and `hashCode` all count bytes, so the same expression answers
    differently here and on JDK 21. Measured (`teyru build`, then run; JDK 21 alongside):

    | Expression | Teyru | JDK 21 |
    |---|---|---|
    | `"中文".length()` | `6` | `2` |
    | `(int) "中文".charAt(1)` | `184` | `25991` |
    | `"😀".length()` | `4` | `2` |
    | `"ab中c".indexOf("c")` | `5` | `3` |
    | `"中".compareTo("文")` | `-1` | `-5978` |
    | `"中文".hashCode()` | `-1887180642` | `646394` |
    | `Character.isLetter('中')` | `false` | `true` |
    | `Character.isWhitespace('\u3000')` | `false` | `true` |
    | `Character.isDigit('１')` / `Character.digit('１', 10)` | `false` / `-1` | `true` / `1` |
    | `"ß".toUpperCase()` | `ß` | `SS` |
    | `"ΟΔΟΣ".toLowerCase()` | `ΟΔΟΣ` | `οδος` |

    The APIs that split a string by code unit (`codePointAt`, `codePointCount`,
    `offsetByCodePoints`) and `Character.getType`/`isSurrogate`/`toCodePoint`/`charCount` do
    not exist, see §13.

## 13. Not yet implemented

- Compile-time checking of checked exceptions (`throws` is only parsed)
- A `sealed` type's `permits` clause is not verified: a sealed type without `permits` is
  treated as undecidable for switch exhaustiveness and requires a `default`; the
  exhaustiveness of a switch **statement** is still lenient
- Threads only in part (`Thread`, `Runnable`, `synchronized` and `wait`/`notify` are there,
  see §11's "Threads and synchronization"): `interrupt`, daemon threads, priorities,
  `ThreadGroup`, `ThreadLocal`, `join(long)` and `Thread.State` are not, and the collector is
  a cooperative stop-the-world, so a thread that never loops, allocates or blocks makes a
  collection wait for it
- What reflection is missing: reflection of generic type parameters, an array class per
  element type (all arrays share one class), and Java's widening in the primitive getters
  (`getInt` on a `byte` field compiles in Java and is an `IllegalArgumentException` here)
- Interoperating with the Java ecosystem (JARs, the JDK class library, JNI)
- Unicode escapes in identifiers (`\u0041` cannot spell out an identifier)
- Explicit type arguments on a generic constructor `new <T>Foo(...)`
- The indentation rules for text blocks (currently the implementation strips the minimal
  indentation)
- The `java.lang.annotation` package (annotation reflection itself is there, see §11):
  `@Retention` is accepted and has no effect, and Lombok's `@onX` only copies the annotation
  onto the generated members and has no runtime effect whatsoever
- The semantics of the module system (`import module X` is parsed and then ignored, there is no
  module system at runtime; `module-info` is not supported)
- An array's runtime element type is always `teyru.Array`, so `String[].class` and
  `int[].class` are the same object (in Java they are two)
- **Known gaps in Java source compatibility** (javac accepts, this compiler refuses; all
  measured): `String.codePointAt`, `codePointCount` and `offsetByCodePoints` do not exist
  (`TY-TYP-0076`, cannot find method), and neither do `Character.getType`, `isSurrogate`,
  `toCodePoint` and `charCount`; `new String(char[])` and
  `new String(char[], int, int)` do not exist (`TY-TYP-0072`, no suitable constructor), and
  a method that ends in a `switch` whose every branch (including `default`) returns is
  misreported as `TY-TYP-0020` missing return; the semicolon is §12 item 1
- Standard library gaps: `String.format`'s `%t`/`%T` (date-time conversions) are not
  implemented, and hitting them stops with `ty_unimplemented` rather than printing
  something that looks reasonable; the rest are written where they belong, in §11's package
  table and in "Concurrency tools" (`Scanner` reads a `String` only, `MessageDigest` has no
  SHA-3 or SHA-512/256, `java.util.concurrent` is the executors plus four synchronizers, leap
  seconds are refused, and a host without tzdata gets a named refusal instead of an offset)
- An unresolvable fully qualified name (for example `com.example.Baz.qux(x)`) reports
  `cannot find symbol com` — the message points at the first segment of the chain rather than
  the whole path
