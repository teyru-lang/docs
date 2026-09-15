---
title: "Teyru 编译器架构"
description: "从源文件到原生可执行文件的完整流程：词法、语法、语义分析、代码生成（C 或 LLVM IR）、平台层与运行时。"
---

## 流程

```
源文件 (UTF-8)
   │  internal/source      — 文件、行号对应、诊断容器
   ▼
Token 串
   │  internal/lexer       — 关键字、运算符、字面值、文字区块
   │                        换行不是 token，只在 token 上标记 NL 标志
   ▼
AST
   │  internal/parser      — 递归下降；游标 + 前瞻 + 选择点回退
   ▼
已检查的程序模型
   │  internal/sema        — 符号表、类型、泛型擦除、重载、布局
   ▼
生成的代码
   │  internal/codegen    — C 后端（默认）：类→struct、vtable／itable、GC 根信息
   │                        LLVM 后端（--backend=llvm）：程序自己的 LLVM IR
   ▼
原生可执行文件
      clang/LLVM 或 gcc + internal/runtime/src（GC、字符串、数组、异常）
                                    └ 平台层 tyrt_plat.h → tyrt_plat_posix.c 或 tyrt_plat_win.c
```

## 换行作为语句终止符

Teyru 没有分号。词法分析器不产生 NEWLINE token，而是在每个 token 上记录
「前面是否有换行」。解析器用两件事判断语句是否结束：

1. **当前解析位置的换行是否显著**（`nl` 栈；括号内、实参列表内不显著）。
2. **前缀是否已完整**。例如 `return` 后面直接换行就是无值 return，
   但运算符、逗号、`.`、`::`、`->` 之后的换行不终止语句，
   行首是 `.`／`::` 时也视为延续。

`internal/parser/parser.go` 的 `continues()` 是唯一的判断点。

## 类型与符号

- `ast.Type` 有七种：原生、类（含类型实参）、数组、类型变量、通配符、null、error。
- 泛型在 `sema.erasure` 擦除；运行时只知道类，不知道类型实参。
- 重载解析（`pickOverload`）走 JLS 的三个阶段（严格、允许 boxing、可变参数），
  第一个找得到适用候选的阶段就决定，只有同一阶段内才比转换成本（完全相同 0、
  拓宽／向上转型 1、boxing 2、unboxing 3；boxing 之后还要向上转型时是 3）。
- 方法的 vtable 槽位在 `layout()` 决定：由父类复制，覆写者沿用同一槽位；
  接口方法另有全局唯一的 selector（`Selector`），供 itable 使用；每个类的接口表是
  **稀疏**的，只放它自己实现得出来的 selector，依 selector 排序，`ty_itab` 扫过这几个
  条目再往父类找。（密集表一格一个指针、格数等于整个程序的 selector 总数，一个类
  不论实现几个都要付这笔 `.data`，hello world 就因此背了 792 KB。）

## 生成 C 的关键对应

| Teyru | C |
|---|---|
| 类 `Foo` | `struct C_Foo { tyobj obj; ... }`（字段依 `InstFields` 平铺，含继承） |
| 实例方法 | `M_<class>_<name>_<idx>(C_Foo* this, ...)` |
| 虚调用 | `this->obj.cls->vtable[slot](...)` |
| 接口调用 | `ty_itab(obj, selector)(...)` |
| `new Foo(...)` | GNU 语句表达式：分配 → 设 `cls` → 调用构造函数 |
| 数组 | `tyarr { tyobj; len; data; esize; refs; elemcls }`，元素内嵌 |
| 字符串常量 | 静态 `tystr`（不经过 GC） |
| `try`/`catch` | `tycatch` + `setjmp`/`longjmp` |
| property 读写 | 降级成 getter／setter 调用（`sema.Props` 记录） |
| `for (a : b : c)` | C 的 `while`：`a` 先跑一次，每轮重新测试 `b`，`c` 放在循环末尾，`continue` 跳到循环末尾的标签 |
| 记录 `Point(int x,int y)` | struct + 构造函数 + `x()`/`y()` + `toString`/`hashCode`/`equals` |
| enum 常量 | 静态字段，于 `<clinit>` 中创建并填入 ordinal／name |

### 为什么每个可执行文件都带着前缀（vtable 与 LTO）

C 后端为每个类写出一张完整的 vtable，把「没人调用的东西」留给 clang 的 LTO 删。
这条路走不通，原因值得记下来：**LTO 删不掉地址被取用的函数**，而 vtable 就是一串
地址（`vt_X[i] = (void*)M_X_i`）。`cls_X` 在每个程序里都是活着的——`main` 会装上
`String`、`Object`、数组、boxed 类型与异常类——所以 X 声明的每一个实例方法都留了
下来，每一个又指名它分配的类，这个闭包最后吞掉大半个标准库：一支只印一个字符串
的 hello world 背着 `java.util.stream`，因为 `String.lines()` 就坐在 `String.length()`
旁边。在 hello world 里量到的是 **1,262 个函数存活，其中 951 个是前缀的方法，而真正被
调用到的只有 42 个**；其余 1,233 个是靠地址活着的。（`--no-lto` 在各个 commit 上只差
17–54 KB，所以这不是 LTO 的设置变了，是后端写出来的内容变多了。）

**要修的规则**是 LLVM 后端对自己的表早就写下的那一条，套用到 C 后端生成的表上：
*有调用点调度那个索引，槽位才留*。它只需要把 `NULL` 写进槽位的初始值，不重新编号、
不缩短表（运行期与类记录共用的版面因此不变），任何还活着的类保留 0、1、2 三个
槽位（运行期按索引调用它们），接口表不动（程序自己提供的 native 方法可能用编译器
没看过的 selector 调度）。**这一版还没进编译器**：剪枝量到过 95,064 字节的 hello
world，但它让 `t133_arrow_blocks`、`t84_sealed_switch`、`t51_java25_tour` 在一个没被
留下的 `NULL` 槽位上 segfault，所以退回修正中。

## 后端与平台

### 两个后端

**C 后端是默认**：它替整个程序生成 C，上面那张对应表就是它的规则。`--backend=llvm`
改用 **LLVM 后端**，直接生成**这个程序自己的 LLVM IR 模块**（`internal/codegen/llvm.go`
的 `EmitLLVM`）：运行期仍然是 C，clang 只负责把模块汇编并与运行期链接。模块带着
目标 triple，也直接调用这个平台的 C 函数库，所以它只对它被写出来的那个平台是对的
——现在只有 linux/amd64，其他目标以 `TY-INT-0101` 拒绝。

降不下去的构造是 `TY-INT-0100` 诊断，指名那个构造，**不会退回 C 后端**：一个程序
不是用它编得过，就是拿到一个说得出为什么的诊断。界线是量出来的：`tests/programs`
扫过一轮得到 **76 支逐字节相同、0 支输出错误、119 支被 emitter 拒绝、0 个模块
clang 不收**（最后一项不为零就让扫描以非零结束，因为 clang 不收的模块是 bug，不该
混在拒绝里）。被拒绝的那些按里程碑排序：闭包（lambda 与方法引用、局部类与匿名
类）、record／enum／注解被合成出来的成员（构造函数、accessor、`equals`／`hashCode`／
`toString`）、类型 pattern 与带守卫的 switch、内部类，然后是其余（`synchronized`、
接口调度、try-with-resources、`Class.forName` 等）。

这是后端的现况，不是「Teyru 不用 C」：运行期是 C，默认后端也是 C。

### 平台层

运行期对操作系统的每一项需求都收在 `internal/runtime/src/tyrt_plat.h` 里，四十个
`typlat_*` 函数，分成时间与 CPU、mutex、condition variable、线程、启动、socket
与文件几组；实现有两半，`tyrt_plat_posix.c` 与 `tyrt_plat_win.c`。调用它们的只有
`tyrt.c`、`tyrt2.c`、`tyrt_thread.c` 与 `tyrt_net.c`（`tyrt_reflect.c` 一个都不用）。
刻意**不**抽象化的东西也写在头文件里：mingw 的 C 函数库长得跟 POSIX 一样，所以
`open`／`read`／`write`／`stat` 这一组由 `tyrt_net.c` 直接调用，只有形状不同的四件事
（打开旗标、`mkdir` 的参数个数、`mkdtemp`、临时目录）放在这一层后面。

`teyru build --target <os>/<arch>` 决定用哪个编译器、哪些旗标、编哪一半平台层与输出
文件名；目标表有五列，每一列背后有多少证据写在首页的〈后端与平台〉（[docs/index.md](/zh-CN/docs)）。

## 性能设计

默认后端生成的 C 由 clang/LLVM 以 `-O2` 加 LTO 编译（`--no-lto` 可关闭；不支持 LTO 的
工具链会自动回退），跨函数 inline、常量传播与循环向量化都由 LLVM 负责。在此之上，
编译器与运行时刻意让热路径保持单一指令层级：

| 机制 | 位置 | 说明 |
|---|---|---|
| 内联分配 | `tyrt.h` 的 `static inline ty_alloc` | 指针碰撞（bump pointer）路径完全内联，只有块用尽或超过 GC 阈值才调用 `ty_alloc_slow` |
| 内联边界检查 | `codegen.boundCheck` | 检查以语句表达式内联在使用点，每个索引都产生一次比较（常量索引也一样，`sema` 不先折叠，化简留给 LLVM） |
| 常量折叠 | `codegen.foldBinary`、`ident` | 字面值运算与字符串相加在编译期算完；`static final` 常量是把值替换进去，外层的算式留给 LLVM |
| 死 chunk 回收 | `tyrt.c` 的 sweep | 一个 chunk 内若没有任何存活对象就整块 `free` 还给系统，之后的回收不再走它；仍在使用的 chunk 则每个块都要走过（计数存活一次、标记或释放一次），所以单次回收的成本与保留的内存量成正比，而不是与存活量成正比 |
| 字符串常量 | `codegen.strLit` | 字符串字面值是静态 `tystr`，不经过分配、不进入 GC |
| 类初始化 | `codegen.clinitStmt` | 惰性初始化，但标志由生成的代码自己测；继承链上没有静态初始化块的类不会有 `<clinit>` 函数（slot 是 `NULL`），`main` 也不会点名它——点名等于在 `main` 里取它的地址，而一个地址就足以让链接期优化把整个类连同它的 vtable、接口表与所有方法保留在可执行文件里 |
| 逃逸分析 | `codegen.escape.go` | 不离开所在方法的对象放在 C 栈上，LLVM 得以提升字段并删除对象 |
| 原生互操作 | `codegen.native.go` | `native` 方法的 C 符号与声明由编译器生成（`--native-header`） |

逃逸分析（`escape.go`）只提升同时满足两个条件的局部对象：声明类型与 `new` 的类
完全相同（`sameCreatedClass`），且该类有编译器分配好的 struct 与可直接调用的
构造函数（`promotable`）。判定方式是遍历方法内的每一处使用（`escWalk`）：把对象当接收者
读原生字段、读「不可能装得下这个对象」的引用字段、写入对象自己的字段（含
`c.next = c`）、`instanceof`、以及调用「接收者不会外流」的方法算安全。只要引用本身
被当成值用掉（当实参、`==`／`!=`、转型、赋值给别的变量）、被存进别的对象或数组、
被返回／抛出／`yield`、被 lambda 或方法引用或匿名类捕获，或走到分析未涵盖的节点，
就留在堆上。方法是否会让接收者外流是对调用图做的传递分析（`leaksThis`）：native
方法假设不会，没有主体的方法假设会，分析中遇到环路也视为会。被提升的对象本身不在
chunk 里（`valid_obj` 会拒绝它的地址），但它的引用字段就在 C 栈上，保守的原生栈
扫描因此仍看得到它指向的堆对象。

已知的性能边界：逃逸分析只涵盖留在方法内的对象；真正上堆的对象仍走保守式
标记清除（无分代假设），在「对象长期存活、反复回收」的负载上 HotSpot 仍可能
胜出。目前的五项 benchmark 都快于 JVM；复现方式见 `sh scripts/bench.sh`。

## 垃圾回收

- **保守式标记清除**。对象不搬移，所以 C 端的临时指针永远有效。
- 根：shadow stack（`ty_roots`／`ty_sp`）、以 `ty_gc_register_static` 注册的静态字段
  地址表、以及**原生栈的保守扫描**（起点为当前栈指针，终点为线程栈顶，
  由 `pthread_getattr_np` 取得）。栈上的字不保证是对象，所以每个候选地址都要通过
  `valid_obj`：必须 16 字节对齐、必须是某个 chunk 里某个块的开头（`starts`
  位图每次回收前重建，落在块内部的地址一律不算），而且不能是已释放的块。
  落在 slab 覆盖的地址范围之外的字，在走 slab **之前**就被拒绝：不在那个范围里的字
  不可能在任一 slab 里，所以那次走访本来也会回答 0。这是纯粹的过滤，只会少做事，
  不会改变任何答案。
- 标记：`tyclass.refoffs` 列出每个类需要追踪的引用字段位移；数组用 `refs` 标志。
- **线程**：运行期为每条线程留一条注册记录（`internal/runtime/src/tyrt_thread.c`），
  回收开始前先停住每一条，再扫各自的栈，所以停止是**世界性**的。协议是**合作式**的：
  安全点在循环回边、分配慢路径、等 heap 锁、sleep／join／监视器等待，以及线程启动；
  一条既不循环、不分配也不阻塞的线程（卡在原生 `read()` 里的那种）到不了停止点，
  回收就得等它回来。
- 清除：未标记的块进入大小分级的 free list（`TY_NCLASS` 级，过大的走 `bigfree`），
  下一次分配优先重用；块大小字（header 第一个字）的最高位 `TY_FREE_BIT` 表示已释放，
  free list 的链接就放在第二个字。完全空掉的 chunk 直接 `free` 还给系统，所以长时间
  运行的程序不会一直占住峰值内存，但**头 chunk 例外**：它承载 bump 指针，永远保留。
- 触发：分配量超过 `ty_gc_threshold` 这一个条件。阈值初始 4 MB，每次回收后设为存活量
  的两倍，最低不低于 4 MB。chunk 用完**不是**回收的理由——free list 没有可用的块时
  就直接分配一个新的 chunk，因为阈值还没到就回收只是白白重扫一次活着的对象。
- 已知代价：每次回收都要扫描整个使用中的栈，且没有分代假设；清除阶段还要走过每个
  保留 chunk 的每个块。

## 异常

`ty_cur_catch` 是一条 handler 链。`throw` 调用 `ty_throw`，后者 `longjmp` 到最近的
handler；没有 handler 时打印消息并以状态 1 结束。

`finally` 有两条路径，缺一不可：

1. **异常路径**：`try` 外层包一个 handler，`setjmp` 回来后先跑 `finally`，
   再把异常重新抛出。catch 块内再抛出时也走同一条路。
2. **正常离开路径**：`return`、`break`、`continue` 不会经过 `longjmp`，
   所以代码生成器维护一个 finally 栈（`Emitter.finallys`），在每个
   跳转语句前先跑完被离开的 `finally`（由内而外），最后才跳。
   `try`-with-resources 的 `close()` 是同一个机制的隐式 `finally`，
   因此资源在 return 与异常两条路径上都会关闭。

局部与匿名类捕获的局部变量会变成合成类的字段（`Class.CapFields`），
由构造函数或 closure 创建表达式填入；这让「方法引用的接收者」也只在创建时求值一次。
