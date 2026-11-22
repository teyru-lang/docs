---
title: "还没有的东西"
description: "标准库之外、一个真实程序会撞到的整层能力：哪些在做、哪些没有，以及没有的那一层现在用什么替代。"
---

这一页回答一个问题：**拿 Teyru 写一个真的服务或工具，会在哪里停下来？**
它不列语言缺口的细节（那在[语言参考](/docs/language) §13），也不列单一 API 的
差异（在 §11 的包表）；它列的是**整层**——一层能力不存在时，不是少一个方法，
是那个工作得换做法。

每一列都写「现在有什么」，因为「没有 JDBC」不等于「不能连数据库」，它等于
「连数据库的那一段要自己写」。没有实测支撑的叙述不写在这里。

## 数据与互通

| 能力 | 现况 | 现在怎么做 |
|---|---|---|
| SQL 访问（JDBC、连接池、ORM、migration） | **没有**。标准库里没有任何 SQL 字符串、没有任何 driver 挂勾 | 通过 `ProcessBuilder` 调用 `psql`／`sqlite3`，自己解析输出；或写一个 `native` 方法接上 C 的 client library |
| XML、YAML、TOML、CSV | **有**（`lib/56`–`lib/59`）：四个读写器，各自拒绝未实现的构造，XML 的 `DOCTYPE` 是防 XXE 的具名拒绝 | 直接用；规范在[语言参考](/docs/language) §11 |
| Java 序列化（`Serializable`／`ObjectStream`） | **没有**，也不会加：那是把 JVM 的类描述写进字节，与原生可执行文件的模型不相容 | 自己的格式（JSON 绑定已经有）或 `DataOutputStream` 的明确格式 |
| JAR、JDK 类库、JNI | **具名拒绝**。这是产品契约的取舍（没有 JVM），不是待办 | 原生互通用 C 的 `native` 方法，见[原生互通](/docs/native) |
| 子进程 | **有**：`ProcessBuilder`／`Process`，三个流、目录、环境、退出码 | 直接用；没有 shell 介入，要 shell 就写 `sh -c` |

## 密码学

| 能力 | 现况 |
|---|---|
| 杂凑 | **有**：MD5、SHA-1／224／256／384／512，纯 Teyru。SHA-3 是**具名拒绝**（宁可 `NoSuchAlgorithmException`，也不要给一个不是调用者指名的那种杂凑） |
| 对称加密 | **有**：AES-128／192／256 于 ECB／CBC／CTR／GCM，PKCS#5 填充，GCM 的 tag 先验证才回明文 |
| 非对称 | **一半**：RSA PKCS#1 v1.5 的**验证**与 `Cipher` 的公钥运算；**没有签名产生**（私钥操作的取舍写在 `lib/53_rsa.teyru` 开头） |
| HMAC、CSPRNG | **有**：`Mac`（六种 Hmac*）、`SecureRandom`（`getrandom`／`/dev/urandom`／`BCryptGenRandom`，没有来源时抛异常而不是回零） |
| X.509 凭证解析、`KeyStore` | **没有**。TLS 整包交给 OpenSSL，语言层看不到凭证内容；要验证凭证栏位得自己写 DER 解析（`KeyFactory` 的 DER 读取是起点） |

## 网络

| 能力 | 现况 |
|---|---|
| 同步 socket、TLS、HTTP/1.1 客户端与服务器、WebSocket | **有** |
| 非阻塞 I/O 与 `Selector` | **有**（`java.nio` 的 heap `ByteBuffer`、三个 channel、`poll`／`WSAPoll` 的 selector） |
| HTTP/2、HTTP/3、SSE | **没有**。HTTP/1.1 的 keep-alive、chunked 与 gzip 有，这三个协议没有 |
| 非同步 channel、`FileChannel`、`Charset` | **没有**（字符串的编码在执行期只有 UTF-8 一条路） |
| 线程池与同步器 | **有**：`Executors`、`CountDownLatch`、`Semaphore`、`CyclicBarrier`、`ReentrantLock`、`Atomic*`、`ConcurrentHashMap`；**没有** `CompletableFuture`、`ForkJoinPool`、`ReadWriteLock`、`Exchanger`；`parallelStream()` 回的是循序 stream |

## 文字、数据与地区

| 能力 | 现况 |
|---|---|
| 正则表达式 | **有**：环视、反向引用、具名组、占有量词、原子组、旗标、`\p{...}`；`\G`／`\R`／`\X`／POSIX 类别是具名拒绝 |
| JSON | **有**：树状 API、Gson 形状的绑定、串流的 `JsonReader`／`JsonWriter` |
| 地区化 | **有**：`Locale` 带着 47 个 locale 的数字、百分比、货币、日期 pattern、名称、纪元与数字系统（全部读自 OpenJDK 21，`t335_locale_table` 逐行对照）；**唯一的刻意差异**是不输出 bidi 控制字符（U+061C／U+200E／U+200F）。**没有** `Collator`、`BreakIterator`、`ResourceBundle`——那三个是各自的数据集 |
| Base64 | **有**：基本、URL-safe、MIME 三种编码与解码 |
| 日期时间 | **有**：`Instant`、`LocalDate` 家族、`ZoneId`（读主机 tzdata）；**没有** `java.util.Date`／`Calendar`，也没有闰秒 |

## 工具与可观测性

| 能力 | 现况 |
|---|---|
| 测试 | **有**：`teyru test`，见[测试规范](/docs/testing) |
| 日志 | **有**：`java.util.logging` 形状（等级、handler、formatter、JSON 格式） |
| 堆栈追踪 | **没有**。异常只有类名与消息；失败的坐标是方法名，这也是[测试规范](/docs/testing)要求「一个方法一个行为」的原因 |
| 指标、trace、profiler | **没有内建**。`-g` 的 DWARF 让 `perf` 之类的外部工具看得到源代码行 |
| 套件生态 | **有**：`teyru.mod` 与 `teyru get`（见[模块](/docs/modules)）；**没有**一个公开的中央索引站，取用靠 import path |

## 平台

| 目标 | 现况 |
|---|---|
| linux/amd64 | **完整**：整套测试 |
| linux/arm64 | **在 qemu 下有整套的结果**（2026-09-17 量的 250 项，0 不符） |
| windows/amd64 | **交叉编译并在 Wine 下跑**（2026-10-20 量的 318 支，0 不符）；碰 TLS 的程序是具名拒绝（mingw-w64 没有 OpenSSL） |
| darwin/* | **只到「编译并链接」**：这里没有 macOS，**没有任何一行程序在它上面跑过**。这是本页唯一「不知道」而不是「没有」的一格 |
