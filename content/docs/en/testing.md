---
title: "Testing"
description: "How to write a Teyru test: naming, structure, assertions, determinism, and the timeouts, output isolation and selection the runner adds."
---

This page is the **style of a test**, not the API list; the runner's flags and the full
assertion surface are in the tooling page. Together they answer one question: how a test is
written so that its failure message is enough to act on without re-running it.

`teyru test` has no stack traces, so the only coordinate a failure names is `Class.method`;
the runner also keeps each test independent — a fresh instance, captured stdout, and a name
on every report line. Most of the rules below follow from those two facts.

## Naming and location

1. Name the file and the class `<Subject>Test`, and put it in the **same directory** as the
   code under test (the same package). The runner compiles a directory as a whole, so the
   program and its test see each other.

2. A method name is a **sentence about behaviour**: `addsTwoNumbers`,
   `throwsWhenDivisorIsZero`, `roundsHalfUpAtExactHalf`. Not `testAdd` — with no stack
   trace, the method name is the only location there is.

3. **One `@Test`, one behaviour.** A failure names `Class.method`, so the method is the
   coordinate; a method that checks three things reports "this method is red" and not which.

4. `@Test` must be `public void`, take no parameters, be neither `static` nor `private`, and
   have a body; the class must be top-level, non-abstract, and have a no-argument
   constructor. Violations are `TY-TYP-0117` / `TY-TYP-0118`.

## Structure

5. Arrange / Act / Assert, separated by blank lines; **one Act**. Two Acts are two tests.

6. A fresh instance per test. Mutable state goes in fields initialised by `@BeforeEach`;
   tests do not share static state.

7. `@BeforeAll` / `@AfterAll` hold only preparation that cannot fail. If one fails, the class
   records one failure and the tests do not run.

8. `@AfterEach` must not depend on earlier steps having succeeded; the runner calls it after
   a failure too.

## Assertions

9. **expected first, actual second**, always. A reader of the failure message looks for the
   expected value first.

10. Compare values with `assertEquals`; never `assertTrue(a == b)`, whose message loses both
    values.

11. Floating point uses the delta form: `Assert.assertEquals(expected, actual, 1e-9)`. The
    delta-less `assertEquals(double, double)` is an exact comparison (`Double.compare`) and
    is for pinning bits: NaN, `-0.0`.

12. Arrays use `assertArrayEquals`; never `assertEquals(int[], int[])`, which binds to the
    `Object` overload, compares references, and prints two addresses.

13. Exceptions: `Throwable t = Assert.assertThrows(X.class, action)`, then assert
    `t.getMessage()` exactly. Checking only the class is not checking; the message is what a
    user sees.

14. Do not put different types on the two sides of an assertion. `assertEquals("1", 1)` binds
    to the `Object` overload; the message now names both types, but the test was wrong to
    begin with.

15. Use the message overload when context matters:
    `Assert.assertEquals(expected, actual, "row 7")`. A table-driven test **must** pass one,
    or the red light does not say which row.

16. When several independent properties belong to one test, `Assert.assertAll(...)` runs all
    of them and reports every failure instead of stopping at the first.

## Determinism

17. `Thread.sleep` is not synchronisation; use a latch, a condition or `CountDownLatch`.
    Wait for a condition, never for time.

18. Do not depend on the wall clock, the time zone, the locale, host files or environment
    variables; inject them.

19. No unseeded randomness; fix the seed and print it in the failure message.

20. A network test starts its own peer and shuts it down; nothing reaches out.

21. A test does not call `System.exit`.

## Output and CI

22. A test's stdout is **captured** by the runner and printed only on failure (or under
    `-v`), so printing to debug does not corrupt the report — but do not rely on it. To make
    output assertable, return it.

23. `teyru test` exits **2** when it finds no tests at all; `-no-tests-ok` is the opt-out. CI
    must not use the latter to hide a mistyped path.

24. Wrap the CI step in `timeout 600 teyru test ./...` and check the summary line. Exit 2 is
    a compile error, 1 a test failure, 0 the only all-pass.

25. A test that hangs is caught by `-timeout`: 60 seconds per test by default, `-timeout 0`
    turns it off, and `-deadline` bounds one directory. The FAIL line names the hung test.

## Layers

26. `tests/test-framework/` holds only the runner contract (lifecycle, assertions, output,
    exit codes); language and standard-library semantics are the golden files under
    `tests/programs/`; Java semantics changes are the JDK differential under
    `tests/java-compat/`. None of the three replaces another.

## Selecting and skipping

```sh
teyru test -run CalculatorTest.adds   # regexp over Class.method (or the method alone)
teyru test -tag slow                  # only tests carrying @Tag("slow")
teyru test -run rounds -v             # print passing tests' captured output too
```

`@Disabled("reason")` keeps a test out of the run but leaves a `SKIP Class.method: reason`
line; `@Disabled` on the class covers all its tests. A skipped test is neither a pass nor a
failure, and the summary gains an `N skipped`.

## What not to do

- No mock framework; write the fake by hand (an interface and a stand-in implementation).
- Do not test private members. Same-package package-private is reachable, but public
  behaviour comes first.
- Do not reference test classes from production code.

## Compared to other languages

- The skeleton is **JUnit 5**: `@Test` / `@BeforeEach`, `Assert.assertEquals(expected,
  actual)`, a fresh instance per test. What is left out is reflective discovery and
  `@Nested`, which this language refuses by name.
- The discipline is **Go `testing`**: table-driven, `-run`, `-timeout`, per-test stdout
  capture printed on failure. What is left out is the no-assertion-library minimalism —
  `Assert` stays.
- The failure semantics are **Rust's `should_panic(expected = ...)`**: `assertThrows` plus an
  exact `getMessage()`, because checking the class alone is not checking.
