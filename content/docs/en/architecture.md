---
title: "The Teyru Compiler Architecture"
description: "The complete pipeline from source file to native executable: lexing, parsing, semantic analysis, code generation (C or LLVM IR), the platform layer, and the runtime."
---

## Pipeline

```
Source file (UTF-8)
   │  internal/source      — file, line mapping, diagnostic container
   ▼
Token stream
   │  internal/lexer       — keywords, operators, literals, text blocks
   │                        newlines are not tokens; only an NL flag is set on the token
   ▼
AST
   │  internal/parser      — recursive descent; cursor + lookahead + choice-point backtracking
   ▼
Checked program model
   │  internal/sema        — symbol table, types, generic erasure, overloads, layout
   ▼
Generated code
   │  internal/codegen    — C back end (default): class→struct, vtable/itable, GC root info
   │                        LLVM back end (--backend=llvm): the program's own LLVM IR
   ▼
Native executable
      clang/LLVM or gcc + internal/runtime/src (GC, strings, arrays, exceptions)
                                    └ platform layer tyrt_plat.h → tyrt_plat_posix.c or tyrt_plat_win.c
```

## Newlines as Statement Terminators

Teyru has no semicolons. The lexer does not produce NEWLINE tokens; instead it records
on every token whether a newline preceded it. The parser uses two things to decide
whether a statement ends:

1. **Whether the newline at the current parse position is significant** (the `nl` stack;
   not significant inside parentheses or argument lists).
2. **Whether the prefix is already complete**. For example, a newline directly after
   `return` is a return with no value, but a newline after an operator, comma, `.`, `::`
   or `->` does not terminate the statement, and when the start of a line is `.` or `::`
   it is likewise treated as a continuation.

`continues()` in `internal/parser/parser.go` is the single decision point.

## Types and Symbols

- `ast.Type` has seven kinds: native, class (including type arguments), array, type variable, wildcard, null, error.
- Generics are erased in `sema.erasure`; at runtime only the class is known, not the type arguments.
- Overload resolution (`pickOverload`) follows the three JLS phases (strict, boxing allowed, variable arity);
  the first phase that finds an applicable candidate decides, and only within the same phase are conversion
  costs compared (exactly the same 0, widening/upcast 1, boxing 2, unboxing 3; when an upcast is still
  needed after boxing it is 3).
- A method's vtable slot is decided in `layout()`: copied from the superclass, and an overrider keeps the same
  slot; interface methods additionally have a globally unique selector (`Selector`) for the itable to use;
  each class's interface table is **sparse**, holding only the selectors it can actually implement, sorted
  by selector, and `ty_itab` scans these entries and then searches the superclass. (A dense table has one
  pointer per slot with as many slots as there are selectors in the whole program; a class pays for that
  `.data` no matter how few it implements, which is why hello world ended up carrying 792 KB.)

## Key Mappings to C

| Teyru | C |
|---|---|
| Class `Foo` | `struct C_Foo { tyobj obj; ... }` (fields flattened per `InstFields`, including inherited ones) |
| Instance methods | `M_<class>_<name>_<idx>(C_Foo* this, ...)` |
| Virtual call | `this->obj.cls->vtable[slot](...)` |
| Interface call | `ty_itab(obj, selector)(...)` |
| `new Foo(...)` | GNU statement expression: allocate → set `cls` → call the constructor |
| Arrays | `tyarr { tyobj; len; data; esize; refs; elemcls }`, elements stored inline |
| String constants | static `tystr` (does not go through the GC) |
| `try`/`catch` | `tycatch` + `setjmp`/`longjmp` |
| property reads and writes | lowered into getter/setter calls (recorded by `sema.Props`) |
| `for (a : b : c)` | C's `while`: `a` runs once, `b` is re-tested each iteration, `c` sits at the end of the loop, and `continue` jumps to the label at the end of the loop |
| record `Point(int x,int y)` | struct + constructor + `x()`/`y()` + `toString`/`hashCode`/`equals` |
| enum constants | static fields, created in `<clinit>` and filled with the ordinal/name |

### Why every binary carries the prelude (vtables and LTO)

The C back end writes a complete vtable per class and leaves "drop what nobody calls" to
clang's LTO. That cannot work, and the reason is worth writing down: **LTO cannot drop a
function whose address is taken**, and a vtable is a list of addresses
(`vt_X[i] = (void*)M_X_i`). `cls_X` is live in every program — `main` installs `String`,
`Object`, the arrays, the boxed types and the exception classes — so every instance method X
declares stayed live, each of those named the classes it allocates, and the closure swallowed
most of the standard library: a hello world that prints one string carries
`java.util.stream`, because `String.lines()` sits in String's table beside
`String.length()`. Measured in a hello world: **1,262 functions survive, 951 of them prelude
methods, and only 42 are reachable by being called**; the other 1,233 are there by address.
(`--no-lto` differs by only 17-54 KB at every commit checked, so this is not a change in
LTO's settings but in what the back end emits.)

**The rule has two halves**: *a slot is kept because a call site dispatches that index*, and
*only the classes that can be the receiver of that dispatch need to answer it*. A class can be
a receiver only if it inherits from the class the dispatch was compiled against, and the
generated C carries that class (`((RET(*)(OWNER*, ...))((recv)->obj.cls->vtable[N]))`), so the
second half is an `isSubclass` walk over the class records. Without it one reachable
`Class.toString` keeps slot 7 of every class that overrides that selector, which is most of
the library. The rewrite only ever writes `NULL` into a slot initializer, never renumbers or
shortens a table (so the layout the runtime and the class records share is untouched); a live
class always answers slots 0, 1 and 2; and the interface tables are left alone, because a
native method the program supplies may dispatch through one with a selector the compiler
never saw.

Deciding which indices have a call site means scanning the generated C, and the first version
scanned it wrongly: it ended a function body at the first line holding a lone `}`, while the
pattern-switch desugar writes its own closing brace at the left margin *inside* the function
— so those bodies ended early, every dispatch after the brace was attributed to no
definition, and the slots it read were filled with `NULL`. That is what broke
`t133_arrow_blocks`, `t84_sealed_switch` and `t51_java25_tour`. It counts braces now, aware
of string literals and comments (the generated C carries JSON in its literals, so `"{}"` is a
string and `/* */` can span lines), and a body ends when the depth returns to zero.

Measured on one machine with `-O2`: a hello world goes 501,072 -> 95,832 (the dispatch test
alone) -> 55,920 (with the receiver test on top); `t84_sealed_switch` 521,456 -> 113,904 ->
74,888, `t133_arrow_blocks` 509,536 -> 105,688 -> 61,064 and `t51_java25_tour` 523,696 ->
438,560 -> 253,328, each byte-identical in output at every step. **A program that reflects is
unchanged**: `t146_reflect` 4,859,976 and `t101_gson` 4,823,592, the same as before the
pruning, because reflection attaches every member table from `main`.

**The floor.** The C the pruned hello world emits has 628 vtable arrays; every one still
answers slots 0, 1 and 2, and exactly one has a filled slot at index 3 or above (`Class`'s
own, for 7, 12, 13 and 16). Slots 0, 1 and 2 cannot be narrowed the same way: the runtime
reads them by index on objects it did not create (`print_uncaught` and the string helpers
take `[0]`, `ty_obj_hash` `[1]`, `ty_obj_equal` `[2]`), so their owner is the hierarchy root,
and going further would need the fact that a class is never instantiated, which the emitted C
does not decide — and a wrong answer there is a jump to `NULL` rather than a wasted byte.

### The emitted C must not depend on any order C leaves unspecified

Java specifies that operands and arguments are evaluated **left to right**; C does not -- the
evaluation order of a function's arguments is unspecified. So a back end that hands Java's operands
straight to a C call is handing the semantics to the compiler. **The rule is therefore: the emitted C
must not depend on any order C leaves unspecified**; where that order matters, temporaries pin it
down (the same machinery the `new Foo(...)` row above needs from a GNU statement expression).

The rule was forced by running **two C compilers**, not by reasoning: the same program

```teyru
two(f(1), f(2))     // f prints the order it was called in
```

prints `1(1)2(2)` under clang (as javac does) and **`2(1)1(2)` under gcc** -- a wrong answer rather
than a crash, and identical at `-O0`, `-O1` and `-O2`, so no optimiser is responsible. That is why
the back-end matrix builds every program with both compilers: **with one compiler, this family of
defect is invisible**. Its reach was not one program: the matrix compares clang's and gcc's stdout
program by program, and **17 programs answered differently under gcc while matching the expectation
under clang**. **On `3cd9c70` (the v0.4.0 tag) the rule is enforced by the C back end**: the same
program prints `1(1)2(2)=3` under both clang and gcc (before the fix, gcc printed `2(1)1(2)`), and
the matrix keeps it pinned. **The LLVM back end has its own open item**: `EvalOrder` measured three
lines differing from the JDK at `--backend llvm -O0`; it is not a `make ci` leg, so it gates
nothing and is filed as new work.

## Back Ends and Platforms

### Two back ends

**The C back end is the default**: it generates C for the whole program, and the mapping
table above is its rules. `--backend=llvm` switches to the **LLVM back end**, which emits
**the program's own LLVM IR module** (`EmitLLVM` in `internal/codegen/llvm.go`): the runtime
is still C, and clang only assembles the module and links it against the runtime. The module
carries a target triple and calls this platform's C library directly, so it is right for the
platform it was written for and no other — linux/amd64 today, with every other target refused
by `TY-INT-0101`.

What cannot be lowered is a `TY-INT-0100` diagnostic naming the construct, and there is **no
fallback to the C back end**: a program either builds with this back end or gets a diagnostic
that says why. The boundary is measured: a sweep over `tests/programs` comes out at **76
byte-identical, 0 producing wrong output, 119 refused by the emitter, 0 modules clang
rejects** (that last number exits the sweep non-zero when it is not zero, because a module
clang will not accept is a bug and must not hide among the refusals). The refusals, in
milestone order, are: closures (lambdas and method references, plus local and anonymous
classes), the members that records, enums and annotations synthesize (constructors,
accessors, `equals`/`hashCode`/`toString`), type patterns and guarded switch cases, inner
classes, and the rest (`synchronized`, interface dispatch, try-with-resources,
`Class.forName`, and so on).

This is the state of the back end, not "Teyru does not use C": the runtime is C and so is the
default back end.

### The platform layer

Everything the runtime asks of the operating system is collected in
`internal/runtime/src/tyrt_plat.h`: forty-two `typlat_*` functions grouped into time and CPU,
mutexes, condition variables, threads, startup, sockets and files, implemented in two halves,
`tyrt_plat_posix.c` and `tyrt_plat_win.c`. Only `tyrt.c`, `tyrt2.c`, `tyrt_thread.c`,
`tyrt_net.c` and `tyrt_tls.c` call them (`tyrt_reflect.c` calls none). What is deliberately
**not** abstracted is written in that header too: mingw's C library is POSIX-shaped, so
`open`/`read`/`write`/`stat` are called straight from `tyrt_net.c`, and only the four things
whose shape differs (open flags, `mkdir`'s arity, `mkdtemp`, the temporary directory) sit
behind the layer.

TLS is the one exception to this layer, and the exception is itself a file: `tyrt_tls.c` is
written on **OpenSSL**, and it is compiled and given `-lssl -lcrypto` only when the program's
reachable code can reach it, so a program that does not use TLS is never linked against
OpenSSL; a target without OpenSSL (windows and macOS) is refused by name before any output
file is written, and OpenSSL's floor (1.1) is a preprocessor `#error`. See
[docs/native.md](/en/docs/native).

`teyru build --target <os>/<arch>` decides which compiler, which flags, which half of the
platform layer and which output suffix; the target table has five rows, with evidence of
different strength, listed in "Back ends and platforms" on the index page ([docs/index.md](/en/docs)).

## Performance Design

The C the default back end generates is compiled by clang/LLVM with `-O2` plus LTO (`--no-lto` turns it off; toolchains
that do not support LTO fall back automatically), and cross-function inlining, constant propagation
and loop vectorisation are all left to LLVM. On top of that, the compiler and the runtime deliberately
keep hot paths at the level of a single instruction:

| Mechanism | Location | Description |
|---|---|---|
| Inline allocation | `static inline ty_alloc` in `tyrt.h` | The bump pointer path is fully inlined; only when a block is exhausted or the GC threshold is exceeded is `ty_alloc_slow` called |
| Inline bounds check | `codegen.boundCheck` | The check is inlined as a statement expression at the point of use, producing one comparison for every index (constant indices too; `sema` does not fold them first, leaving the simplification to LLVM) |
| Constant folding | `codegen.foldBinary`, `ident` | Literal arithmetic and string concatenation are computed at compile time; a `static final` constant has its value substituted in, and the outer expression is left to LLVM |
| Dead chunk reclamation | the sweep in `tyrt.c` | If no object in a chunk is alive, the whole chunk is `free`d back to the system and later collections no longer walk it; a chunk still in use has every one of its blocks walked (counting the live ones once, marking or freeing once each), so the cost of a single collection is proportional to the amount of retained memory rather than to the amount of live memory |
| String constants | `codegen.strLit` | String literals are static `tystr`, neither allocated nor seen by the GC |
| Class initialisation | `codegen.clinitStmt` | Lazy initialisation, but the flag is tested by the generated code itself: the initialiser runs under the class's own monitor, and the flag is published only once it has returned (JLS 12.4.2), so a thread that reaches the class while another thread is initialising it waits for that initialiser instead of reading static fields that are not assigned yet; a class with no static initialiser block anywhere in its inheritance chain gets no `<clinit>` function (the slot is `NULL`), and `main` does not name it either — naming it means taking its address in `main`, and one address is enough for link-time optimisation to keep the whole class, together with its vtable, interface table and all its methods, in the executable |
| Escape analysis | `codegen.escape.go` | Objects that do not leave their method are placed on the C stack, letting LLVM promote fields and delete the object |
| Native interop | `codegen.native.go` | The C symbol and declaration of a `native` method are generated by the compiler (`--native-header`) |

Escape analysis (`escape.go`) only promotes local objects that satisfy both conditions at once:
the declared type is exactly the same as the class of the `new` (`sameCreatedClass`), and that class
has a compiler-allocated struct and a directly callable constructor (`promotable`). The decision is
made by walking every use inside the method (`escWalk`): using the object as a receiver to read a
native field, reading a reference field that "could not possibly hold this object", writing to the
object's own field (including `c.next = c`), `instanceof`, and calling a method whose "receiver does
not leak" all count as safe. As soon as the reference itself is consumed as a value (as an argument,
in `==`/`!=`, in a cast, or assigned to another variable), stored into another object or array,
returned/thrown/`yield`ed, captured by a lambda or method reference or anonymous class, or reaches a
node the analysis does not cover, it stays on the heap. Whether a method leaks its receiver is a
transitive analysis over the call graph (`leaksThis`): native methods are assumed not to, methods
without a body are assumed to, and a cycle encountered during the analysis is likewise treated as
leaking. A promoted object itself is not in a chunk (`valid_obj` rejects its address), but its
reference fields sit on the C stack, so the conservative native stack scan still sees the heap
objects it points to.

Known performance limits: escape analysis only covers objects that stay within their method; objects
that really do go on the heap still go through conservative mark-and-sweep (with no generational
assumption), so on loads where objects live a long time and are collected over and over, HotSpot may
still come out ahead. All five current benchmarks are faster than the JVM; see `sh scripts/bench.sh`
for how to reproduce them.

## Garbage Collection

- **Conservative mark-and-sweep**. Objects are not moved, so temporary pointers on the C side are always valid.
- Roots: the shadow stack (`ty_roots`/`ty_sp`), the table of static field addresses registered with
  `ty_gc_register_static`, and a **conservative scan of the native stack** (starting at the current stack
  pointer and ending at the top of the thread stack, obtained from `pthread_getattr_np`). A word on the stack
  is not guaranteed to be an object, so every candidate address must pass `valid_obj`: it must be 16-byte
  aligned, must be the start of some block in some chunk (the `starts` bitmap is rebuilt before each
  collection, and an address landing inside a block never counts), and must not be a block that has already
  been freed. A word outside the address range the slabs cover is rejected **before** the slab walk:
  a word outside that range cannot be in any slab, so the walk would have answered 0 for it anyway.
  It is a filter and nothing more -- it can only drop work, never change an answer.
- Marking: `tyclass.refoffs` lists the reference field offsets that need to be traced for each class; arrays use the `refs` flag.
- **Threads**: the runtime keeps one registry entry per thread (`internal/runtime/src/tyrt_thread.c`),
  and a collection stops every thread first and then scans each stack, so the stop is world-wide.
  The protocol is **cooperative**: the stop points are the top of a loop body, the allocation slow
  path, the wait for the heap lock, sleep/join/monitor waits, and the start of a thread; a thread
  that neither loops nor allocates nor blocks (one stuck in a native `read()`) reaches no stop
  point, and a collection waits for it to come back.
- Sweep: unmarked blocks enter size-classed free lists (`TY_NCLASS` classes; oversized ones go to `bigfree`)
  and are reused first by the next allocation; the highest bit of the block size word (the first word of the
  header) is `TY_FREE_BIT`, meaning already freed, and the free list link sits in the second word. A chunk that
  becomes completely empty is `free`d straight back to the system, so a long-running program does not hold on
  to its peak memory forever, but the **head chunk is the exception**: it carries the bump pointer and is
  always retained.
- Trigger: the single condition that the allocated amount exceeds `ty_gc_threshold`. The threshold starts at
  4 MB and after each collection is set to twice the live amount, never lower than 4 MB. Running out of chunks
  is **not** a reason to collect — when the free list has no usable block, a new chunk is simply grown, because
  collecting before the threshold is reached would only rescan the live objects for nothing.
- **A block taken off the free list is a root before it is handed out.** This one was a fix, and it is worth
  writing down because of how invisibly it broke: `ty_heap_unlock` is the only place that unlocks the heap
  mutex *before* it takes the thread out of the stopped state, so between taking a block off the free list and
  handing it to the caller that thread **still counts in `n_stopped`**. A collection that starts inside that
  window does not wait for it — it walks the slab, reads the block as saying it is empty (and nothing points at
  it either), and takes it as free space: it splices the block back onto the free list, or returns the whole
  slab to the system; then the thread wakes up, writes into the same memory and hands it out. The same memory
  is handed out twice, or written after it has gone back to the system. A four-thread allocation stress test
  (300,000 allocations each) produced 63 crashes in 400 runs before the fix, every one of them on the free-list
  path and every one of them inside the 256 KB slab a collection had just released; after the fix it was 0.

  The fix uses this file's own convention: put the block on that thread's shadow stack *before* the lock is
  dropped and remove it once the object exists, so the collector cannot miss it. **The collector was not
  changed at all**, and does not need to be; but the order matters — marking is not the end, a marked object is
  **traced**, and a block just taken off the free list still holds the previous tenant's bytes, so the size word
  and the mark word are written first, the class word is written as 0 (which makes tracing it a no-op) and only
  then is it pushed as a root, while the remaining bytes are cleared after the lock is released (otherwise a
  multi-MB array would be cleared while holding the heap lock). Only two places need this: the block the free
  list hands out and the first block of a freshly obtained slab; a block handed out by the bump path sits above
  the watermark the collector walks, so no collection can see it, and there it **must not** be added.
- Known costs: every collection must scan the entire stack in use, and there is no generational assumption; the
  sweep phase must additionally walk every block of every retained chunk.

## Exceptions

`ty_cur_catch` is a chain of handlers. `throw` calls `ty_throw`, which `longjmp`s to the nearest
handler; when there is no handler, it prints a message and exits with status 1.

`finally` has two paths, and both are indispensable:

1. **The exception path**: a handler is wrapped around the outside of the `try`, and after `setjmp`
   returns, `finally` runs first and the exception is then rethrown. A throw inside a catch block
   also takes the same path.
2. **The normal exit path**: `return`, `break` and `continue` do not go through `longjmp`,
   so the code generator maintains a finally stack (`Emitter.finallys`), and before each
   jump statement it first runs the `finally`s being left (from inner to outer), only then jumping.
   The `close()` of `try`-with-resources is an implicit `finally` of the same mechanism,
   so resources are closed on both the return and the exception paths.

Local variables captured by local and anonymous classes become fields of a synthetic class
(`Class.CapFields`), filled in by the constructor or the closure creation expression; this also
makes the "receiver of a method reference" evaluated only once, at creation time.
