---
title: "What is not there yet"
description: "The layers beyond the standard library that a real program hits: which exist, which do not, and what to do instead where one is missing."
---

This page answers one question: **where does a real service or tool written in
Teyru stop?** It is not the detail list of language gaps (that is
[the language reference](/docs/language) §13) and not the per-API differences
(§11's package table); it lists **whole layers** -- when a layer is missing, the
cost is not one method, it is that the job has to be done another way.

Every row says what exists, because "there is no JDBC" does not mean "you cannot
reach a database"; it means "you write the part that reaches a database". Claims
without a measurement are not written here.

## Data and interop

| Capability | Status | What to do now |
|---|---|---|
| SQL access (JDBC, pooling, ORM, migrations) | **Absent.** No SQL string anywhere in the standard library, no driver hook | Call `psql`/`sqlite3` through `ProcessBuilder` and parse what they print, or write a `native` method onto a C client library |
| XML, YAML, TOML, CSV | **Present** (`lib/56`-`lib/59`): four readers and writers, each refusing what it does not implement; XML's `DOCTYPE` is a named refusal that closes the XXE hole | Use them; the contract is in [the language reference](/docs/language) §11 |
| Java serialization (`Serializable`/`ObjectStream`) | **Absent, deliberately**: it writes the JVM's class description into bytes, which does not fit a native executable | Your own format (JSON binding exists) or an explicit `DataOutputStream` layout |
| JAR, JDK class library, JNI | **Named refusal.** A product-contract trade-off (no JVM), not a to-do | Native interop is a C `native` method; see [native interop](/docs/native) |
| Child processes | **Present**: `ProcessBuilder`/`Process`, three streams, directory, environment, exit status | Use it; there is no shell, so write `sh -c` when you want one |

## Cryptography

| Capability | Status |
|---|---|
| Digests | **Present**: MD5, SHA-1/224/256/384/512 in Teyru. SHA-3 is a **named refusal** -- `NoSuchAlgorithmException` rather than a different hash |
| Symmetric | **Present**: AES-128/192/256 in ECB/CBC/CTR/GCM with PKCS#5 padding; GCM verifies the tag before returning any plaintext |
| Asymmetric | **Half**: RSA PKCS#1 v1.5 **verification** and the public-key `Cipher`; **no signing** (the trade-off is at the top of `lib/53_rsa.teyru`) |
| HMAC, CSPRNG | **Present**: `Mac` (six Hmac*), `SecureRandom` (`getrandom`/`/dev/urandom`/`BCryptGenRandom`; throws rather than returning zeros when there is no source) |
| X.509 parsing, `KeyStore` | **Absent.** TLS is handed to OpenSSL and the language layer never sees the certificate; to read its fields you write the DER parser (`KeyFactory`'s DER reader is the starting point) |

## Networking

| Capability | Status |
|---|---|
| Synchronous sockets, TLS, an HTTP/1.1 client and server, WebSocket | **Present** |
| Non-blocking I/O and `Selector` | **Present** (heap `ByteBuffer`, three channels, a `poll`/`WSAPoll` selector) |
| HTTP/2, HTTP/3, SSE | **Absent.** HTTP/1.1 keep-alive, chunked and gzip are there; these three protocols are not |
| Asynchronous channels, `FileChannel`, `Charset` | **Absent** (the runtime has one encoding path, UTF-8) |
| Executors and synchronizers | **Present**: `Executors`, `CountDownLatch`, `Semaphore`, `CyclicBarrier`, `ReentrantLock`, `ReentrantReadWriteLock`, `Exchanger`, `Phaser`, `CompletionService`, `TimeUnit`, `ThreadFactory`, `CompletableFuture` (chains, `allOf`/`anyOf`, `exceptionally`/`handle`, `orTimeout`/`completeOnTimeout`), `Atomic*`, `AtomicIntegerFieldUpdater`/`AtomicLongFieldUpdater`/`AtomicReferenceFieldUpdater`, `ConcurrentHashMap`; **absent**: `ForkJoinPool`; `parallelStream()` answers a sequential stream |

## Text, data and locales

| Capability | Status |
|---|---|
| Regular expressions | **Present**: lookaround, backreferences, named groups, possessive quantifiers, atomic groups, flags, `\p{...}`; `\G`/`\R`/`\X`/POSIX classes are refused by name |
| JSON | **Present**: tree API, Gson-shaped binding, `JsonReader`/`JsonWriter` streaming |
| Localization | **Present**: `Locale` carries 47 locales' number, percent, currency, date and time patterns, names, eras and digit systems (all read out of OpenJDK 21; `t335_locale_table` compares all 47 line by line); the one deliberate difference is that bidi control characters (U+061C/U+200E/U+200F) are not emitted. **Absent**: `Collator`, `BreakIterator`, `ResourceBundle` -- three data sets of their own |
| Base64 | **Present**: basic, URL-safe and MIME, both directions |
| Date and time | **Present**: `Instant`, the `LocalDate` family, `ZoneId` over the host's tzdata; **absent**: `java.util.Date`/`Calendar` and leap seconds |

## Tooling and observability

| Capability | Status |
|---|---|
| Testing | **Present**: `teyru test`; see [the testing standard](/docs/testing) |
| Logging | **Present**: `java.util.logging`-shaped (levels, handlers, formatters, a JSON formatter) |
| Stack traces | **Absent.** An exception has a class name and a message; a failure's coordinate is the method name, which is why [the testing standard](/docs/testing) asks for one behaviour per method |
| Metrics, tracing, a profiler | **Not built in.** `-g`'s DWARF lets an external tool such as `perf` see source lines |
| Package ecosystem | **Present**: `teyru.mod` and `teyru get` (see [modules](/docs/modules)); **absent**: a public central index -- resolution goes through the import path |

## Platforms

| Target | Status |
|---|---|
| linux/amd64 | **Complete**: the whole suite |
| linux/arm64 | **The whole suite under qemu** (250 items measured 2026-09-17, 0 mismatches) |
| windows/amd64 | **Cross-compiled and run under Wine** (318 programs measured 2026-10-20, 0 mismatches); programs that touch TLS are refused by name (mingw-w64 ships no OpenSSL) |
| darwin/* | **Compile and link only**: there is no macOS here, so **not one line has run on it**. This is the one row that is "unknown" rather than "absent" |
