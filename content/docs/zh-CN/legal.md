---
title: "Third-party notices / 第三方组件声明"
description: "Teyru 项目实际使用与分发的第三方组件，以及各自的许可证与分发方式。"
---

本文件列出 Teyru 项目实际使用与分发的第三方组件。项目本身的许可证见 `LICENSE`。

> 编译器只用 Go 标准库，`go.mod` 没有任何外部模块依赖。生成的可执行文件会链接到的第三方
> 代码有三处：POSIX 目标上的 OpenSSL（TLS，动态链接）、`windows/amd64` 目标上的 mingw-w64
> 运行时（`-static`，静态链接进产物），以及**主机自己**的 IANA tzdata（由主机分发，本项目
> 不分发、不内建）。运行时本身（`internal/runtime/src`）与标准库（`lib/*.teyru`）都是本项目的
> 原创代码。
>
> 这份清单不是靠人记住的：`scripts/check-notices.sh`（`make notices`）拿它对照编译器仓库——
> 运行时的文件清单、OpenSSL 的版本下限、`windows/amd64` 的链接旗标、tzdata 的读取路径、许可证
> 文件是否还在、Unicode 数据文件出现时有没有列名。两边不一致时它以非零状态结束。这一页是
> `teyru-lang/Teyru` 的 `THIRD-PARTY-NOTICES.md` 的对应版本。

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
| libc / libm | 运行时使用的系统函数库 | 因系统而异（多为 LGPL-2.1+ 或 MIT） | 动态链接，不分发 |

生成的可执行文件**链接**这些函数库，但不包含其源代码。Teyru 运行时
（`internal/runtime/src`）本身是本项目的原创代码，与上述组件无许可证关联。

线程用的是系统的 pthread（glibc 2.34 之后并入 libc），另外链接的是 `-lm` 与 `libc`：
`ldd` 一支只有 `System.out.println` 的程序只看得到 `libm.so.6` 与 `libc.so.6`。这是**动态**
链接，所以那支可执行文件不含 libc 的代码。

---

## 3. 可执行文件链接的第三方函数库

| 组件 | 用途 | 许可证 | 分发方式 |
|---|---|---|---|
| OpenSSL（`libssl`、`libcrypto`） | TLS；实作在 `internal/runtime/src/tyrt_tls.c`，只有程序的可达代码碰得到 TLS 时才编译与链接 | 1.1.1 是 OpenSSL／SSLeay 双许可证；3.0 以后是 Apache-2.0 | 动态链接（`-lssl -lcrypto`），不分发 |
| mingw-w64 运行时（crt 与 winpthreads） | `windows/amd64` 目标的 C 运行时与线程；那个目标用 `x86_64-w64-mingw32-gcc` 加上 `-static` 构建 | Zope Public License 2.1（`mingw64-crt` 包附带的 `COPYING`；同一个包的 `DISCLAIMER.PD` 另外标明部分文件为 public domain，实际文件另有标成 BSD 或 LGPL 的部分） | **静态链接进产物**，所以分发可执行文件就是分发它 |
| Microsoft C 运行时与 Windows 系统 DLL（`msvcrt.dll`、`KERNEL32.dll`、`WS2_32.dll`） | Windows 目标的 C 函数库与 Winsock | Windows 的一部分 | 不分发；产物只有 import，加载时由系统提供 |
| 主机的 IANA tzdata（TZif 文件） | `lib/46_timezone.teyru` 读时区数据库 | 由分发它的主机决定。本机（Fedora 44）的 `tzdata` 包标为 `LicenseRef-Fedora-Public-Domain AND (GPL-2.0-only WITH ClassPath-exception-2.0)` | **不分发、不内建**；见下面〈tzdata〉 |

### OpenSSL

TLS 是这个项目唯一**不自己实现**的一层，而它只有碰得到才进可执行文件。`internal/driver/driver.go`
的目标表在 `linux/amd64` 与 `linux/arm64` 的 `tlsLibs` 写着 `-lssl`、`-lcrypto`：两个都要，
因为 X509 与 EVP 的调用是 libcrypto 的，而 `-lssl` 不是每个平台的链接器都会顺带拉进它。
`ldd` 一支用到 TLS 的程序（`tests/programs/t191_tls_keepalive.teyru`）看得到
`libssl.so.3` 与 `libcrypto.so.3`——**动态**链接，所以产物里没有 OpenSSL 的代码，
libssl 的条款不随我们的可执行文件分发。

**版本下限是 1.1，而且它是一个预处理器的 `#error`**，写在 `internal/runtime/src/tyrt_tls.c`：

```c
#if OPENSSL_VERSION_NUMBER < 0x10100000L
#error "the TLS layer needs OpenSSL 1.1 or newer (...)"
#endif
```

`SSL_set1_host`、`BIO_meth_new`、`TLS_client_method` 与 `SSL_CTX_set_min_proto_version`
都不在 1.0.x 里。下限写在编译期，所以拿 1.0.2 的头文件构建看到的是那句话，而不是一个他没写过的
运行时文件里成页的「未声明的标识符」。`scripts/check-notices.sh` 从那个 `#if` 读出十六进制的
下限，比对的就是本节这一个字符串。

### mingw-w64 运行时

`windows/amd64` 的链接旗标是 `-lws2_32 -static`（Winsock，以及让产物自足——不加 `-static`
每个程序都要旁边放一个 `libwinpthread-1.dll`）。因此 mingw-w64 的运行时（crt 与 winpthreads）
是**静态链接**进去的：实测 `x86_64-w64-mingw32-objdump -p` 对一支 hello 只看到
`KERNEL32.dll`、`msvcrt.dll`、`WS2_32.dll` 三个 import，而 `pthread_create` 这类符号定义在
产物里面、没有任何 `libwinpthread` 或 `libgcc_s` 的 import。分发那支可执行文件时，mingw-w64
运行时的条款（ZPL-2.1，与文件上另外标明为 public domain、BSD 或 LGPL 的部分）跟着走。

### tzdata

时区数据在**主机**上，不在这个仓库里，也不在任何产物里：`lib/46_timezone.teyru` 读主机的 TZif
文件，目录取自 `$TZDIR`（有设且非空时）否则 `/usr/share/zoneinfo`，默认时区取自 `TZ` 或
`/etc/localtime`。UTC 与 `GMT`／`+08:00` 这种数值 id 是内建的，所以只用到 UTC 的程序不需要
tzdata；其余的区域在没有 tzdata 的主机（Windows，或没装 tzdata 的容器）上以
`ZoneRulesException` **具名拒绝**，不会答错。数据的著作权跟着分发它的主机（发行版的 `tzdata`
包），本项目不对它主张任何权利，也不重新分发它。

---

## 4. 运行时与标准库

| 组件 | 来源 | 许可证 |
|---|---|---|
| Teyru 运行时（`internal/runtime/src/` 整个目录） | 本项目原创 | 见 `LICENSE` |
| Teyru 标准库（`lib/*.teyru`） | 本项目原创，以 Teyru 编写 | 见 `LICENSE` |

运行时不再逐文件列名，而是**按目录声明**，清单由 `scripts/check-notices.sh` 从目录生成、也由
同一个脚本核对（编译器仓库里执行 `make notices`）。目前 11 个文件：

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

垃圾回收器、字符串、数组、异常与 box 类都是本项目自行实现，没有 Boehm GC、没有 libgc、
没有 mimalloc 之类的分配器。运行时唯一的第三方代码是碰得到 TLS 时链接的 OpenSSL（见 §3），
它是动态链接，运行时文件自己不含它的代码。

---

## 5. Unicode 数据与生成的查表

`Character` 的字符分类与大小写映射需要 Unicode 的数据，而那份数据**目前还没有随编译器入库**
（在那之前分类与映射只认 ASCII，见〈语言参考〉§12 第 12 条）。要入库的是 Unicode 15.0 的数据
文件（`UnicodeData.txt`、`SpecialCasing.txt`、`CaseFolding.txt`、`PropList.txt` 与同批的其他
文件）以及由它们生成、一并入库的两级查表；这些文件依 **Unicode License v3**（UNICODE LICENSE V3，
Copyright © 1991-2024 Unicode, Inc.，条款见
[https://www.unicode.org/license.txt](https://www.unicode.org/license.txt)）分发，著作权声明
随文件保留。

版本固定 15.0 是为了与参考实现对齐：JDK 21 用的是 Unicode 15.0，所以 `Character.isLetter`
与大小写映射的答案以它为准。编译器仓库的 `scripts/check-notices.sh` 会在数据文件出现时要求
声明文件已经列名。

---

## 6. 编辑器工具（[`teyru-lang/editors`](https://github.com/teyru-lang/editors)）

编辑器支持不在编译器仓库里（测试、文件与编辑器支持各自独立成库），所以下表描述的是那个仓库的
内容：

| 组件 | 来源 | 许可证 |
|---|---|---|
| `tree-sitter-teyru/src/tree_sitter/alloc.h`、`array.h`、`parser.h` | 从 [tree-sitter](https://github.com/tree-sitter/tree-sitter) 复制，供生成的解析器使用 | MIT（Copyright (c) 2018 Max Brunsfeld） |
| `tree-sitter-teyru/src/parser.c` | 由 tree-sitter CLI（v0.25.10）从 `grammar.js` 生成的解析表与词法分析器 | MIT（同上） |
| `tree-sitter-teyru/grammar.js`、`queries/`、`test/` | 本项目原创 | GPL-2.0-only，见同仓库的 `tree-sitter-teyru/LICENSE` |
| `vscode/`（TextMate 语法、语言配置、片段） | 本项目原创 | 见本仓库的 `LICENSE` |

tree-sitter 的 MIT 条款要求著作权声明与许可声明随所有副本保留，本文件的这一节与
上游的 `LICENSE` 一并满足。这些文件只被编辑器用来做语法高亮与解析，不会进入
编译器，也不会进入任何生成的可执行文件。

---

## 7. 测试与工具

| 组件 | 用途 | 许可证 |
|---|---|---|
| Go 测试框架（`testing`） | `go test ./...` | BSD-3-Clause（Go 标准库的一部分） |
| OpenJDK / HotSpot | **只用于** `scripts/bench.sh` 的对照测量 | GPL-2.0 with Classpath Exception |

`scripts/bench.sh` 需要 `java` / `javac` 才会执行 JVM 那一半；若系统没有安装，
脚本只会跳过该部分，不影响 Teyru 的构建与测试。JVM 不是 Teyru 的运行环境，
也不是任何产物的依赖。

---

## 8. 许可证文件

| 文件 | 说明 |
|---|---|
| `LICENSE` | 本项目的主要许可证 |
| `LICENSE-CLASSPATH-EXCEPTION-2.0` | Classpath Exception 全文（条款来自 OpenJDK，随主要许可证一并保留） |
| `tree-sitter-teyru/LICENSE`（在 `teyru-lang/editors`） | 该文法本身的许可证（GPL-2.0-only，与本项目主要许可证相同） |

若发行时修改了上述任何一项（例如把 clang 或 OpenSSL 静态链接进产物，或把 Go 标准库
嵌入发行包），必须重新生成本文件并附上对应的许可证全文；运行时的文件清单则执行
`make notices` 重新生成。

---

## 9. 需要 owner 确认

本节只记下问题，**不自行下结论**：

- 本项目的主要许可证是 GPL-2.0 with Classpath Exception（`LICENSE` 与
  `LICENSE-CLASSPATH-EXCEPTION-2.0`）。OpenSSL 3.0 以后是 Apache-2.0，而 `linux/amd64` 与
  `linux/arm64` 的产物**动态链接**它；1.1.1 则是 OpenSSL／SSLeay 双许可证。Classpath Exception
  的条款允许链接独立模块并以自己选择的条款分发产物，但它与 Apache-2.0 的相容性、以及分发
  「静态链接了 mingw-w64 运行时（ZPL-2.1）」的 `windows/amd64` 产物时的义务，属于许可证判断，
  由 owner 决定。
- 在这条有答案之前，本文件只叙述事实：哪个目标链接到什么、怎么链接、各自的条款是什么。
