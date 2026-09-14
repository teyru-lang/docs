---
title: "Third-party notices"
description: "The third-party components that the Teyru project actually uses and distributes, and how each is licensed and distributed."
---

This document lists the third-party components that the Teyru project actually uses and distributes. The license of the project itself is in `LICENSE`.

> The compiler uses only the Go standard library, and `go.mod` has no external module dependencies;
> the executables it produces link only against the system C library and the runtime shipped with this project. This list is therefore short, and complete.

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
| libc / libm / libpthread | System libraries used at runtime | Varies by system (mostly LGPL-2.1+ or MIT) | Dynamically linked, not distributed |

The executables that are produced **link** against these libraries, but do not contain their source code. The Teyru runtime
(`internal/runtime/src`) is itself original code of this project, and has no licensing relationship to the components above.

---

## 3. Runtime and standard library

| Component | Source | License |
|---|---|---|
| Teyru runtime (`internal/runtime/src/`: `tyrt.h`, `tyrt.c`, `tyrt2.c`, `tyrt_net.h`, `tyrt_net.c`) | Original to this project | See `LICENSE` |
| Teyru standard library (`lib/*.teyru`) | Original to this project, written in Teyru | See `LICENSE` |

No third-party C library is used (no Boehm GC, no libgc, no allocator such as
mimalloc): the garbage collector, strings, arrays, exceptions and box classes are all implemented by this project itself.

---

## 4. Editor tooling ([`teyru-lang/editors`](https://github.com/teyru-lang/editors))

| Component | Source | License |
|---|---|---|
| `tree-sitter-teyru/src/tree_sitter/alloc.h`, `array.h`, `parser.h` | Copied from [tree-sitter](https://github.com/tree-sitter/tree-sitter) for use by the generated parser | MIT (Copyright (c) 2018 Max Brunsfeld) |
| `tree-sitter-teyru/src/parser.c` | The parse tables and the lexer produced by the tree-sitter CLI (v0.25.10) from `grammar.js` | MIT (same as above) |
| `tree-sitter-teyru/grammar.js`, `queries/`, `test/` | Original to this project | GPL-2.0-only, see `tree-sitter-teyru/LICENSE` |
| `vscode/` (TextMate grammar, language configuration, snippets) | Original to this project | See `LICENSE` |

tree-sitter's MIT terms require that the copyright notice and the permission notice be retained with all copies; this section of this document, together with the upstream `LICENSE`, satisfies that. These files are used by the editor only for syntax highlighting and parsing; they do not enter the compiler, nor any produced executable.

---

## 5. Tests and tools

| Component | Purpose | License |
|---|---|---|
| Go testing framework (`testing`) | `go test ./...` | BSD-3-Clause (part of the Go standard library) |
| OpenJDK / HotSpot | **Only used** for the comparison measurements in `scripts/bench.sh` | GPL-2.0 with Classpath Exception |

`scripts/bench.sh` needs `java` / `javac` to run the JVM half; if they are not installed
on the system, the script simply skips that part, which does not affect Teyru's build or tests. The JVM is not Teyru's runtime environment,
nor a dependency of any artifact.

---

## 6. License files

| File | Description |
|---|---|
| `LICENSE` | The main license of this project |
| `LICENSE-CLASSPATH-EXCEPTION-2.0` | Full text of the Classpath Exception (the terms come from OpenJDK and are retained together with the main license) |
| `tree-sitter-teyru/LICENSE` (in `teyru-lang/editors`) | The license of the grammar itself (GPL-2.0-only, the same as this project's main license) |

If any of the above is changed at distribution time (for example, statically linking clang into an artifact, or embedding
the Go standard library in a release package), this document must be regenerated and the corresponding full license texts attached.
