---
title: "测试规范"
description: "怎么写 Teyru 测试：命名、结构、断言、确定性，以及 runner 补上的超时、输出隔离与选取。"
---

这一页是**写测试的规范**，不是 API 清单；runner 的旗标与断言的完整清单在
〈工具链〉。两页合起来回答一个问题：一个测试要怎么写，失败消息才足以让人不必重跑。

`teyru test` 没有堆栈追踪，失败坐标就只有 `Class.method`；runner 也刻意让每个测试
各自独立——新的实例、被捕捉的 stdout。规范的大部分规则都是这两件事逼出来的。

## 命名与位置

1. 文件名与类名用 `<Subject>Test`，放在被测程序**同一个目录**（同一个包）。runner 以
   目录为单位编译，同一个目录的程序与测试一起可见。

2. 方法名是**行为句子**：`addsTwoNumbers`、`throwsWhenDivisorIsZero`、
   `roundsHalfUpAtExactHalf`。不要 `testAdd`——没有堆栈追踪时，方法名就是唯一的位置。

3. **一个 `@Test` 只验一个行为**。失败输出只有 `Class.method`，方法名就是坐标；一个
   方法验三件事，红灯只会说「这个方法坏了」，不会说哪一件。

4. `@Test` 必须是 `public void`、无参数、非 `static`、非 `private`，而且有主体；类必须是
   top-level、非抽象、有无参构造器。违反是 `TY-TYP-0117`／`TY-TYP-0118`。

## 结构

5. Arrange／Act／Assert 三段，中间空一行；**只有一个 Act**。两个 Act 就是两个测试。

6. 每个测试一个新实例。可变状态放字段、在 `@BeforeEach` 初始化；测试之间不共享 static
   状态。

7. `@BeforeAll`／`@AfterAll` 只放**不会失败的**准备。它失败时整个类记一条失败，其余
   测试不会执行。

8. `@AfterEach` 不得依赖前面的步骤成功；失败时 runner 也保证会调用它。

## 断言

9. **expected 在前、actual 在后**，一律。读失败消息的人先看到的是期望值。

10. 值比较用 `assertEquals`；不要 `assertTrue(a == b)`——消息会失去两边的值。

11. 浮点用 delta 形式：`Assert.assertEquals(expected, actual, 1e-9)`。没有 delta 的
    `assertEquals(double, double)` 是精确比较（`Double.compare`），只用在要钉住位的情形
    （NaN、`-0.0`）。

12. 数组用 `assertArrayEquals`；不要 `assertEquals(int[], int[])`——它会走 `Object` 重载，
    比的是引用，消息印的是两个地址。

13. 异常：`Throwable t = Assert.assertThrows(X.class, action)`，再对 `t.getMessage()` 做
    精确断言。只验类型不算验证；消息是使用者会看到的东西。

14. 不要在断言两边放不同类型。`assertEquals("1", 1)` 走 `Object` 重载，消息会同时标出
    两个类型，但那个测试从一开始就写错了。

15. 需要上下文时用 message 重载：`Assert.assertEquals(expected, actual, "row 7")`。
    table-driven 的测试**一定**要带 message，否则红灯不知道是哪一列。

16. 多个独立性质要一次验完时用 `Assert.assertAll(...)`；它会把每一个失败都列出来，而
    不是停在第一个。

## 确定性

17. 禁止 `Thread.sleep` 当同步；用 latch、condition 或 `CountDownLatch`。真的需要等待就
    等条件，不要等时间。

18. 禁止依赖 wall clock、时区、locale、主机文件或环境变量；需要就注入。

19. 禁止未定种子的随机；种子写死，失败消息印出种子。

20. 网络测试自己起对端、自己关掉；不连外。

21. 测试不得调用 `System.exit`。

## 输出与 CI

22. 测试 body 的 stdout 会被 runner **捕捉**，只在失败（或 `-v`）时印出，所以「印出来
    调试」不会弄坏报告，但也不该靠它。要断言输出，把行为改成回传值。

23. `teyru test` 找不到任何测试时是 **exit 2**；`-no-tests-ok` 才是接受空集合。CI 不要
    用后者盖掉打错的路径。

24. CI 用 `timeout 600 teyru test ./...` 包住，并检查输出的总结行。exit 2 是编译错误、
    1 是测试失败、0 才是全过。

25. 有测试卡死时用 `-timeout`：默认每个测试 60 秒，`-timeout 0` 关掉；`-deadline` 是整
    个目录的上限。超时的 FAIL 行会指名卡住的那个测试。

## 分层

26. `tests/test-framework/` 只放 runner 契约（生命周期、断言、输出、exit code）；
    语言／标准库语义放 `tests/programs/` 的 golden；Java 语义改动放 `tests/java-compat/`
    的 JDK 差分。三者不互相取代。

## 选取与跳过

```sh
teyru test -run CalculatorTest.adds   # 正则表达式比对 Class.method（也接受只有方法名）
teyru test -tag slow                  # 只跑 @Tag("slow") 的测试
teyru test -run rounds -v             # 连通过测试的捕捉输出一起印
```

`@Disabled("reason")` 让一个测试不跑但留下 `SKIP Class.method: reason`；类上的
`@Disabled` 是整个类。跳过的测试不算通过，也不算失败，总结会多一个 `N skipped`。

## 不要做的事

- 不引入 mock 框架；手写 fake（接口 + 假实现）。
- 不测 private 成员。同包的 package-private 可以测，但优先测 public 行为。
- 不从 production 程序引用测试类。

## 与其他语言的对照

- 骨架照 **JUnit 5**：`@Test`／`@BeforeEach`、`Assert.assertEquals(expected, actual)`、
  每个测试新实例。拿掉的是反射发现与 `@Nested`（这个语言明确拒绝）。
- 纪律照 **Go `testing`**：table-driven、`-run`、`-timeout`、每个测试捕捉 stdout、失败
  才印。拿掉的是「没有断言库」的极简主义——`Assert` 留着。
- 失败语义照 **Rust 的 `should_panic(expected = ...)`**：`assertThrows` 搭配精确的
  `getMessage()`，只验类型不算验证。
