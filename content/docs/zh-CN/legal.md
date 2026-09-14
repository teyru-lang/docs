---
title: "Third-party notices / 第三方组件声明"
description: "Teyru 项目实际使用与分发的第三方组件，以及各自的许可证与分发方式。"
---

本文件列出 Teyru 项目实际使用与分发的第三方组件。项目本身的许可证见 `LICENSE`。

> 编译器只用 Go 标准库，`go.mod` 没有任何外部模块依赖；生成的可执行文件只链接到
> 系统 C 函数库与本项目自带的运行时。因此本清单很短，而且是完整的。

---

## 1. 构建编译器所需

| 组件 | 用途 | 许可证 | 分发方式 |
|---|---|---|---|
| Go 标准库（`go1.26` 以上） | 构建 `cmd/teyru` 与 `internal/*` | BSD-3-Clause（Copyright The Go Authors） | 不分发，用户自行安装 |

Go 标准库以 BSD 3-Clause 许可证发布，条款见
[https://go.dev/LICENSE](https://go.dev/LICENSE)。本项目未修改标准库，也未将其嵌入产物。

---

## 2. 生成可执行文件所需（后端）

| 组件 | 用途 | 许可证 | 分发方式 |
|---|---|---|---|
| clang / LLVM（默认后端） | 将生成的 C 编译为原生可执行文件 | Apache-2.0 with LLVM Exceptions | 不分发，用户自行安装；也可用 gcc 替代 |
| GCC（替代后端） | 同上 | GPL-3.0-or-later（运行时例外） | 不分发，用户自行安装 |
| libc / libm / libpthread | 运行时使用的系统函数库 | 因系统而异（多为 LGPL-2.1+ 或 MIT） | 动态链接，不分发 |

生成的可执行文件**链接**这些函数库，但不包含其源代码。Teyru 运行时
（`internal/runtime/src`）本身是本项目的原创代码，与上述组件无许可证关联。

---

## 3. 运行时与标准库

| 组件 | 来源 | 许可证 |
|---|---|---|
| Teyru 运行时（`internal/runtime/src/`：`tyrt.h`、`tyrt.c`、`tyrt2.c`、`tyrt_net.h`、`tyrt_net.c`） | 本项目原创 | 见 `LICENSE` |
| Teyru 标准库（`lib/*.teyru`） | 本项目原创，以 Teyru 编写 | 见 `LICENSE` |

没有使用任何第三方 C 函数库（没有 Boehm GC、没有 libgc、没有 mimalloc 之类的
分配器）：垃圾回收器、字符串、数组、异常与 box 类都是本项目自行实现。

---

## 4. 编辑器工具（[`teyru-lang/editors`](https://github.com/teyru-lang/editors)）

| 组件 | 来源 | 许可证 |
|---|---|---|
| `tree-sitter-teyru/src/tree_sitter/alloc.h`、`array.h`、`parser.h` | 从 [tree-sitter](https://github.com/tree-sitter/tree-sitter) 复制，供生成的解析器使用 | MIT（Copyright (c) 2018 Max Brunsfeld） |
| `tree-sitter-teyru/src/parser.c` | 由 tree-sitter CLI（v0.25.10）从 `grammar.js` 生成的解析表与词法分析器 | MIT（同上） |
| `tree-sitter-teyru/grammar.js`、`queries/`、`test/` | 本项目原创 | GPL-2.0-only，见 `tree-sitter-teyru/LICENSE` |
| `vscode/`（TextMate 语法、语言配置、片段） | 本项目原创 | 见 `LICENSE` |

tree-sitter 的 MIT 条款要求著作权声明与许可声明随所有副本保留，本文件的这一节与
上游的 `LICENSE` 一并满足。这些文件只被编辑器用来做语法高亮与解析，不会进入
编译器，也不会进入任何生成的可执行文件。

---

## 5. 测试与工具

| 组件 | 用途 | 许可证 |
|---|---|---|
| Go 测试框架（`testing`） | `go test ./...` | BSD-3-Clause（Go 标准库的一部分） |
| OpenJDK / HotSpot | **只用于** `scripts/bench.sh` 的对照测量 | GPL-2.0 with Classpath Exception |

`scripts/bench.sh` 需要 `java` / `javac` 才会执行 JVM 那一半；若系统没有安装，
脚本只会跳过该部分，不影响 Teyru 的构建与测试。JVM 不是 Teyru 的运行环境，
也不是任何产物的依赖。

---

## 6. 许可证文件

| 文件 | 说明 |
|---|---|
| `LICENSE` | 本项目的主要许可证 |
| `LICENSE-CLASSPATH-EXCEPTION-2.0` | Classpath Exception 全文（条款来自 OpenJDK，随主要许可证一并保留） |
| `tree-sitter-teyru/LICENSE`（在 `teyru-lang/editors`） | 该文法本身的许可证（GPL-2.0-only，与本项目主要许可证相同） |

若发行时修改了上述任何一项（例如把 clang 静态链接进产物，或把 Go 标准库
嵌入发行包），必须重新生成本文件并附上对应的许可证全文。
