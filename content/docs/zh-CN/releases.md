---
title: "版本与变更"
description: "Teyru 的版本：0.4.0 是正确性版本——改了什么、量到了什么、还没实现什么，以及这一版刻意不宣称什么。"
---

这一页描述 **0.4.0**：这个项目第一个以「正确性」为主题的版本。它处理的是外部审查与实测
找出的一批问题（计划的 W1–W12），不是速度——速度是下一个阶段的事。

这一页在 0.4.0 发布前写成，所以每一项都标了状态：**已合入 main** 的项目就是读者现在装得到
的行为；**进行中**的项目附上 PR 或工作项，合入之后才拿掉标记。发布时整页不该再有「进行中」。

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

### 字符串与 Unicode（W5，**尚未合入 main**）

这一项**不在** 0.4.0 目前的主线上：第一部分的 PR 还是 draft，其余部分还在后面。目标是让
字符串的存储与索引语义对齐 Java——`length`／`charAt`／`substring`／`indexOf`／`compareTo`／
`hashCode` 以 UTF-16 code unit 计算（`"中文".length()` 是 2），`Character` 的分类与大小写
映射改用 Unicode 15.0 的数据与完整大小写映射（`ß` → `SS`、希腊语词尾 sigma），`strip` 认得
全角空白，边界上的非法 UTF-8 以 U+FFFD 取代、没有伙伴的代理以 `?` 编出。内部存储是 WTF-8
加面包屑（`tystr` 仍是 24 字节），「改用 JDK 式 compact strings」那个备选还需要基准数据才能
比较，所以这一版不下结论。

在它合入之前，**今天的**行为与 JDK 的差别（含实测数字）写在
[docs/language.md](/zh-CN/docs/language) §12 第 12 条，缺的 API 在 §13；字节边界的测试
（`t196_string_bytes`）在测试仓库里。

### 装箱、容器顺序与异常名称（W6，部分进行中）

- **装箱缓存**（已合入）：`Integer`／`Short`／`Byte`／`Long` 缓存 −128..127、`Character`
  缓存 0..127、`Boolean` 只有两个实例，所以 `Integer.valueOf(127) == Integer.valueOf(127)`
  与 Java 一样是 `true`；跨过一次调用也不会坏（`t242_box_identity_across_call`，期望值由
  javac 生成）。
- **越界消息**（已合入）：`Index 5 out of bounds for length 3`（大写 `I`，JDK 的句子）。
- **`HashMap`／`HashSet` 的迭代顺序**对齐 JDK 21 与**异常的全限定名**（`java.lang.*`）仍在
  进行中；在那之前它们列在 §13。

### Java 源代码相容（W7，进行中）

目标是让「Java 源代码不改就能编译」在一个可测试的子集上成立：分号可选、接受 `.java` 扩展名、
依 JLS §14.22 与第 16 章做可达性与明确赋值（修掉 `switch` 结尾方法的 `TY-TYP-0020` 误报）、
补齐缺的 API 与常见的泛型推断。在它合入之前，这一页不宣称那句话——今天的差异在
[docs/language.md](/zh-CN/docs/language) §12 与 §13，而 [docs/index.md](/zh-CN/docs) 的
〈支援的语言特性〉写的是「Java 开发者一看就懂」，不是「不改就能编译」。

### 两个后端的语义一致性（W8，进行中）

目标是 {C＋clang、C＋gcc、LLVM} × {`-O0`、`-O2`} 的矩阵全部一致，并把数值提升、复合赋值、
移位、字符串拼接、装箱与检查等规则下沉成共享的降级。LLVM 后端目前的边界（2026-09-17 实测：
256 支测试程序中 159 支建得起来、其中 153 支输出与期望完全相同、93 支被具名拒绝、4 支在
后端之前就被拒绝、0 个模块 clang 不收）写在 [docs/index.md](/zh-CN/docs) 的〈后端与平台〉。

### TLS 可达性与平台（W9，已合入 main）

TLS 现在由**程序的调用图**决定要不要链接，不再因为反射表而自动可达：一个不调用 `ssl()` 的
web 程序在没有 OpenSSL 头文件的机器上照样构建与服务，Gson 形状的程序能编译给 windows/amd64，
而真的调用 `ssl()` 的程序行为不变（链接的内容与输出都一样）。通过反射到达 TLS 的调用得到
一个具名、可拦截的 `UnsupportedOperationException`，而不是跳到 `NULL`。`tests/run.sh` 与
`go test` 都读 `TEYRU_TARGET`，`resolveTarget` 也接受调用端给的 `--cc`，所以
`darwin/amd64` 与 `darwin/arm64` 可以用 `zig cc` 通过 `teyru build` 构建。

### 基准与宣称一致（W10，部分进行中）

`examples/bench_*.teyru` 与对应的 `.java` 改成从命令行读规模，`scripts/bench.sh` 因此输出
**短跑与长跑两组表**，并新增 `bench_string_cjk`（非 ASCII 的拼接、`charAt` 遍历、`substring`）
与峰值 RSS。这一页不重述性能数字，因为那一页的数字必须连着测量方法读：见
[docs/index.md](/zh-CN/docs) 的〈为什么比 JVM 快〉。

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
| 可执行文件大小（hello world，`-O2`） | **66,808 B**（`-O1` 85,440、`-O3` 70,248） | `wc -c`；比 0.2 时代的 55,920 大，三次成长是装箱缓存（+6,016）、栈检查（+2,256）与 W9 的 TLS 链接（+120），量在 [docs/index.md](/zh-CN/docs) |
| LLVM 后端的边界 | 256 支里 159 支建得起来、153 支输出相同、93 支具名拒绝 | 2026-09-17，`teyru build --backend=llvm` 逐支跑并与 `.expected` 比（[docs/index.md](/zh-CN/docs) 有完整分类） |
| `linux/arm64` 的整套 | **250 项全过、0 项不符**（qemu-aarch64，容器里的 sysroot 自建） | `sh tests/run.sh`，见 [docs/index.md](/zh-CN/docs) 的平台表 |
| Windows 目标 | 195 支里 179 支逐字节相同（Wine 下跑） | 同上 |
| macOS 两列 | **只到「编译并链接」**：188 支编译得过、产物是 Mach-O；没有任何一行被运行过 | `zig cc -target <arch>-macos`，见平台表 |
| 递归过深的代价 | `bench_fib` 长跑回退约 32% | `scripts/bench.sh` 长跑前后，owner 已裁决接受 |

（平台那三列的数字在 W9 之后正在重测：`--cc` 与 `TEYRU_TARGET` 把 macOS 与 arm64 变成
`teyru build` 走得通的路径，重测完成之后这一页与平台表会一起更新。）

---

## 3. 还没实现

完整的清单在 [docs/language.md](/zh-CN/docs/language) §13，与标准库的缺口在同页 §11；
运行时与线程的已知限制在 `AGENTS.md` §10。这一页不复制它们，只说方向：

- checked exception 没有编译期检查；
- `sealed` 的 `permits` 子句没有被验证（switch 穷尽性因此要求 `default`）；
- 反射没有泛型类型参数，所有的数组共用一个类；
- 与 Java 生态互通（JAR、JDK 类库、JNI）没有，这是刻意的取舍。

## 4. 这一版不宣称什么

- **速度**。0.4.0 是正确性版本：计划的第 5 阶段（W13 编译速度、W14 运行时性能）不在这一版，
  而且 W14 在计划里本来就是可选的。已经量到的**回退**如实写在上面（`bench_fib` 长跑 32%）。
- **精确或分代回收器**。owner 的顺序是「先把这些修好、切 0.4，再谈把服务器的运行时换成
  精确或分代的回收器」，所以那是下一个版本的事；0.4 的回收器仍然是保守式标记清除。
- **macOS 可以跑**。那两列只到「编译并链接」：没有任何 Mach-O 可执行文件被运行过（这里没有
  一台 macOS），而「编译成功」不等于「跑得起来」。
- **Java 源代码不改就能编译**（在 W7 合入并有 `tests/java-compat/` 撑着之前）。
- **静态初始化的急切程度与 Java 相同**。这个编译器在 `main` 之前先初始化程序自己的类，
  Java 是第一次使用时才初始化；语义差异与它的测试写在 `AGENTS.md` §10。
- **有 CI**。这个项目没有在 push 或 PR 上跑的 CI（owner 的决定），关卡是人在这台机器上跑
  `make ci`；唯一的工作流是发布 release 时那一个。

## 5. 需要 owner 操作或决定

- **许可证**：GPL-2.0 with Classpath Exception 与 OpenSSL 3（Apache-2.0）的相容性，以及分发
  「静态链接了 mingw-w64 运行时」的 windows/amd64 产物时的义务（[docs/legal.md](/zh-CN/docs/legal) §9）。
- **文档站的自动部署**：把 Vercel 的 GitHub App 授权给 `teyru-lang` 组织，在那之前每次文件
  改动都要有人手动 `vercel deploy --prod`。
