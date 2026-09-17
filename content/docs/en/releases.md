---
title: "Releases"
description: "Teyru's releases: 0.4.0 is the correctness release — what changed, what was measured, what is not implemented, and what this release deliberately does not claim."
---

This page describes **0.4.0**, the first release whose subject is correctness. It is the answer to
the set of problems an external review and a round of measurement found (the plan's W1–W12), and it
is not about speed — speed is the next phase.

It is written before 0.4.0 is cut, so every item carries its status: **in main** is behaviour a
reader can install today, and **partly in progress**, **not in main yet** and **not started** each
name the pull request or work item and change marker when they land. When the release is cut, none
of the last three should be left on the page.

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

### Strings and Unicode (W5 — **not in main yet**)

This is **not** on 0.4.0's main line today: the first piece's pull request is still a draft and the
rest is behind it. The goal is to make string storage and indexing agree with Java — `length`,
`charAt`, `substring`, `indexOf`, `compareTo` and `hashCode` counting UTF-16 code units
(`"中文".length()` is 2), character classification and case mapping from Unicode 15.0's data with the
full case mappings (`ß` → `SS`, the Greek final sigma), `strip` recognising the ideographic space,
ill-formed UTF-8 replaced with U+FFFD at the byte boundary and a surrogate with no partner encoded as
`?`. The internal storage is WTF-8 with breadcrumbs (`tystr` stays 24 bytes), and the fallback to
JDK-style compact strings still needs benchmark data before it can be compared, so this release does
not conclude on it.

Until it lands, the differences between **today's** behaviour and the JDK — with the measurements —
are in [docs/language.md](/en/docs/language) §12 item 12, the missing APIs in §13, and the byte
boundary's test (`t196_string_bytes`) is in the test repository.

### Boxing, container order and exception names (W6 — partly in progress)

- **The boxing caches** (in main): `Integer`, `Short`, `Byte` and `Long` cache −128..127, `Character`
  caches 0..127, and `Boolean` has exactly two instances, so
  `Integer.valueOf(127) == Integer.valueOf(127)` is `true` as it is in Java — and it survives a call
  (`t242_box_identity_across_call`, its expectation produced by javac).
- **The bounds message** (in main): `Index 5 out of bounds for length 3`, with the JDK's capital `I`.
- **Two parts not done**: `HashMap`/`HashSet` iteration order matching JDK 21, and
  fully-qualified exception names (`java.lang.*` rather than `teyru.*`). Both are listed in §13,
  with the iteration-order measurement in that entry and the class-name difference in §12 item 14.

### Java source compatibility (W7 — **not started**)

**Nothing has been claimed and nothing is on main**: the paragraph below is the goal, not a status,
and there are no numbers to give. The goal is to make "Java source compiles unchanged" true of a testable subset: semicolons optional,
`.java` files accepted as input, reachability and definite assignment by JLS §14.22 and Chapter 16
(which fixes the `TY-TYP-0020` false positive on a method ending in a `switch`), the missing APIs,
and the common generic inferences. Until it lands, this page does not claim that sentence — today's
differences are in [docs/language.md](/en/docs/language) §12 and §13, and
[docs/index.md](/en/docs) says the syntax is "familiar to Java developers", not that Java source
compiles unchanged.

### The two back ends' semantic consistency (W8 — **not started**)

**This one has just been taken (BackendMatrix) and nothing is on main yet** (the `internal/codegen`
it has to change was just touched by two large landings). The paragraph below is the goal, not a
status. The goal is a
matrix that agrees everywhere — {C+clang, C+gcc, LLVM} × {`-O0`, `-O2`} — with the
rules for numeric promotion, compound assignment, shifts, string concatenation, boxing and checks
lowered once and shared. The LLVM back end's present boundary (measured 2026-09-17: of 256 test
programs, 159 build, 153 of those produce exactly the expected output, 93 are refused by name, 4 are
refused before the back end and 0 modules are rejected by clang) is in
[docs/index.md](/en/docs), under "Back ends and platforms".

### TLS reachability, and the platforms (W9 — in main)

TLS is now linked by **the program's call graph** rather than being reachable through the reflection
tables: a web program that never calls `ssl()` builds and serves on a machine with no OpenSSL
headers, a Gson-shaped program builds for windows/amd64, and a program that does call `ssl()` is
unchanged (what it links and what it prints are identical). A call that arrives at TLS through
reflection gets a named, catchable `UnsupportedOperationException` instead of a jump to `NULL`.
`tests/run.sh` and `go test` both read `TEYRU_TARGET`, and `resolveTarget` honours the caller's
`--cc`, so `darwin/amd64` and `darwin/arm64` can be built through `teyru build` with `zig cc`.

### Benchmarks, and the claims that match them (W10 — partly in progress)

`examples/bench_*.teyru` and their `.java` counterparts now read their scale from the command line,
so `scripts/bench.sh` prints **two tables, short and long**, and there is a new `bench_string_cjk`
(non-ASCII concatenation, `charAt` walking, `substring`) alongside peak RSS. This page does not
restate performance numbers, because the numbers on that page only mean something together with the
method: see [docs/index.md](/en/docs), "Why it is faster than the JVM".

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
| Executable size (hello world, `-O2`) | **66,808 B** (`-O1` 85,440, `-O3` 70,248) | `wc -c`; larger than the 55,920 of the 0.2 era — 6,016 for the boxing caches, 2,256 for the stack check, 120 for W9's TLS link; the arithmetic is in [docs/index.md](/en/docs) |
| The LLVM back end's boundary | of 256 programs (`tests/programs` at `34584f2`), 159 build, 153 produce the expected output, 93 refused by name | 2026-09-17, `teyru build --backend=llvm` per program, compared against each `.expected` (the full breakdown is in [docs/index.md](/en/docs)) |
| `linux/arm64`, the whole suite | **250 cases pass, 0 differ** (qemu-aarch64, with a sysroot built in the container) | `sh tests/run.sh`; see the platform table in [docs/index.md](/en/docs) |
| The Windows target | 179 of 195 programs byte-identical (run under Wine) | same table |
| The two macOS rows | **compile and link only**: 188 programs build, the artifact is Mach-O; not one line has been executed | `zig cc -target <arch>-macos`; same table |
| What deep recursion costs | `bench_fib`'s long run is about 32% slower | `scripts/bench.sh`, long run, before and after; the owner has accepted it |

(The three platform rows are being re-measured after W9: `--cc` and `TEYRU_TARGET` turn macOS and
arm64 into paths `teyru build` can take, and this page and the platform table will be updated
together when that measurement lands.)

---

## 3. Not implemented

The full list is §13 of [docs/language.md](/en/docs/language), the standard library's gaps are §11
of the same page, and the runtime's and threads' known limits are `AGENTS.md` §10. This page does not
copy them; it gives the direction:

- checked exceptions have no compile-time checking;
- `sealed`'s `permits` clause is not verified, which is why switch exhaustiveness asks for a
  `default`;
- reflection has no generic type parameters, and all arrays share one class;
- there is no interoperability with the Java ecosystem (JARs, JDK class libraries, JNI), which is a
  deliberate trade.

## 4. What this release does not claim

- **Speed.** 0.4.0 is the correctness release: phase 5 of the plan (W13 compile speed, W14 runtime
  performance) is not in it, and W14 is marked optional in the plan itself. The regressions that were
  measured are written down above (`bench_fib`'s long run, 32%).
- **A precise or generational collector.** The owner's order is "fix these, cut 0.4, and then move
  the server's runtime to a precise or generational collector", so that belongs to whatever comes
  next; 0.4's collector is still conservative mark-and-sweep.
- **macOS running anything.** Those two rows stop at "compiles and links": no Mach-O executable has
  been run (there is no macOS here), and compiling is not running.
- **Java source compiling unchanged** — W7 has not started.
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
