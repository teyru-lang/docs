---
title: "版本与变更"
description: "Teyru 的版本：0.4.0 是正确性版本——改了什么、量到了什么、还没实现什么，以及这一版刻意不宣称什么。"
---

这一页描述 **0.4.0**：这个项目第一个以「正确性」为主题的版本。它处理的是外部审查与实测
找出的一批问题（计划的 W1–W12），不是速度——速度是下一个阶段的事。

这一页在 0.4.0 发布前写成，所以每一项都标了状态：**已合入 main** 的项目就是读者现在装得到的
行为；其余附上 PR 或工作项。**还没收尾的只有 §3 与 §5 明列的那几项。**

**这一版的关卡第一次真的跑起来。** `.github/workflows/release.yml` 是这个仓库**唯一**的工作流程，
只在有 release 发布时运行，而 0.4.0 是**第一次**有 release 让它跑：它在 tag 上构建、跑整套测试、
把可执行文件附到 release 上，并依次调用六个检查——`make build`、`make ci`、`make java-compat`、
`make jdk-diff`、`make backend-matrix`、`make notices`。这一页引用的数字就是那些指令在同一个 tag
上的输出，每一行都注明它是怎么量的。

**同一串检查在 `3cd9c70`（v0.4.0 的 tag）上先由人跑过一次，四条腿全绿**——说「人跑过」而不是
「CI 通过了」，因为工作流程是 tag 之后才跑的，而且它的首跑还在进行中。四行照抄 `make ci` 自己的
输出，不改数字：`notices` 与树一致、默认编译器那一条 `ok 801.427s`、**gcc 那一条 `ok 931.287s`**、
**JDK differential `PASS`（`ok 284.091s`）**，整体 `EXIT=0`。

---

## 1. 改了什么

### 测试基础设施与 JDK 差分（W1、W2，已合入 main）

- **JDK 差分测试**：`teyru emit-java` 把 Teyru 的 AST 打印成等价的 Java（补分号、`for` 头
  换回分号、`val` 换成 `final var`、`java.*` 与标准库对照），翻译不了的 Teyru 专属特性
  以 `TY-INT-0102` 具名拒绝并说明原因。设了 `TEYRU_JDK=<JDK 21>` 时 `go test` 会编译并执行
  那些程序、比对 stdout 与结束状态；期望值是**真的 JDK 跑出来的**，不是手写的。
- **已知失败清单**：`tests/known-failures.txt` 一行一个 `<案例> <工作项> <原因>`；列出的案例
  失败不算失败，**列出却通过**才会让整次跑失败，所以条目不会活得比它描述的 bug 久。
  与 JDK 的差异另外由 `tests/jdk-diff-allow.txt` 决定接受，平台差异由 `.skip` 文件决定。
- **两个诊断开关**：`TEYRU_GC_STRESS=N`（每 N 次分配强制收集一次）、`TEYRU_GCTRACE=1`
  （每次收集打印触发原因、停顿时间与前后堆大小）。
- **`make ci`／`make jdk-diff`／`make notices`**：一次 CI job 会跑的东西，在这里由人跑；这个
  仓库**只有一个** workflow（`.github/workflows/release.yml`），在发布 release 时调用它们。
- **一条流程规则，因为它真的发生过**：测试比它要验的代码先推上 main，会让整道关卡在一个
  小时后变红（`t196_string_bytes` 与 `t180_http_gzip` 就是这样）。规则现在写在测试仓库的
  `README.md`：先推的测试必须在同一个提交里带一条 `known-failures.txt` 条目，代码到了再把
  条目删掉。

### HTTP 服务器加固（W3，已合入 main）

一台服务器现在是「一条线程 accept、一串 cached 工作线程回应」，并发有三个上限（工作线程
64、等待队列 100、WebSocket 会话 256），超过的连接得到 503 而不是把服务器拖住。请求行、
头、头个数与请求体都有上限（414／431／413），超时是**总时长**而不是单次读取；解析器对
RFC 9112 的不一致（`Content-Length` 与 `Transfer-Encoding` 同时出现、多个不一致的长度、
obs-fold、冒号前空白、非十六进制的 chunk……）一律拒绝并关闭连接；WebSocket 的协议上限是
1002／1007／1009／1001。全部十三个配置键——十二个 `server.teyru.*`，加上 Spring Boot
自己的 `server.max-http-request-header-size`——与默认值见
[docs/framework.md](/zh-CN/docs/framework) 的〈并发模型〉与〈客户端的限制〉。

证据是那两个外部重现脚本在修好之后得到的相反结果：慢速客户端（一条连接每 4 秒送 1 个字节）
连着时，另一个客户端连续 5 次请求全部 `200`（修正前 5 次全部超时）；一个
`Content-Length: 1000000000` 的请求让 RSS 增长 **36 kB**（修正前 983 MB）。测试是
`t220`（字节请求体）、`t221`（上限与严格性）、`t222`（解析器 fuzz）、`t223`（慢速客户端与
100 个并发客户端）、`t224`（WebSocket 关闭码）、`t225`（`serve()`／`close()`）。

**这一版不宣称两件事。** 服务器的每一个等待都以 **250 毫秒**为上限，所以「没有任何服务线程
会阻塞超过 250 毫秒」是被证明的（`t223`）；「一条阻塞在 `recv()` 的线程不会拖住停止世界
收集」是运行时的性质（`internal/runtime/src`），文件把它写成上限而不是修好的性质。而计划里
「64 条空闲 keep-alive 连接不影响停顿时间」那一条验收没有测量支撑（它需要 `TEYRU_GCTRACE`
的数据），所以这一页不引用它。

### 递归过深是 `StackOverflowError`，不是进程死亡（W4，已合入 main）

每个生成的函数开头拿自己的框架地址跟线程的 `ty_stack_limit`（栈底加 256 KB）比一次，低于
就抛出该线程预先分配的 `StackOverflowError`——可拦截，线程与进程继续跑；原生代码真的把栈
写坏时由 `sigaltstack` 上的 SIGSEGV 处理器打印消息后 `abort()`（不做 longjmp）。在服务器里，
处理函数的深递归是那一个请求得到 500，服务器继续服务下一个。代价是量到的：每个函数多一次
检查，`bench_fib` 长跑因此回退约 32%（owner 已裁决接受）。

### 字符串与 Unicode（W5，**已合入 main**）

**字符串的索引语义现在是 Java 的。** `length`／`charAt`／`substring`／`indexOf`／`compareTo`／
`hashCode`、`codePoint` 家族、`toCharArray`／`getChars`／`chars`／`codePoints`，以及 `char[]` 与
`int[]` 构造函数，全部以 **UTF-16 code unit** 计算；存储仍是 WTF-8（ASCII 走快速路径、面包屑表首次
用到才建，非法字节以 U+FFFD 取代、没有伙伴的代理以 `?` 编出）。读者最常踩到的三件事：`substring`
**可以切开一对代理**（那是 Java 的语义，不是缺陷）、`hashCode` 是 JDK 的，所以
`HashMap<String, …>` 走的是 JDK 的顺序。计划里「改用 JDK 式 compact strings」那个备选方案**由测量
结案**：与字节索引的版本相比 `bench_string` 0.994×、`bench_string_cjk` 0.949×，都在 10% 预算内，
所以不换。

**`Character` 与大小写映射改用 Unicode 15.0**，数据是入库的生成查表（生成器
`internal/tools/genunicode`，`make unicode-tables` 重跑；重跑不会改动任何文件）：
`isLetter`／`isDigit`／`isAlphabetic`／`isWhitespace`／`isSpaceChar`／`getType`／`digit`／
`getNumericValue`／代理判断／`toCodePoint`／`charCount`；完整大小写映射（`ß` → `SS`、希腊语词尾
sigma）；`strip`／`isBlank` 走 `Character.isWhitespace`，所以 **U+3000 会被去掉**，而 `trim` 仍然
只认 ≤ U+0020；`parseInt`／`parseLong` 接受全角与其他 Nd 数字（`Integer.parseInt("１２３")` 是
`123`）。`StringBuilder`／`StringBuffer` 与 Java 一致，包括 `delete(start,end)` 的夹取与 `replace`
的 `NullPointerException`。

**两件要说出来而不是埋起来的事。** 词尾 sigma 的「词」判定是这个运行时自己的：对 JDK 量过 8,000 个
生成的字符串与每个测到的形状都一致，AGENTS.md §10 记下那**一个**已知不同的形状。locale 相关的映射
（`tr`、`az`、`lt`）**没有实现**。

**这一项留下两条与 JDK 的差异**（都是刻意的，写在
[docs/language.md](/zh-CN/docs/language) §12）：regex 引擎逐 **code unit** 比对，所以
`"😀a".matches(".a")` 在这里是 `false`（JDK 的 `.` 吃一个 code point，是 `true`）；
`String.offsetByCodePoints` 走出两端时抛 `StringIndexOutOfBoundsException`（JDK 抛
`IndexOutOfBoundsException`；前者是后者的子类，所以 `catch (IndexOutOfBoundsException)` 仍然拦得到）。

**我是怎么验的。** 在 `adf58e7`（`tests` 指标 `10ef6b2`）上，同一支程序写两次——`.teyru` 与 Java
——用 OpenJDK 21 跑再逐行比对：写的那一半 **32 项逐字节相同**；读的那一半 41 项里 **39 项相同**，
其余两项就是上面那两条已声明的差异（`ß`→`SS`、词尾 sigma、`strip` 的 U+3000、全角 `parseInt` 的接受
与拒绝都在 39 项里面）。语料 `sh tests/run.sh java-compat` 是 **45 过、0 失败**（我自己跑的，两次）。

### 装箱、容器顺序与异常名称（W6，**已合入 main**）

- **装箱缓存**（已合入）：`Integer`／`Short`／`Byte`／`Long` 缓存 −128..127、`Character`
  缓存 0..127、`Boolean` 只有两个实例，所以 `Integer.valueOf(127) == Integer.valueOf(127)`
  与 Java 一样是 `true`；跨过一次调用也不会坏（`t242_box_identity_across_call`，期望值由
  javac 生成）。
- **越界消息**（已合入）：`Index 5 out of bounds for length 3`（大写 `I`，JDK 的句子）。
- **容器顺序**（已合入）：`HashMap`／`HashSet` 的迭代顺序照 JDK 21 的版面（决策 D7）。
  实测程序是测试仓库的 `t250_map_order`，期望值由 JDK 跑 `t250_map_order.java.ref` 生成：
  五个字符串键（依次放入 `banana`、`apple`、`cherry`、`date`、`elderberry`）迭代出
  `banana, date, apple, cherry, elderberry`，与 JDK 逐字相同；同一桶保持插入顺序、第 13 个键
  扩容到 32 桶、复制构造与 `putAll` 的预先定量、负载因子 0.6 的阈值加倍（9 → 18）各有一行。
- **异常名称与消息**（已合入）：`Class.getName()` 报告 JDK 的全限定名（决策 D8），
  未捕获的异常因此打印 `Exception in thread "main" java.lang.IllegalStateException: boom`，
  与 JDK 相同（`t251_exception_names`、`t79_uncaught`）；`System.arraycopy` 的类型不符消息
  也是 JDK 的 `arraycopy: type mismatch: can not copy long[] into byte[]`（`t65_arraycopy`）。
  还没对齐的三条消息（cast 的 module／loader 括号、有帮助的 NullPointerException 消息、
  `ArrayStoreException` 的元素类）写在测试仓库的 `known-failures.txt`。

### Java 源代码相容（W7，**已合入 main**）

**合入了**：main `07ce0a3`（PR [#124](https://github.com/teyru-lang/Teyru/pull/124)，8 个 commit）。
main 上的行为我自己重跑过：`.teyru` 的语句写了分号也编得过、`.java` 文件可以直接作为输入、
`xs.sort(naturalOrder())` 与 `Comparator.comparing(f).thenComparing(g)` 不再需要类型见证、
`String.join` 解析得到。这一节写的时候 W5 还没合入（那时缺的是 `new String(char[])`、
`String.codePointAt`），现在两个都在了（见上面 W5 那一节）；仍然缺的是嵌套的泛型推断
（主体本身是需要目标类型的泛型调用时还是要先把类型写出来）。

**语料现在从 main 就重现得出来。** `teyru-lang/tests` 的 main 是 `af41a7d`（45 支未经修改的 Java
程序），而 Teyru main 的指标在 PR [#128](https://github.com/teyru-lang/Teyru/pull/128) 合入后
（`0e8e592`）指到它。我在 main 的那个内容上自己跑过 `sh tests/run.sh java-compat`：
**45 过、0 失败、0 已知失败、0 跳过**——PR 描述的 45 支全过是重现得出来的，不是只有分支上成立。
**整套测试在 main 上的那一行是 `324 过、1 失败、10 已知失败、0 跳过`**（同一个内容：Teyru
`0e8e592` → `tests` `af41a7d`；由 W7 的收尾者跑完，log 贴在 PR
[#128](https://github.com/teyru-lang/Teyru/pull/128) 的留言里）。唯一的失败是 `native/net_c_test`
那个链接失败（`go test` 不跑那个文件），而 10 个已知失败**正好**是 `known-failures.txt` 现在的
十条（`t230`、`t231`、`t234`–`t237`、`t239`、`t246`–`t248`，我核对过名单），所以「列出的都失败、
没列出的都没漏」成立；45 支 java-compat 在 324 里面。

**两组数字为什么不同，原因要写清楚**：PR 描述里的 `320 过、1 失败、9 已知失败、0 跳过` 量的是
分支那一对——`tests` main 多了 W8 的装箱赋值探针（`t246`–`t248`，三个都是已知失败），而且不再列
`t180`／`t196`（W5 的测试工作把它们拿掉了）。这一页引用 main 的那一组；语料那 45 支我自己重跑过，
整套那一行依照上面标的来源。

**在语料进来之前，这一页宣称的是子集，不是那句话。** 适用范围是
[docs/language.md](/zh-CN/docs/language) §12（语法层）与 §13（缺的 API 与被误拒的写法），
而它们不是空的。
### 两个后端的语义一致性（W8，**已合入 main**）

**矩阵先落地（`#122`）**：`scripts/backend-matrix.sh` 与 `make backend-matrix` 把 `tests/programs` 的
每一支程序在**六个格子**里构建并运行——{C＋clang、C＋gcc、LLVM} × {`-O0`、`-O2`}——每一格与
`.expected`／`.exit`／`.experr` 比，格子之间再互相比；被驱动具名拒绝的构建（例如 LLVM 的
`TY-INT-0100`）算「拒绝」而不是「编错」。发布工作流程会调用它，与 `make ci`／`make jdk-diff`／
`make notices` 并列。允许的跨格差异写在 `scripts/backend-matrix-allow.txt`：没有工作项与原因的条目
不收，而已经不再分歧的条目会让它失败。矩阵量到的停止点数字（406 格、66 支程序六格齐全）留在 §2。

**它找到的两个真实缺陷，两个都修好了（`#129`、`#131`）。**

- **装箱目标的复合赋值**：两个后端现在共用同一个降级（JLS 15.26.2 的拆箱→运算→装箱），所以
  `1L <<= 33` 是 `8589934592`（JDK 的答案），红先测的 `t246`／`t247`／`t248` 现在通过——那三条
  `known-failures.txt` 条目已经删掉。
- **`a + b + c` 的求值顺序**：C 后端不再把表达式折成单个 C 表达式，所以 gcc 与 clang 都打印
  `1(1)2(2)3(3)=6`，与 javac 21 相同（我两个 `--cc` 各建一次验的）。

**一件仍然不宣称的事要写出来**：Java 的 `HashMap` 在表长到 64 格之后，同一个桶超过 8 个元素时会
把它树化，而树化后的顺序由 `System.identityHashCode` 决胜——那个值原则上不可重现。所以那个形状的
迭代顺序我们**不宣称**与 JDK 相同。**64 格以下不会树化**，所以任何更小的表在任何键集合上都走 Java
的顺序（我对照 JDK 验过：六个字符串键，以及 20 个只有 `hashCode` 的自定义键类型）。

### TLS 可达性与平台（W9，已合入 main）

TLS 现在由**程序的调用图**决定要不要链接，不再因为反射表而自动可达：一个不调用 `ssl()` 的
web 程序在没有 OpenSSL 头文件的机器上照样构建与服务，Gson 形状的程序能编译给 windows/amd64，
而真的调用 `ssl()` 的程序行为不变（链接的内容与输出都一样）。通过反射到达 TLS 的调用得到
一个具名、可拦截的 `UnsupportedOperationException`，而不是跳到 `NULL`。`tests/run.sh` 与
`go test` 都读 `TEYRU_TARGET`，`resolveTarget` 也接受调用端给的 `--cc`，所以
`darwin/amd64` 与 `darwin/arm64` 可以用 `zig cc` 通过 `teyru build` 构建。

### 基准与宣称一致（W10）

`examples/bench_*.teyru` 与对应的 `.java` 改成从命令行读规模，`scripts/bench.sh` 因此输出
**短跑与长跑两组表**，并新增 `bench_string_cjk`（非 ASCII 的拼接、`charAt` 遍历、`substring`）
与峰值 RSS；测量窗口跑完了（`RUNS=5 JAVA=1`、`-O2`、树 `130565a`，进入与离开时的 1 分钟
负载都低于 1）。**长跑那一组是唯一能支持吞吐结论的，而它说的是 Teyru 一项都没赢**
（`fib` 平手，其余 Java 快 1.13～6.8 倍）；短跑那组的优势是启动，不是吞吐。这一页不重述
数字，因为它们必须连着测量方法读：见 [docs/index.md](/zh-CN/docs) 的〈为什么比 JVM 快〉。
GraalVM 的 `native-image` 对照**未测**（这台机器上没有 GraalVM），如实写成未测。

### 第三方声明与文件规范（W11、W12，已合入 main）

- `THIRD-PARTY-NOTICES.md` 补上 OpenSSL（版本下限 1.1，动态链接）、Windows 目标静态链接的
  mingw-w64 运行时、主机自己的 IANA tzdata（不分发、不内建）与 W5 的 Unicode 数据（Unicode
  License v3）；运行时不再逐文件列名，而是按目录声明，清单由 `scripts/check-notices.sh`
  （`make notices`）生成、也由同一个脚本核对。
- `AGENTS.md` 增补三条规则：Java 语义的改动必须附 JDK 差分测试、面向外部输入的代码必须附
  对抗测试、文件里的每一条能力声明都要指得到测试。
- **GPL-2.0 with Classpath Exception 与 OpenSSL 3（Apache-2.0）的相容性**列为需要 owner 决定，
  文件只叙述事实、不下结论（见 [docs/legal.md](/zh-CN/docs/legal) §9）。

---

## 2. 量到了什么

数字都连着方法与环境读；这一页只放几个这一版特有的：

| 量到的东西 | 数字 | 怎么量的 |
|---|---|---|
| 可执行文件大小（hello world，`-O2`） | **67,240 B**（`-O0` 118,608、`-O1` 90,352、`-O3` 70,672） | `wc -c`；比 0.2 时代的 55,920 大，三次成长是装箱缓存（+6,016）、栈检查（+2,256）与 W9 的 TLS 链接（+120），量在 [docs/index.md](/zh-CN/docs) |
| LLVM 后端的边界 | `tests/programs`（`34584f2`）256 支里 159 支建得起来、153 支输出相同、93 支具名拒绝 | 2026-09-17，`teyru build --backend=llvm` 逐支跑并与 `.expected` 比（[docs/index.md](/zh-CN/docs) 有完整分类） |
| `linux/arm64` 的整套 | **250 项全过、0 项不符**（qemu-aarch64，容器里的 sysroot 自建）；W9 之后用 `TEYRU_TARGET` 重测：**286 项里 271 过、5 失败、10 已知失败**，而 5 个失败**原生也一样失败** | `sh tests/run.sh` 与 `TEYRU_TARGET=linux/arm64 … sh run.sh`，见 [docs/index.md](/zh-CN/docs) 的平台表 |
| Windows 目标 | 195 支里 179 支逐字节相同（Wine 下跑） | 同上 |
| macOS 两列 | **只到「编译并链接」**：257 支里 240 支建得起来、9 支因 TLS 被具名拒绝、8 支那个版本的编译器还不接受；产物是 Mach-O，**没有任何一行被运行过** | `teyru build --cc <zig 包装>`（`zig cc -target aarch64-macos`），见平台表 |
| 递归过深的代价 | `bench_fib` 长跑回退约 32% | `scripts/bench.sh` 长跑前后，owner 已裁决接受 |
| W7 的语料 | **45 支全过、0 失败**（`tests/java-compat`；Teyru main `9be8159` → `tests` `4ac49a7`） | `sh tests/run.sh java-compat`，在 main 上的那个内容跑（我自己跑的；`make java-compat` 是同一件事） |
| 字符串与 Unicode（W5）的 JDK 差分 | 写的一半 **32/32 逐字节相同**；读的一半 **39/41**，其余两项是已声明的差异 | 同一支程序写两次（`.teyru` 与 Java），`/opt/jdk21/jdk-21.0.11+10` 跑 Java 那一半再逐行 diff；在 `9be8159` 上跑 |
| W8 的两个缺陷 | 装箱复合赋值 `1L <<= 33` → `8589934592`；`f(1)+f(2)+f(3)` 在 clang 与 gcc 都打印 `1(1)2(2)3(3)=6` | `t246`–`t248`（已从 `known-failures.txt` 拿掉）与一支 `--cc` 各建一次的程序；与 javac 21 比对 |
| 整套测试 | **324 过、1 失败、10 已知失败、0 跳过**——量在 `0e8e592` → `tests` `af41a7d` 的内容上（比现在的主线旧：`known-failures.txt` 当时有 10 条，现在是 4 条），唯一的失败是 `native/net_c_test` 的链接失败 | `sh tests/run.sh`；log 与名单见 PR [#128](https://github.com/teyru-lang/Teyru/pull/128) 的留言（这一行不是我自己跑的；重测会在 tag 的那个 commit 上跑，之后补上） |

（macOS 那一列是 W9 之后重测的（2026-09-17，`tests` @ `e4268a6`，编译器 `5ac017b`）；
`linux/arm64` 那一列 W9 之后的 `TEYRU_TARGET` 重测已经跑完，两个数字都写在上面的表里。）

---

## 3. 还没实现

完整的清单在 [docs/language.md](/zh-CN/docs/language) §13，与标准库的缺口在同页 §11；
运行时与线程的已知限制在 `AGENTS.md` §10。这一页不复制它们，只说方向：

- checked exception 没有编译期检查；
- `sealed` 的 `permits` 子句没有被验证（switch 穷尽性因此要求 `default`）；
- 反射没有泛型类型参数，所有的数组共用一个类；
- 与 Java 生态互通（JAR、JDK 类库、JNI）没有，这是刻意的取舍；
- locale 相关的大小写映射（`tr`、`az`、`lt`）没有实现，`String.toUpperCase()` 一律走 root locale 的规则。

## 4. 这一版不宣称什么

- **速度**。0.4.0 是正确性版本：计划的第 5 阶段（W13 编译速度、W14 运行时性能）不在这一版，
  而且 W14 在计划里本来就是可选的。已经量到的**回退**如实写在上面（`bench_fib` 长跑 32%），
  而 W10 的长跑表就是这个立场的证据：六行里 Teyru 一行都没赢（`bench_alloc` 那一行要排除在外——
  它量的是「Teyru 真的分配」对上「Java 把分配优化掉」，关掉 JIT 之后同一支程序 Teyru 反而快
  约 20 倍，见 [docs/index.md](/zh-CN/docs) 的说明）。唯一的例外是启动、可执行文件
  大小与峰值内存——那三项是量到的，也是这一版真正赢的地方。
- **精确或分代回收器**。owner 的顺序是「先把这些修好、切 0.4，再谈把服务器的运行时换成
  精确或分代的回收器」，所以那是下一个版本的事；0.4 的回收器仍然是保守式标记清除。
- **macOS 可以跑**。那两列只到「编译并链接」：没有任何 Mach-O 可执行文件被运行过（这里没有
  一台 macOS），而「编译成功」不等于「跑得起来」。
- **`HashMap` 在那个形状上的迭代顺序**。表长到 64 格以后、同一个桶超过 8 个元素时 Java 会树化，
  而树化后的顺序由 `System.identityHashCode` 决胜——那个值原则上不可重现，所以那个形状我们不宣称
  与 JDK 相同（64 格以下不会树化，见 W8 那一节）。
- **把「Java 源代码不改就能编译」当成一句没有范围的话**。W7 已合入 main，未经修改的 Java 在
  **测过的子集**上编得过（见上），但语料还没进 main 的 submodule 指标，而 §12／§13 的差别也还在——
  所以这一版宣称的是那个子集，不是那句话。
- **与 javac 一致**。我们不是一致的：`'😀'` 这里是 `TY-SYN-0008`（一个 `char` 字面值只收一个
  UTF-16 code unit），而 JDK 21 **接受**它并取 55357——这一条是我们比 javac 严，不是我们对。
- **checked exception 有被跟踪**。完全没有：`throws` 只被解析，JDK 差分里 javac 拒绝的 16 个
  案例有 8 个是这个原因（`tests/jdk-diff-allow.txt` 逐条写着）。owner 决定把这条留成文件化的
  差异，不是待办事项。
- **静态初始化的急切程度与 Java 相同**。这个编译器在 `main` 之前先初始化程序自己的类，
  Java 是第一次使用时才初始化；语义差异与它的测试写在 `AGENTS.md` §10。
- **LLVM 后端与 C 后端同等**。它**不是**发布构建默认用的后端（默认是 C），而且两者还不同等：
  2026-09-17 实测 256 支测试程序，159 支建得起来、其中 153 支输出与期望完全相同、6 支不同
  （JDK 探针，列在 `known-failures.txt`）、93 支被具名拒绝、0 个模块 clang 不收；lambda 与
  方法引用现在不在拒绝名单里，排在最前面的是要靠注解的声明（38）。完整的拒绝分类见
  [docs/index.md](/zh-CN/docs) 的〈后端与平台〉。
- **有 CI**。这个项目没有在 push 或 PR 上跑的 CI（owner 的决定），关卡是人在这台机器上跑
  `make ci`；唯一的工作流是发布 release 时那一个。

## 5. 需要 owner 操作或决定

- **许可证**：GPL-2.0 with Classpath Exception 与 OpenSSL 3（Apache-2.0）的相容性，以及分发
  「静态链接了 mingw-w64 运行时」的 windows/amd64 产物时的义务（[docs/legal.md](/zh-CN/docs/legal) §9）。
- **文档站的自动部署**：把 Vercel 的 GitHub App 授权给 `teyru-lang` 组织，在那之前每次文件
  改动都要有人手动 `vercel deploy --prod`。
