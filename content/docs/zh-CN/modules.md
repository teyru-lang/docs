---
title: "Teyru 的模块系统"
description: "模块路径、导入路径与 teyru.mod：获取与校验遵循 Go 的做法。"
---

模块是「一组一起做版本控制、一起获取的包」，它的身份是**模块路径**（例如
`example.com/app`）。导入路径是模块路径加上包在模块里的位置：

```
example.com/app               模块（形如 github.com/x/y 的仓库地址）
example.com/app/util          模块里的 util 包
example.com/greeting/text     被依赖模块里的 text 包
```

模块系统由 `internal/mod` 实现，构建侧接在 `internal/driver`，命令行在
`cmd/teyru`。

---

## teyru.mod

它放在模块根目录，是「这个目录是一个模块」的标志。构建会从被编译的路径向上
查找，找到的第一个 `teyru.mod` 就是这个构建所属的模块。

```
module example.com/app

teyru 1

require (
	example.com/greeting v0.1.0
)
```

| 指令 | 含义 |
|---|---|
| `module <路径>` | 模块路径，必写、只能写一次。这个模块所有包的导入路径都以它开头。 |
| `teyru <n>` | 语言版本。模块说明自己是为哪一代语言写的，将来的编译器才有依据拒绝它必须重新解释的模块。 |
| `require <路径> <版本>` | 依赖。可以写成单行，也可以写成 `require ( ... )` 块；`teyru mod tidy` 一律整理成块。 |

`//` 之后是注释。**无法识别的指令是错误**：`exclude`、`replace`、`go` 这些
Go 的指令都在拒绝之列。静默忽略它会让 `teyru mod tidy` 把这个文件改写成含义
不同的文件。

### 版本

`vMAJOR.MINOR.PATCH`，可以加 prerelease（`v2.0.0-rc1`）。版本同时是 git tag 与
缓存里的目录名，所以**只认一种写法**：`1.2.3`、`v1.2`、`v01.2.3`、
`v1.2.3+build` 全部拒绝——它们都能指向同一个 tag，接受就等于同一个版本有两
个名字。

从 v2 起，主版本号属于导入路径（`example.com/dep/v2`）。路径与版本必须互相
匹配：`example.com/dep/v2@v1.0.0` 是把 v1 的源码放进要求 v2 的程序里，两个
方向都拒绝。

### 规范格式

`teyru mod tidy` 写出来的一定是规范格式，而且再跑一次不会产生差异：

```
module example.com/app

teyru 1

require (
	example.com/greeting v0.1.0
	example.com/other    v1.2.3
)
```

`module` 在最前面，空行，`teyru`，空行，require 块：路径排序、版本对齐成
一列。单行的 `require x v1.0.0` 也会展开成块，因为下一次 `teyru get` 就会
再加一行，而那就是这个文件接下来的样子。注释留在作者放置的位置，例外是挂在
`require` 指令本身（`require` 那一行与它上面那一行）的注释：它们会被丢掉。

---

## 导入

两种写法都可以，指的是同一个包：

```
import example.com/greeting/text   // 模块的写法
import example.com.greeting.text   // 点的写法
```

解析器沿用的是 Java 的导入语法，只是路径段接受 `/` 与 `-`，所以
`example.com/greeting/my-util` 是一个合法路径，会被规范化为包名
`example.com.greeting.my-util`。因此诊断算出来的行列位置指着磁盘上真正的
字符，不必先改写源码再解析。

`import static example.com/dep/pkg.Widget.icon` 导入类型的单个静态成员（`Widget.*`
导入它全部；static 导入只写到类型本身是 `TY-TYP-0086`，因为它要的是成员名）。
`import example.com/dep/pkg.Widget` 导入那个类型，没有后缀的
`import example.com/dep/pkg` 导入整个包。

导入路径也可以写**包声明的名字**：`package todo` 的目录，身份是
`example.com/app/todo`，而 `import todo.Store` 与 `import todo.*` 都能找到它——
名字是作者写的那个，身份是构建给的那个，两个都查。两个 `import p.*` 都提供
同一个简单名称时（`p` 写的是身份或声明的名字都算），在使用处报告 `TY-TYP-0099`，
不会按加载顺序挑一个。

### 包的身份是导入路径

构建会把每个文件的 `ast.File.Package` 改写成它所属包的**导入路径**。声明的
包名只是名字，两个模块都可以声明 `package util` 而不冲突——把它们分开的是
导入路径，而 C 符号再由 `util.Mangle` 把 `/`、`.` 换成 `_`。

同一个目录只能声明一个包，否则报告 `TY-IO-0104`：静默合并两个包会编译出一个
导入从未要求的程序。

### 依赖的加载

- 解析采用**最长前缀**：模块路径 `example.com/a` 是 `example.com/a` 与
  `example.com/a/pkg` 的前缀，而导入指的是比较明确的那个。
- 包是「在模块里最长的一段、而且是磁盘上真的有 `.teyru` 的目录」；后面剩下
  的是类型或成员的名字。所以 `example.com.dep` 与 `example.com.dep.Widget` 都
  停在模块根目录。
- 一个目录就是一个包，**不递归**：依赖模块的 `cmd/` 底下还有第二个入口点，
  顺手拉进来就会编译出导入没有要求的程序。
- 加载是**延迟**的：`require` 了但缓存没有的模块，在真的有源码导入它之前
  都不算错。模块文件列出的是作者可能需要的东西，构建不该为一行没人用的声明
  失败。

---

## 模块缓存

```
$TEYRUPATH/pkg/mod/example.com/greeting@v0.1.0/
```

`TEYRUPATH` 默认 `~/.teyru`。获取是对模块路径做一次浅克隆：

```
git clone --depth 1 --branch <版本> https://<模块路径> <临时目录>
```

clone 完会删掉 `.git`（模块的哈希算的是源码，不是历史），再把整个目录**改名**
移入缓存：缓存条目要么完整出现、要么不存在，读取缓存的构建不会看到半个模块。

`TEYRU_GIT_URL` 会替换 `https://` 这段前缀，给镜像、`file://` 路径或本机服务器
用；Teyru 不做 vanity URL 查询（Go 的 `?go-get=1`），所以自定义域名的模块就是
用它指定来源。

已经在缓存里的版本**不会再获取**：模块的某个版本是不变的，第二次获取只可能
得到一份不一样的副本，而每次构建重新校验的 checksum 就是证明第一次是对的。

`mod.LocalFetcher` 是同一件事的无网络版本：从 `<root>/<模块>@<版本>/` 复制。
测试会用它，`tests/modules/fixtures` 就是这种镜像。

---

## teyru.sum

每一行记一个已经获取下来的模块版本：

```
example.com/greeting v0.1.0 h1:Q5zOZ...
example.com/greeting v0.1.0/teyru.mod h1:ujwgc...
```

哈希跟 Go 一样是 `dirhash.Hash1`：把每个文件算成 `sha256(内容)  <相对路径>\n`
这一行，按路径排序拼接起来再取一次 sha256，base64 之后加上 `h1:`。以点开头的
目录（fetch 留下的 `.git`）与符号链接都不算——前者不是模块的一部分，后者会
让一个模块把磁盘上任何东西包进来。

第二种行记录的是依赖模块**自己的 `teyru.mod`**：那个文件的内容决定构建列表里
还有哪些模块，改它一行就能改变整个构建，却不动任何源码。它不强制要有——树
哈希本来就涵盖了那个文件的字节。

校验的时机是**用到包的时候**，不是列出依赖的时候。所以：

| 情况 | 结果 |
|---|---|
| 缓存有、`teyru.sum` 有、两者一致 | 构建 |
| 缓存没有 | `TY-IO-0102`，消息里有 `teyru get <模块>@<版本>` |
| 缓存有、`teyru.sum` 没有这一行 | `TY-IO-0102`，要求先 `teyru get` |
| 缓存有、哈希不一样 | `TY-IO-0103`，**停止构建** |

最后一种是整个模块系统里唯一在讲安全性问题的错误：同一个版本、不同的内容。
构建不会把「不是模块文件当初写的那一份」的东西编译进去。

---

## 命令

```sh
teyru mod init example.com/myapp   # 在当前目录写一个 teyru.mod
teyru get example.com/dep@v1.0.0   # 抓进缓存、记 checksum、写进 require
teyru mod tidy                     # 让 teyru.mod 与 teyru.sum 跟源码一致
teyru build [paths...]             # 编译成原生可执行文件（默认 a.out）
teyru run   [paths...] [-- args]   # 编译并运行
```

`teyru mod tidy` 做三件事，而且**永远不联网**：

- 移除没有任何源码导入的 require；
- 有源码导入、而缓存能够提供的模块，用缓存里最高的版本添加进去；
- `teyru.sum` 只保留构建列表需要的东西，留下的每个模块都重新校验一次哈希。

它**不会**主动提升已经记下的版本：那是一个有后果的决定，从源码看不出来，所以只
报告（`kept the requirement ...`）。缓存无法提供的模块也只报告，并保留它的
checksum 行——重新计算不了，删掉只会把缺失的那次获取掩盖起来。

路径的写法：

| 写法 | 含义 |
|---|---|
| `<目录>` | 以该目录为根的整棵包树（递归） |
| `./...` | 同上；`...` 单独写不算路径 |
| 不写 | 当前目录所属的模块；不在模块里时就是当前目录 |

目录里有 `teyru.mod` 就是另一个模块，遍历到它时会停下来：它的包在它自己成为
构建对象时才编译。不写路径的 `teyru build` 在模块里就是编译这个模块。

---

## 诊断码

| 代码 | 时机 |
|---|---|
| `TY-IO-0101` | 读不到 `teyru.mod` 或它不是模块文件（解析错误、版本不合法、无法识别的指令……）。 |
| `TY-IO-0102` | 导入找不到能提供它的模块、缓存里没有那个版本、`teyru.sum` 没有那笔记录，或者包目录读不到。 |
| `TY-IO-0103` | checksum 不匹配。缓存的内容不是 `teyru.mod` 当初写的那一份。 |
| `TY-IO-0104` | 同一个目录里声明了两个不同的包名。 |

这四个代码在 `docs/diagnostics.md` 也各有一列，写着消息与修复方法。

---

## 与 Go 不同的地方

有意的取舍，而不是尚未实现：

- **没有 proxy、没有 vanity URL 查询**。模块路径就是仓库网址，获取到的就是作者
  推送上去的东西。要镜像就用 `TEYRU_GIT_URL`。
- **`replace`、`exclude`、`retract`、`vendor` 都没有**，出现就是解析错误。
- **版本选择是「要求最高者胜出」**，不是完整的 MVS：构建列表只由能看到的
  `teyru.mod` 决定。已经被编译过包的模块被别的依赖要求更高的版本时，
  报告 `versionConflict` 而不是静默替换——一个构建不能同时有两个版本的模块。
- **构建不联网**。缓存没有的东西要自己 `teyru get`。
- **主模块自己的包也有导入路径身份**，跟依赖一视同仁。

## 已知限制

- 没有 `teyru mod why`、`teyru list`、`teyru get` 的升级语法。
