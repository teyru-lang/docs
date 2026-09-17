---
title: "Third-party notices"
description: "The third-party components that the Teyru project actually uses and distributes, and how each is licensed and distributed."
---

This document lists the third-party components that the Teyru project actually uses and distributes. The license of the project itself is in `LICENSE`.

> The compiler uses only the Go standard library, and `go.mod` has no external module dependencies.
> The executables it produces link against third-party code in three places: OpenSSL on the POSIX
> targets (TLS, dynamically linked), the mingw-w64 runtime on the `windows/amd64` target
> (`-static`, linked into the artifact), and the **host's own** IANA tzdata (shipped by the host;
> this project neither distributes nor embeds it). The runtime (`internal/runtime/src`) and the
> standard library (`lib/*.teyru`) are original code of this project.
>
> This list is not maintained by memory: `scripts/check-notices.sh` (`make notices`) checks it
> against the compiler repository — the runtime file list, the OpenSSL version floor, the
> `windows/amd64` link flags, where the time zone data is read from, whether the license files are
> still there, and whether a Unicode data file that has landed is named. It exits non-zero when the
> two disagree. This page is the site's counterpart of `THIRD-PARTY-NOTICES.md` in
> `teyru-lang/Teyru`.

---

## 1. Required to build the compiler

| Component | Purpose | License | Distribution |
|---|---|---|---|
| Go standard library (`go1.26` or later) | Building `cmd/teyru` and `internal/*` | BSD-3-Clause (Copyright The Go Authors) | Not distributed; the user installs it |

The Go standard library is released under the BSD 3-Clause license, with the terms at
[https://go.dev/LICENSE](https://go.dev/LICENSE). This project has not modified the standard library, nor embedded it in its artifacts.

---

## 2. Required to produce executables (backend)

| Component | Purpose | License | Distribution |
|---|---|---|---|
| clang / LLVM (default backend) | Compiling the generated C into native executables | Apache-2.0 with LLVM Exceptions | Not distributed; the user installs it, and gcc may be used instead |
| GCC (alternative backend) | Same as above | GPL-3.0-or-later (runtime exception) | Not distributed; the user installs it |
| libc / libm | System libraries used at runtime | Varies by system (mostly LGPL-2.1+ or MIT) | Dynamically linked, not distributed |

The executables that are produced **link** against these libraries, but do not contain their source code. The Teyru runtime
(`internal/runtime/src`) is itself original code of this project, and has no licensing relationship to the components above.

Threads use the system pthread (part of libc since glibc 2.34), and what else is linked is `-lm` and `libc`:
`ldd` on a program whose whole body is `System.out.println` shows `libm.so.6` and `libc.so.6` and nothing else.
That is **dynamic** linking, so the executable does not contain libc's code.

---

## 3. Third-party libraries linked into executables

| Component | Purpose | License | Distribution |
|---|---|---|---|
| OpenSSL (`libssl`, `libcrypto`) | TLS, implemented in `internal/runtime/src/tyrt_tls.c`; compiled and linked only when the program's reachable code can reach TLS | 1.1.1 is dual-licensed OpenSSL/SSLeay; 3.0 and later is Apache-2.0 | Dynamically linked (`-lssl -lcrypto`), not distributed |
| mingw-w64 runtime (crt and winpthreads) | The C runtime and threads for the `windows/amd64` target, which builds with `x86_64-w64-mingw32-gcc` and `-static` | Zope Public License 2.1 (the `COPYING` shipped by the `mingw64-crt` package; the same package's `DISCLAIMER.PD` additionally marks parts as public domain, and individual files are marked BSD or LGPL) | **Statically linked into the artifact**, so distributing the executable distributes it |
| Microsoft C runtime and Windows system DLLs (`msvcrt.dll`, `KERNEL32.dll`, `WS2_32.dll`) | The C library and Winsock for the Windows target | Part of Windows | Not distributed; the artifact only imports them, and the system provides them at load time |
| The host's IANA tzdata (TZif files) | `lib/46_timezone.teyru` reads the time zone database | Decided by whoever distributes it. On this machine (Fedora 44) the `tzdata` package is marked `LicenseRef-Fedora-Public-Domain AND (GPL-2.0-only WITH ClassPath-exception-2.0)` | **Not distributed, not embedded**; see "tzdata" below |

### OpenSSL

TLS is the one layer of this project that is **not implemented here**, and it only enters an executable when a program can reach it. The target table in `internal/driver/driver.go`
names `-lssl` and `-lcrypto` in `tlsLibs` for `linux/amd64` and `linux/arm64`: both are needed,
because the X509 and EVP calls are libcrypto's, and `-lssl` does not pull in libcrypto on every platform's linker.
`ldd` on a program that uses TLS (`tests/programs/t191_tls_keepalive.teyru`) shows
`libssl.so.3` and `libcrypto.so.3` — **dynamic** linking, so the artifact contains no OpenSSL code,
and libssl's terms do not travel with our executables.

**The version floor is 1.1, and it is a preprocessor `#error`**, written in `internal/runtime/src/tyrt_tls.c`:

```c
#if OPENSSL_VERSION_NUMBER < 0x10100000L
#error "the TLS layer needs OpenSSL 1.1 or newer (...)"
#endif
```

`SSL_set1_host`, `BIO_meth_new`, `TLS_client_method` and `SSL_CTX_set_min_proto_version`
are all absent from 1.0.x. The floor is stated at compile time, so a build against 1.0.2 headers sees that sentence
rather than a page of "undeclared identifier" inside a runtime file the person did not write. `scripts/check-notices.sh` reads the hexadecimal
floor out of that `#if` and compares it against this very string.

### The mingw-w64 runtime

The `windows/amd64` link flags are `-lws2_32 -static` (Winsock, and making the artifact self-contained — without `-static`
every program would need a `libwinpthread-1.dll` next to it). The mingw-w64 runtime (crt and winpthreads) is therefore
**statically linked** in: `x86_64-w64-mingw32-objdump -p` on a hello world shows only three imports,
`KERNEL32.dll`, `msvcrt.dll` and `WS2_32.dll`, while symbols such as `pthread_create` are defined
inside the artifact, with no `libwinpthread` or `libgcc_s` import at all. Distributing that executable distributes the
mingw-w64 runtime's terms with it (ZPL-2.1, plus the parts its files mark as public domain, BSD or LGPL).

### tzdata

The time zone data lives on the **host**: not in this repository, and not in any artifact. `lib/46_timezone.teyru` reads the host's TZif
files, from `$TZDIR` (when it is set and non-empty) and otherwise from `/usr/share/zoneinfo`, with the default zone coming from `TZ` or
`/etc/localtime`. UTC and numeric ids such as `GMT`/`+08:00` are built in, so a program that only needs UTC needs no
tzdata; every other zone, on a host without it (Windows, or a container that did not install it), gets a
`ZoneRulesException` — a **named refusal**, not a wrong answer. The data's copyright belongs to whoever distributes it (the
distribution's `tzdata` package); this project claims no rights over it and does not redistribute it.

---

## 4. Runtime and standard library

| Component | Source | License |
|---|---|---|
| Teyru runtime (the whole `internal/runtime/src/` directory) | Original to this project | See `LICENSE` |
| Teyru standard library (`lib/*.teyru`) | Original to this project, written in Teyru | See `LICENSE` |

The runtime is no longer listed file by file: it is **declared by directory**, and the list is generated from the directory by
`scripts/check-notices.sh` and checked by the same script (`make notices` in the compiler repository). There are eleven files:

- `tyrt.c`
- `tyrt.h`
- `tyrt2.c`
- `tyrt_net.c`
- `tyrt_net.h`
- `tyrt_plat.h`
- `tyrt_plat_posix.c`
- `tyrt_plat_win.c`
- `tyrt_reflect.c`
- `tyrt_thread.c`
- `tyrt_tls.c`

The garbage collector, strings, arrays, exceptions and box classes are all implemented by this project itself: no Boehm GC, no
libgc, no allocator such as mimalloc. The runtime's only third-party code is OpenSSL, linked when TLS is reachable (see §3);
it is dynamically linked, so the runtime files contain none of its code.

---

## 5. Unicode data and the generated tables

`Character`'s character classification and case mappings need Unicode's data, and that data is
**not in the repository yet** (until it is, classification and case mapping are ASCII-only, see §12 item 12 of the
language reference). What will land is Unicode 15.0's data files
(`UnicodeData.txt`, `SpecialCasing.txt`, `CaseFolding.txt`, `PropList.txt` and the other files of the same distribution)
together with the two-level lookup tables generated from them. They are distributed under the
**Unicode License v3** (UNICODE LICENSE V3, Copyright © 1991-2024 Unicode, Inc., terms at
[https://www.unicode.org/license.txt](https://www.unicode.org/license.txt)), with the copyright notice retained
alongside the files.

The version is pinned to 15.0 to match the reference implementation: JDK 21 uses Unicode 15.0, so
`Character.isLetter` and the case mappings answer as it does. `scripts/check-notices.sh` in the compiler
repository requires the notices to name any data file that has landed.

---

## 6. Editor tooling ([`teyru-lang/editors`](https://github.com/teyru-lang/editors))

The editor support is not in the compiler repository (the tests, the docs and the editor support each live in their own repository), so the table below describes that repository's
contents:

| Component | Source | License |
|---|---|---|
| `tree-sitter-teyru/src/tree_sitter/alloc.h`, `array.h`, `parser.h` | Copied from [tree-sitter](https://github.com/tree-sitter/tree-sitter) for use by the generated parser | MIT (Copyright (c) 2018 Max Brunsfeld) |
| `tree-sitter-teyru/src/parser.c` | The parse tables and the lexer produced by the tree-sitter CLI (v0.25.10) from `grammar.js` | MIT (same as above) |
| `tree-sitter-teyru/grammar.js`, `queries/`, `test/` | Original to this project | GPL-2.0-only, see `tree-sitter-teyru/LICENSE` in that repository |
| `vscode/` (TextMate grammar, language configuration, snippets) | Original to this project | See this repository's `LICENSE` |

tree-sitter's MIT terms require that the copyright notice and the permission notice be retained with all copies; this section of this document, together with the upstream `LICENSE`, satisfies that. These files are used by the editor only for syntax highlighting and parsing; they do not enter the compiler, nor any produced executable.

---

## 7. Tests and tools

| Component | Purpose | License |
|---|---|---|
| Go testing framework (`testing`) | `go test ./...` | BSD-3-Clause (part of the Go standard library) |
| OpenJDK / HotSpot | **Only used** for the comparison measurements in `scripts/bench.sh` | GPL-2.0 with Classpath Exception |

`scripts/bench.sh` needs `java` / `javac` to run the JVM half; if they are not installed
on the system, the script simply skips that part, which does not affect Teyru's build or tests. The JVM is not Teyru's runtime environment,
nor a dependency of any artifact.

---

## 8. License files

| File | Description |
|---|---|
| `LICENSE` | The main license of this project |
| `LICENSE-CLASSPATH-EXCEPTION-2.0` | Full text of the Classpath Exception (the terms come from OpenJDK and are retained together with the main license) |
| `tree-sitter-teyru/LICENSE` (in `teyru-lang/editors`) | The license of the grammar itself (GPL-2.0-only, the same as this project's main license) |

If any of the above is changed at distribution time (for example, statically linking clang or OpenSSL into an artifact, or embedding
the Go standard library in a release package), this document must be regenerated and the corresponding full license texts attached; the runtime's file list is regenerated by
`make notices`.

---

## 9. Awaiting the owner's decision

This section records the question only; it **does not decide it**:

- This project's main license is GPL-2.0 with Classpath Exception (`LICENSE` and
  `LICENSE-CLASSPATH-EXCEPTION-2.0`). OpenSSL 3.0 and later is Apache-2.0, and the `linux/amd64` and
  `linux/arm64` artifacts **dynamically link** it; 1.1.1 is dual-licensed OpenSSL/SSLeay instead. The Classpath Exception
  permits linking independent modules and distributing the artifact under terms of your choosing, but whether that is compatible
  with Apache-2.0 — and what distributing a `windows/amd64` artifact that **statically links** the mingw-w64 runtime (ZPL-2.1)
  obliges — is a licensing judgement, and the owner's to make.
- Until that has an answer, this document states facts only: which target links what, how, and under which terms.
