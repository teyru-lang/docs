---
title: "Releases"
description: "Teyru's releases: 0.4.0 is the correctness release — what changed, what was measured, what is not implemented, and what this release deliberately does not claim."
---

This page describes **0.4.0**, the first release whose subject is correctness. It is the answer to
the set of problems an external review and a round of measurement found (the plan's W1–W12), and it
is not about speed — speed is the next phase.

It is written before 0.4.0 is cut, so every item carries its status: **in main** is behaviour a
reader can install today, and everything else names its pull request or work item. **What is still
open is only what §3 and §5 list.**

**This release is the first time the gates actually run.** `.github/workflows/release.yml` is this
repository's **only** workflow and it runs when a release is published, so 0.4.0 is the **first**
release that gives it something to do: it builds the tag, runs the whole suite, attaches the
executables to the release, and calls six checks in order -- `make build`, `make ci`,
`make java-compat`, `make jdk-diff`, `make backend-matrix`, `make notices`. The numbers on this page
are those commands' output on that tag, and every row says how it was measured.

---

## 1. What changed

### Test infrastructure and the JDK differential (W1, W2 — in main)

- **The JDK differential**: `teyru emit-java` prints Teyru's AST as equivalent Java (semicolons
  restored, the `for` header turned back into `;`, `val` into `final var`, `java.*` names mapped to
  the standard library), and refuses a Teyru-only feature with `TY-INT-0102`, naming the feature and
  the reason. With `TEYRU_JDK=<JDK 21>` set, `go test` compiles and runs those programs and compares
  stdout and exit status; the expectations are **produced by a real JDK**, never written by hand.
- **The known-failures list**: `tests/known-failures.txt` holds `<case> <work item> <reason>` per
  line. A listed case that fails is reported but does not fail the run, and a listed case that
  *passes* fails the run — so an entry cannot outlive the bug it describes. Differences from the JDK
  that have been decided live in `tests/jdk-diff-allow.txt`, and platform differences in `.skip`
  files.
- **Two diagnostic switches**: `TEYRU_GC_STRESS=N` (collect every Nth allocation) and
  `TEYRU_GCTRACE=1` (print the trigger, the pause and the heap size around every collection).
- **`make ci` / `make jdk-diff` / `make notices`**: everything a CI job would run, run here by hand.
  This repository has **one** workflow (`.github/workflows/release.yml`), and it calls them when a
  release is published.
- **One process rule, because it happened**: a test pushed to main before the code it tests turns
  the whole gate red an hour later (that is what `t196_string_bytes` and `t180_http_gzip` did). The
  rule is now in the test repository's `README.md`: a test that arrives first carries a
  `known-failures.txt` entry in the same commit, and the entry is deleted when the code lands.

### The HTTP server, hardened (W3 — in main)

A server is now one accepting thread and a pool of workers behind it, bounded three times (64
workers, 100 connections waiting, 256 WebSocket sessions), and a connection past a bound gets a 503
instead of holding the server. The request line, the headers, the header count and the body all have
limits (414 / 431 / 413), and the deadlines are **totals** rather than per-read timeouts. The parser
refuses every RFC 9112 inconsistency (`Content-Length` together with `Transfer-Encoding`, disagreeing
duplicate lengths, obs-fold, whitespace before a colon, a chunk size that is not hexadecimal …) and
closes the connection; the WebSocket protocol's limits are 1002 / 1007 / 1009 / 1001. All
thirteen keys — twelve under `server.teyru.`, plus Spring Boot's own
`server.max-http-request-header-size` — and their defaults are in
[docs/framework.md](/en/docs/framework), under
"Concurrency" and "What a client is held to".

The evidence is what the plan's own reproduction scripts do now, which is the opposite of what they
did before: with a slow client connected (one byte every 4 seconds), another client's five
consecutive requests all answer `200` (they all timed out before), and a request declaring
`Content-Length: 1000000000` grows RSS by **36 kB** (it grew 983 MB before). The tests are `t220`
(byte bodies), `t221` (limits and strictness), `t222` (the parser fuzz), `t223` (slow client and 100
concurrent clients), `t224` (WebSocket close codes) and `t225` (`serve()` / `close()`).

**Two things this release does not claim.** Every wait a server does is bounded at **250 ms**, so
"no serving thread blocks for longer than 250 ms" is proven (`t223`); that a thread blocked in
`recv()` cannot delay a stop-the-world collection is a property of the runtime
(`internal/runtime/src`), and it is written down as a bound rather than as a fix. And the plan's
acceptance item about 64 idle keep-alive connections not delaying a collection has no measurement
behind it (it needs `TEYRU_GCTRACE` data), so this page does not cite it.

### Recursion that goes too deep is a `StackOverflowError`, not a dead process (W4 — in main)

Every generated function compares its own frame address against the thread's `ty_stack_limit` (the
stack bottom plus 256 KB) and throws the `StackOverflowError` preallocated for that thread — it is
catchable, and the thread and the process carry on. When native code really does run the stack out,
the SIGSEGV handler on its `sigaltstack` prints a line and calls `abort()` (it does not `longjmp`).
In a server, a deep recursion inside a handler is a 500 for that request and the server keeps
serving. The cost is measured: one check per function, and `bench_fib`'s long run is about 32%
slower for it (the owner has decided to accept that).

### Strings and Unicode (W5 -- **in main**)

**A string is now indexed the way Java indexes one.** `length`, `charAt`, `substring`, `indexOf`,
`compareTo`, `hashCode`, the `codePoint` family, `toCharArray`/`getChars`/`chars`/`codePoints` and the
`char[]` and `int[]` constructors all count **UTF-16 code units**; the storage is still WTF-8 (an ASCII
fast path, breadcrumbs built on first use, ill-formed bytes replaced with U+FFFD and an unpaired
surrogate encoded as `?`). Three things a reader meets first: `substring` **can split a surrogate
pair** (that is Java's semantics, not a defect), `hashCode` is the JDK's, and therefore
`HashMap<String, ...>` walks in the JDK's order. The plan's "switch to JDK-style compact strings"
fallback is **settled by measurement**: against the byte-indexed build, `bench_string` is 0.994x and
`bench_string_cjk` 0.949x, both inside the 10% budget, so the storage does not change.

**`Character` and the case mappings are Unicode 15.0**, from generated tables that ship in the
repository (the generator is `internal/tools/genunicode`, `make unicode-tables` re-runs it, and
re-running it changes no file): `isLetter`, `isDigit`, `isAlphabetic`, `isWhitespace`, `isSpaceChar`,
`getType`, `digit`, `getNumericValue`, the surrogate predicates, `toCodePoint`, `charCount`; full case
mapping (`ß` -> `SS`, the Greek final sigma); `strip`/`isBlank` go through `Character.isWhitespace`, so
**U+3000 is stripped** while `trim` still only knows <= U+0020; `parseInt`/`parseLong` accept the
full-width and other Nd digits (`Integer.parseInt("１２３")` is `123`). `StringBuilder`/`StringBuffer`
match Java now, including `delete(start,end)`'s clamping and `replace`'s `NullPointerException`.

**Two things stated rather than buried.** The final-sigma word predicate is this runtime's own: it was
measured against the JDK over 8,000 generated strings and every shape that was tested, and AGENTS.md
§10 records the **one** shape where it differs. The locale-sensitive mappings (`tr`, `az`, `lt`) are
**not implemented**.

**The work left two differences from the JDK** (both deliberate, both written up in
[docs/language.md](/en/docs/language) §12): the regex engine matches per **code unit**, so
`"😀a".matches(".a")` is `false` here (the JDK's `.` consumes a code point and answers
`true`); and `String.offsetByCodePoints` past either end throws `StringIndexOutOfBoundsException` where
the JDK throws `IndexOutOfBoundsException` (a subclass, so `catch (IndexOutOfBoundsException)` still
catches it).

**How I verified it.** On `adf58e7` (`tests` at `10ef6b2`), one program written twice -- as `.teyru`
and as Java -- run against OpenJDK 21 and diffed line by line: the writing half is **32 of 32
byte-identical**; the reading half is **39 of 41**, and the two that differ are exactly the divergences
above (the `ß`/`SS` mapping, the final sigma, `strip` over U+3000 and the full-width `parseInt`
acceptances and rejections are all inside the 39). The corpus, `sh tests/run.sh java-compat`, is **45
passed, 0 failed** (my own runs, twice).

### Boxing, container order and exception names (W6 -- **in main**)

- **The boxing caches** (in main): `Integer`, `Short`, `Byte` and `Long` cache −128..127, `Character`
  caches 0..127, and `Boolean` has exactly two instances, so
  `Integer.valueOf(127) == Integer.valueOf(127)` is `true` as it is in Java — and it survives a call
  (`t242_box_identity_across_call`, its expectation produced by javac).
- **The bounds message** (in main): `Index 5 out of bounds for length 3`, with the JDK's capital `I`.
- **Container order** (`w6boxing`): `HashMap`/`HashSet` iteration order follows the JDK 21
  layout (decision D7). The program that measures it is `t250_map_order` in the test repository,
  and its expectation came from running `t250_map_order.java.ref` on the JDK: the five string
  keys (inserted as `banana`, `apple`, `cherry`, `date`, `elderberry`) walk as `banana, date,
  apple, cherry, elderberry`, character for character as the JDK does. A bucket keeping insert
  order, the 13th key growing the table to 32 slots, the copy constructor and `putAll`
  pre-sizing, and the threshold doubling under a 0.6 load factor (9 then 18) each have a line.
- **Exception names and messages** (in main): `Class.getName()` reports the JDK's
  fully-qualified name (decision D8), so an uncaught exception prints `Exception in thread
  "main" java.lang.IllegalStateException: boom`, as the JDK does (`t251_exception_names`,
  `t79_uncaught`); `System.arraycopy`'s type-mismatch message is the JDK's too
  (`arraycopy: type mismatch: can not copy long[] into byte[]`, `t65_arraycopy`). The three
  messages that are not aligned -- a cast's module/loader parenthetical, the helpful
  NullPointerException message, and `ArrayStoreException`'s element class -- are listed in the
  test repository's `known-failures.txt`.

### Java source compatibility (W7 -- **in main**)

**It is in**: main `07ce0a3` (PR [#124](https://github.com/teyru-lang/Teyru/pull/124), 8 commits). I
re-ran the behaviour on main rather than trusting the branch: a `.teyru` may keep its semicolons, a
`.java` file is accepted as input, `xs.sort(naturalOrder())` and
`Comparator.comparing(f).thenComparing(g)` no longer need a type witness, and `String.join` resolves.
When this section was written W5 was not in yet (what was missing then was `new String(char[])` and
`String.codePointAt`); both are in now (see the W5 section above). What is still missing is a nested
generic inference -- where the body is itself a generic call that needs a target type -- which still
has to be written out.

**The corpus is reproducible from main now.** `teyru-lang/tests` main is `af41a7d` (45 unmodified Java
programs), and Teyru main's submodule pointer reaches it since PR
[#128](https://github.com/teyru-lang/Teyru/pull/128) merged (`0e8e592`). I ran `sh tests/run.sh
java-compat` myself on that content: **45 passed, 0 failed, 0 known, 0 skipped** -- so the PR body's
45 of 45 reproduces, it is not a branch-only fact. **The full suite on main is `324 passed, 1 failed, 10 known, 0 skipped`** (same content: Teyru
`0e8e592` -> `tests` `af41a7d`; run to completion by W7's author, log quoted in a comment on PR
[#128](https://github.com/teyru-lang/Teyru/pull/128)). The one failure is `native/net_c_test`'s link
failure (`go test` does not run that file), and the ten known failures are exactly the entries
`known-failures.txt` holds right now (`t230`, `t231`, `t234`-`t237`, `t239`, `t246`-`t248`; I checked
the list), so "every listed case fails and nothing passing is listed" holds. All 45 java-compat cases
are inside the 324.

**Why the two sets of numbers differ is worth saying:** the PR body's `320 passed, 1 failed, 9 known`
measures the branch pair -- tests main carries W8's boxed-assignment probes (`t246`-`t248`, all three
known failures) and no longer lists `t180`/`t196`, which W5's test work removed. This page quotes the
main set; I re-ran the 45 corpus cases myself, and the suite line has the source named above.

**Until the corpus lands, this page claims the subset, not the sentence.** The bounds are
[docs/language.md](/en/docs/language) §12 (the syntax) and §13 (the APIs that are missing and the
forms that are refused), and they are not empty.

### The two back ends' semantic consistency (W8 -- **in main**)

**The matrix landed first (`#122`)**: `scripts/backend-matrix.sh` and `make backend-matrix` build and
run every program in `tests/programs` in **six cells** -- {C+clang, C+gcc, LLVM} x {`-O0`, `-O2`} --
compare each cell with `.expected`/`.exit`/`.experr` and the cells with each other, and count a
build the driver refuses by name (LLVM's `TY-INT-0100`, say) as a refusal rather than a miscompile.
The release workflow calls it alongside `make ci`/`make jdk-diff`/`make notices`. The cross-cell
differences that are allowed live in `scripts/backend-matrix-allow.txt`: an entry without a work item
and a reason is not accepted, and an entry that no longer diverges fails the matrix. The numbers it
reached at the stop (406 cells, 66 programs complete across all six) are in §2.

**Both defects it found are fixed (`#129`, `#131`).**

- **A compound assignment to a boxed target**: the two back ends now share one lowering (JLS 15.26.2's
  unbox, operate, box), so `1L <<= 33` is `8589934592` (the JDK's answer) and the red-first cases
  `t246`/`t247`/`t248` pass -- their `known-failures.txt` entries are gone, which is what the mechanism
  demands.
- **The evaluation order of `a + b + c`**: the C back end no longer folds the expression into one C
  expression, so gcc and clang both print `1(1)2(2)3(3)=6`, as javac 21 does (I built it once with each
  `--cc` to check).

**One thing this release still does not claim, said out loud**: Java treeifies a `HashMap` bin of eight
or more entries once the table reaches 64 slots, and the order after treeification is settled by
`System.identityHashCode`, which is not reproducible in principle. So we do not claim the JDK's
iteration order **for that shape**. **Below 64 slots nothing treeifies**, so every smaller table walks
in Java's order for any key set (I checked against the JDK with six string keys and with 20 keys of a
custom hashCode-only type).

### TLS reachability, and the platforms (W9 — in main)

TLS is now linked by **the program's call graph** rather than being reachable through the reflection
tables: a web program that never calls `ssl()` builds and serves on a machine with no OpenSSL
headers, a Gson-shaped program builds for windows/amd64, and a program that does call `ssl()` is
unchanged (what it links and what it prints are identical). A call that arrives at TLS through
reflection gets a named, catchable `UnsupportedOperationException` instead of a jump to `NULL`.
`tests/run.sh` and `go test` both read `TEYRU_TARGET`, and `resolveTarget` honours the caller's
`--cc`, so `darwin/amd64` and `darwin/arm64` can be built through `teyru build` with `zig cc`.

### Benchmarks, and the claims that match them (W10)

`examples/bench_*.teyru` and their `.java` counterparts now read their scale from the command line,
so `scripts/bench.sh` prints **two tables, short and long**, and there is a new `bench_string_cjk`
(non-ASCII concatenation, `charAt` walking, `substring`) alongside peak RSS. The measurement window
ran to completion (`RUNS=5 JAVA=1`, `-O2`, tree `130565a`, no 1-minute load sample above 1 while it
ran). **The long table is the only group that can support a throughput claim, and it says Teyru wins
none of its six rows** (`fib` is a tie; Java is 1.13x to 6.8x faster on the rest) -- the short
group's advantage is startup, not throughput. This page does not restate the numbers, because they
only mean something together with the method: see [docs/index.md](/en/docs), "Why it is faster than
the JVM". The GraalVM `native-image` comparison was **not measured** (there is no GraalVM in this
image) and is recorded as not measured rather than guessed at.

### Third-party notices, and the rules (W11, W12 — in main)

- `THIRD-PARTY-NOTICES.md` now has OpenSSL (the 1.1 floor, dynamically linked), the mingw-w64 runtime
  the Windows target statically links, the host's own IANA tzdata (not distributed, not embedded) and
  W5's Unicode data (Unicode License v3). The runtime is no longer listed file by file: it is
  declared by directory, and the list is generated — and checked — by `scripts/check-notices.sh`
  (`make notices`).
- `AGENTS.md` gained three rules: a Java-semantics change comes with a JDK differential test,
  network-facing code comes with adversarial tests, and every capability claim in the docs has to
  point at the test that backs it.
- **GPL-2.0 with Classpath Exception versus OpenSSL 3 (Apache-2.0)** is recorded as the owner's
  decision; the documents state the facts and draw no conclusion (see
  [docs/legal.md](/en/docs/legal) §9).

---

## 2. What was measured

Every number is meant to be read with its method and its environment; this page carries only the
ones this release is about:

| Measured | The number | How |
|---|---|---|
| Executable size (hello world, `-O2`) | **67,240 B** (`-O0` 118,608, `-O1` 90,352, `-O3` 70,672) | `wc -c`; larger than the 55,920 of the 0.2 era — 6,016 for the boxing caches, 2,256 for the stack check, 120 for W9's TLS link; the arithmetic is in [docs/index.md](/en/docs) |
| The LLVM back end's boundary | of 256 programs (`tests/programs` at `34584f2`), 159 build, 153 produce the expected output, 93 refused by name | 2026-09-17, `teyru build --backend=llvm` per program, compared against each `.expected` (the full breakdown is in [docs/index.md](/en/docs)) |
| `linux/arm64`, the whole suite | **250 cases pass, 0 differ** (qemu-aarch64, with a sysroot built in the container); re-measured after W9 under `TEYRU_TARGET`: **271 passed, 5 failed, 10 known of 286**, and all five fail **natively too** | `sh tests/run.sh`, and `TEYRU_TARGET=linux/arm64 ... sh run.sh`; see the platform table in [docs/index.md](/en/docs) |
| The Windows target | 179 of 195 programs byte-identical (run under Wine) | same table |
| The two macOS rows | **compile and link only**: 240 of 257 programs build, 9 are refused by name for TLS and 8 are not accepted by the compiler used; the artifact is Mach-O and **not one line has been executed** | `teyru build --cc <zig wrapper>` (`zig cc -target aarch64-macos`); same table |
| What deep recursion costs | `bench_fib`'s long run is about 32% slower | `scripts/bench.sh`, long run, before and after; the owner has accepted it |
| W7's corpus | **45 passed, 0 failed** (`tests/java-compat`; Teyru main `9be8159` → `tests` `4ac49a7`) | `sh tests/run.sh java-compat` on that content (my own run; `make java-compat` is the same thing) |
| Strings and Unicode (W5), JDK differential | writing half **32 of 32 byte-identical**; reading half **39 of 41**, the other two being the stated divergences | one program written twice (`.teyru` and Java), the Java half run with `/opt/jdk21/jdk-21.0.11+10`, then diffed line by line; on `9be8159` |
| W8's two defects | boxed compound assignment `1L <<= 33` is `8589934592`; `f(1)+f(2)+f(3)` prints `1(1)2(2)3(3)=6` under both clang and gcc | `t246`-`t248` (whose `known-failures.txt` entries are gone) and one program built once with each `--cc`; compared with javac 21 |
| The full suite | **324 passed, 1 failed, 10 known, 0 skipped** -- measured on `0e8e592` -> `tests` `af41a7d`, which is older than the current main (`known-failures.txt` had ten entries then and has four now); the one failure is `native/net_c_test`'s link failure | `sh tests/run.sh`; the log and the list are in a comment on PR [#128](https://github.com/teyru-lang/Teyru/pull/128) (this row is not my run; the re-derivation will run on the tagged commit and follow it) |

(The macOS row was re-measured after W9 (2026-09-17, `tests` at `e4268a6`, compiler at
`5ac017b`), and the `linux/arm64` row's `TEYRU_TARGET` re-run has finished, so both of its
numbers are in the table above.)

---

## 3. Not implemented

The full list is §13 of [docs/language.md](/en/docs/language), the standard library's gaps are §11
of the same page, and the runtime's and threads' known limits are `AGENTS.md` §10. This page does not
copy them; it gives the direction:

- checked exceptions have no compile-time checking;
- `sealed`'s `permits` clause is not verified, which is why switch exhaustiveness asks for a
  `default`;
- reflection has no generic type parameters, and all arrays share one class;
- the locale-sensitive case mappings (`tr`, `az`, `lt`) are not implemented, so `String.toUpperCase()`
  always follows the root locale;
- there is no interoperability with the Java ecosystem (JARs, JDK class libraries, JNI), which is a
  deliberate trade.

## 4. What this release does not claim

- **Speed.** 0.4.0 is the correctness release: phase 5 of the plan (W13 compile speed, W14 runtime
  performance) is not in it, and W14 is marked optional in the plan itself. The regressions that were
  measured are written down above (`bench_fib`'s long run, 32%), and W10's long table is the evidence
  for that position: Teyru wins none of its six rows -- with `bench_alloc` set aside, because that row
  measures Teyru really allocating against Java having the allocation optimised away, and with the JIT
  off the same program is about 20x faster here (see [docs/index.md](/en/docs)). The exceptions are
  startup, executable size and
  peak RSS -- those are measured, and they are what this release really wins on.
- **A precise or generational collector.** The owner's order is "fix these, cut 0.4, and then move
  the server's runtime to a precise or generational collector", so that belongs to whatever comes
  next; 0.4's collector is still conservative mark-and-sweep.
- **macOS running anything.** Those two rows stop at "compiles and links": no Mach-O executable has
  been run (there is no macOS here), and compiling is not running.
- **A `HashMap`'s iteration order in that one shape.** Once the table reaches 64 slots, Java treeifies
  a bin of eight or more entries, and the order after treeification is settled by
  `System.identityHashCode`, which is not reproducible in principle -- so that shape is not claimed to
  match the JDK (below 64 slots nothing treeifies; see the W8 section).
- **"Java source compiles unchanged" as a sentence with no bounds.** W7 is in main and unmodified
  Java compiles on **the subset that has been tested** (above), but the corpus is not in main's
  submodule pointer and the §12/§13 differences are still there -- so this release claims the
  subset, not the sentence.
- **Agreeing with javac.** We do not: `'😀'` is `TY-SYN-0008` here (a `char` literal is one UTF-16
  code unit), while **JDK 21 accepts it** and takes 55357 — that one is us being stricter, not us
  being right.
- **Tracking checked exceptions.** Nothing is tracked: `throws` is only parsed, and 8 of the 16
  programs javac refuses in the JDK differential are refused for that reason (one line each in
  `tests/jdk-diff-allow.txt`). The owner has decided to keep this as a documented divergence rather
  than a to-do.
- **Static initialisation as eager as Java's.** The compiler initialises the program's own classes
  before `main`; Java initialises on first use. The difference and its tests are in `AGENTS.md` §10.
- **The LLVM back end being at parity with the C back end.** It is **not** what a release build
  uses (C is the default), and the two are not equivalent: measured on 2026-09-17 over 256 test
  programs, 159 build, 153 of those produce exactly the expected output, 6 differ (the JDK probes,
  listed in `known-failures.txt`), 93 are refused by name, and 0 modules are rejected by clang.
  Lambdas and method references are no longer among the refusals; annotations on the program's own
  declaration are, first by count (38). The full breakdown is in [docs/index.md](/en/docs).
- **CI.** There is no CI on a push or a pull request (the owner's decision): the gate is a person
  running `make ci` on this machine, and the one workflow is the one that publishes a release.

## 5. What needs the owner

- **The licence question**: GPL-2.0 with Classpath Exception versus OpenSSL 3 (Apache-2.0), and what
  distributing a windows/amd64 artifact that statically links the mingw-w64 runtime obliges
  ([docs/legal.md](/en/docs/legal) §9).
- **Automatic deployment of this site**: authorising Vercel's GitHub App for the `teyru-lang`
  organisation. Until then every docs change needs someone to run `vercel deploy --prod`.
