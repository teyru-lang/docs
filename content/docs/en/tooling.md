---
title: "Tooling"
description: "Formatter, language server, debug information and test runner — four tools that make Teyru usable day to day."
---

The compiler is a single executable, and the tools live inside it: `fmt`, `lsp`, `test` and
`-g` are subcommands of the same `teyru`, not plugins. This page says what each one does,
how to use it, and what it does **not** do.

## Formatting: `teyru fmt`

```sh
teyru fmt -w src/            # rewrite in place
teyru fmt src/Main.teyru     # print to stdout
```

The rules are fixed: two-space indent, one statement per line, one space around operators and
after commas, the brace stays on the declaration's line. Formatting is **idempotent** —
`fmt(fmt(x)) == fmt(x)` — and the whole `lib/` plus the test programs check that.

**Comments are preserved**: the formatter does not regenerate source from the syntax tree
(that would drop comments, because the parser keeps no trivia); it walks the token stream and
re-inserts comments at their original offsets. The 4,189 comments in `lib/*.teyru` are
byte-identical before and after, and that is part of the test.

Formatting does not change behaviour: a program compiled before and after formatting produces
the same output.

## Language server: `teyru lsp`

```sh
teyru lsp        # JSON-RPC 2.0 over stdin/stdout, Content-Length framing
```

Supported capabilities:

| Capability | What it does |
|---|---|
| `textDocument/publishDiagnostics` | Runs the full lexical, syntax and semantic analysis on every open and change; diagnostics carry their `TY-*` code and range |
| `textDocument/definition` | Jumps to a declaration in the same file: types, methods, fields, locals, parameters, catch variables |
| `textDocumentSync` | Full sync — the editor sends the whole buffer; there is no incremental mode |

An identifier that cannot be resolved returns `null` rather than a guess. The server does
same-file definitions only; crossing files needs the module graph, which it does not have.

Any editor with LSP support can use it: a generic LSP client extension in VS Code, or
`vim.lsp.start({ cmd = { "teyru", "lsp" } })` in Neovim.

## Debug information: `-g`

```sh
teyru build -g -O0 -o hello hello.teyru
```

`-g` makes the generated C carry `#line` directives back to the `.teyru` file and passes `-g`
to the C compiler, so the file and line numbers in DWARF are the Teyru source:

```sh
readelf --debug-dump=decodedline hello | head
# hello.teyru    2    0x4007b0
addr2line -e hello 0x4007b0
# /path/hello.teyru:2
```

Variables, fields and method declarations also carry `DW_AT_decl_file` / `DW_AT_decl_line`, so
`gdb`'s `break hello.teyru:7`, `info line` and `list` stop at the source line.

**Without `-g` the output is byte-identical**: the directives are emitted only when it is on,
so the default build is what it always was.

The LLVM back end does not produce debug information yet; `--backend llvm -g` is refused with
`TY-INT-0103` rather than silently ignored.

## Testing: `teyru test`

```sh
teyru test            # the current directory, recursively
teyru test ./...      # every package of the module
```

A test is an ordinary method with an annotation:

```teyru
import teyru.test.*

class CalculatorTest {
  private Calculator calc

  @BeforeEach
  public void setUp() {
    calc = new Calculator()
  }

  @Test
  public void adds() {
    Assert.assertEquals(5, calc.add(2, 3))
  }

  @Test
  public void subtracts() {
    Assert.assertEquals(3, calc.subtract(5, 2))
  }
}
```

The lifecycle follows JUnit's shape: a fresh instance per test, `@BeforeEach` → test →
`@AfterEach` (which also runs after a failure); `@BeforeAll` / `@AfterAll` may be static or
instance methods.

The assertions live in `teyru.test.Assert`: `assertEquals` (`Object`, `int`, `long`, `char`,
`boolean`, `double`), `assertTrue`, `assertFalse`, `assertNull`, `assertNotNull`,
`assertThrows(Class, Runnable)`, `fail(String)`. A failure names both the expected and the
actual value.

Output is one line per test, then a summary:

```
PASS CalculatorTest.adds
FAIL CalculatorTest.subtracts: expected 3, but was 4
java.lang.AssertionError: expected 3, but was 4
1 passed, 1 failed
```

Exit codes: `0` all passed, `1` something failed, `2` compile or diagnostic errors. The
package's own `main` is not called, so a test project can also be a program.

A malformed test method (static `@Test`, parameters, private, no body) is `TY-TYP-0117`; a
class that cannot be a test (nested, no no-arg constructor, abstract) is `TY-TYP-0118`.

## Continuous integration

`.github/workflows/ci.yml` runs `go build ./...`, `go vet ./...` and the whole
`go test ./...` on every push to `main` and every pull request, and a second job runs the
data-driven suite through `tests/run.sh`. `nightly.yml` runs the same set with `CC=gcc` once a
day, to watch the second C compiler leg.
