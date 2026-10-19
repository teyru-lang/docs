---
title: "工具链"
description: "格式化、语言服务器、调试信息与测试运行器——四个让 Teyru 可以日常使用的工具。"
---

编译器本身只有一个可执行文件，工具都在里面：`fmt`、`lsp`、`test` 与 `-g` 不是插件，
是同一个 `teyru` 的子命令。这一页说明每个工具做什么、怎么用，以及它**不做**什么。

## 格式化：`teyru fmt`

```sh
teyru fmt -w src/            # 就地改写
teyru fmt src/Main.teyru     # 输出到 stdout
```

规则固定：两格缩进、一条语句一行、运算符与逗号前后各一个空格、大括号留在声明那一行。
格式化是**幂等**的——`fmt(fmt(x)) == fmt(x)`，整个 `lib/` 与测试程序都在验证这一点。

**注释会保留**：格式化器不是从语法树重新生成代码（那会丢掉注释，因为解析器不保留
trivia），而是遍历词法单元并在原来的偏移重新插入注释。`lib/*.teyru` 的 4,189 条注释在
格式化前后逐字节相同，这是测试的一部分。

格式化不改变行为：同一个程序格式化前后编译出的可执行文件输出相同。

## 语言服务器：`teyru lsp`

```sh
teyru lsp        # stdin/stdout 上的 JSON-RPC 2.0，Content-Length 框架
```

支持的能力：

| 能力 | 说明 |
|---|---|
| `textDocument/publishDiagnostics` | 每次打开与修改都运行完整的词法、语法与语义分析，诊断带 `TY-*` 代码与范围 |
| `textDocument/definition` | 跳到同一个文件里的声明：类型、方法、字段、局部变量、参数、catch 变量 |
| `textDocumentSync` | 全文同步（`Full`）——编辑器每次发送整份内容，没有增量模式 |

解析不到的标识符返回 `null`，不做猜测。服务器只做同文件的定义跳转；跨文件需要模块图，
目前没有。

任何支持 LSP 的编辑器都能接：VS Code 用通用 LSP client 扩展，Neovim 用
`vim.lsp.start({ cmd = { "teyru", "lsp" } })`。

## 调试信息：`-g`

```sh
teyru build -g -O0 -o hello hello.teyru
```

`-g` 让生成的 C 带上 `#line` 指令指回 `.teyru`，并把 `-g` 交给 C 编译器，所以 DWARF 里的
文件与行号就是 Teyru 源代码：

```sh
readelf --debug-dump=decodedline hello | head
# hello.teyru    2    0x4007b0
addr2line -e hello 0x4007b0
# /path/hello.teyru:2
```

变量、字段与方法声明也有 `DW_AT_decl_file` / `DW_AT_decl_line`，所以 `gdb` 的
`break hello.teyru:7`、`info line`、`list` 都停在源代码那一行。

**不加 `-g` 时输出逐字节不变**：指令只在开启时产生，默认构建与以前相同。

LLVM 后端目前不产生调试信息，`--backend llvm -g` 以 `TY-INT-0103` 明确拒绝，
不会安静地忽略。

## 测试：`teyru test`

```sh
teyru test            # 当前目录（递归）
teyru test ./...      # 模块的所有包
```

测试就是普通的方法，加上标注：

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

生命周期照 JUnit 的形状：每个测试一个新实例，`@BeforeEach` → 测试 → `@AfterEach`
（失败也运行）；`@BeforeAll` / `@AfterAll` 可以是静态或实例方法。

可用的断言在 `teyru.test.Assert`：`assertEquals`（`Object`、`int`、`long`、`char`、
`boolean`、`double`）、`assertTrue`、`assertFalse`、`assertNull`、`assertNotNull`、
`assertThrows(Class, Runnable)`、`fail(String)`。失败消息同时写出期望值与实际值。

输出是一行一个测试，最后一行是总结：

```
PASS CalculatorTest.adds
FAIL CalculatorTest.subtracts: expected 3, but was 4
java.lang.AssertionError: expected 3, but was 4
1 passed, 1 failed
```

退出码：`0` 全部通过、`1` 有失败、`2` 编译或诊断错误。包自己的 `main` 不会被调用，
所以测试项目可以同时是一个程序。

方法形状不对（`@Test` 是静态、有参数、私有、没有主体）是 `TY-TYP-0117`；
类不能当测试（嵌套、没有无参构造函数、抽象）是 `TY-TYP-0118`。

## 持续集成

`.github/workflows/ci.yml` 在每次推送到 `main` 与每个 pull request 上运行
`go build ./...`、`go vet ./...` 与整套 `go test ./...`，第二个 job 用 `tests/run.sh`
再跑一次数据驱动的测试。`nightly.yml` 每天以 `CC=gcc` 运行同一套，盯住第二个 C 编译器
那条腿。
