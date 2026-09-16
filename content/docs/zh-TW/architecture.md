---
title: "Teyru 編譯器架構"
description: "從來源檔到原生執行檔的完整流程：詞法、語法、語意分析、程式碼產生（C 或 LLVM IR）、平台層與執行期。"
---

## 流程

```
來源檔 (UTF-8)
   │  internal/source      — 檔案、行號對應、診斷容器
   ▼
Token 串
   │  internal/lexer       — 關鍵字、運算子、字面值、文字區塊
   │                        換行不是 token，只在 token 上標記 NL 旗標
   ▼
AST
   │  internal/parser      — 遞迴下降；游標 + 前瞻 + 選擇點回退
   ▼
已檢查的程式模型
   │  internal/sema        — 符號表、型別、泛型抹除、多載、佈局
   ▼
產生的程式碼
   │  internal/codegen    — C 後端（預設）：類別→struct、vtable／itable、GC 根資訊
   │                        LLVM 後端（--backend=llvm）：程式自己的 LLVM IR
   ▼
原生執行檔
      clang/LLVM 或 gcc + internal/runtime/src（GC、字串、陣列、例外）
                                    └ 平台層 tyrt_plat.h → tyrt_plat_posix.c 或 tyrt_plat_win.c
```

## 換行當敘述終止符

Teyru 沒有分號。詞法分析器不產生 NEWLINE token，而是在每個 token 上記錄
「前面是否有換行」。剖析器用兩件事判斷敘述是否結束：

1. **目前剖析位置的換行是否顯著**（`nl` 堆疊；括號內、引數列表內不顯著）。
2. **前綴是否已完整**。例如 `return` 後面直接換行就是無值 return，
   但運算子、逗號、`.`、`::`、`->` 之後的換行不終止敘述，
   行首是 `.`／`::` 時也視為延續。

`internal/parser/parser.go` 的 `continues()` 是唯一的判斷點。

## 型別與符號

- `ast.Type` 有七種：原生、類別（含型別引數）、陣列、型別變數、萬用字元、null、error。
- 泛型在 `sema.erasure` 抹除；執行期只知道類別，不知道型別引數。
- 多載解析（`pickOverload`）走 JLS 的三個階段（嚴格、允許 boxing、可變參數），
  第一個找得到適用候選的階段就決定，只有同一階段內才比轉換成本（完全相同 0、
  拓寬／上轉 1、boxing 2、unboxing 3；boxing 之後還要上轉時是 3）。
- 方法的 vtable 槽位在 `layout()` 決定：由父類複製，覆寫者沿用同一槽位；
  介面方法另有全域唯一的 selector（`Selector`），供 itable 使用；每個類別的介面表是
  **稀疏**的，只放它自己實作得出來的 selector，依 selector 排序，`ty_itab` 掃過這幾個
  項目再往父類別找。（密集表一格一個指標、格數等於整個程式的 selector 總數，一個類別
  不論實作幾個都要付這筆 `.data`，hello world 就因此背了 792 KB。）

## 產生 C 的關鍵對應

| Teyru | C |
|---|---|
| 類別 `Foo` | `struct C_Foo { tyobj obj; ... }`（欄位依 `InstFields` 平鋪，含繼承） |
| 實例方法 | `M_<class>_<name>_<idx>(C_Foo* this, ...)` |
| 虛擬呼叫 | `this->obj.cls->vtable[slot](...)` |
| 介面呼叫 | `ty_itab(obj, selector)(...)` |
| `new Foo(...)` | GNU 敘述運算式：配置 → 設 `cls` → 呼叫建構子 |
| 陣列 | `tyarr { tyobj; len; data; esize; refs; elemcls }`，元素內嵌 |
| 字串常數 | 靜態 `tystr`（不經 GC） |
| `try`/`catch` | `tycatch` + `setjmp`/`longjmp` |
| property 讀寫 | 降階成 getter／setter 呼叫（`sema.Props` 記錄） |
| `for (a : b : c)` | C 的 `while`：`a` 先跑一次，每圈重測 `b`，`c` 放在圈尾，`continue` 跳到圈尾的標籤 |
| 記錄 `Point(int x,int y)` | struct + 建構子 + `x()`/`y()` + `toString`/`hashCode`/`equals` |
| enum 常數 | 靜態欄位，於 `<clinit>` 建立並填入 ordinal／name |

### 為什麼每個執行檔都帶著前綴（vtable 與 LTO）

C 後端替每個類別寫出一張完整的 vtable，把「沒人呼叫的東西」留給 clang 的 LTO 刪。
這條路走不通，原因值得記下來：**LTO 刪不掉位址被取用的函式**，而 vtable 就是一串
位址（`vt_X[i] = (void*)M_X_i`）。`cls_X` 在每個程式裡都是活著的——`main` 會裝上
`String`、`Object`、陣列、boxed 型別與例外類別——所以 X 宣告的每一個實例方法都留了
下來，每一個又指名它配置的類別，這個閉包最後吞掉大半個標準程式庫：一支只印一個字串
的 hello world 背著 `java.util.stream`，因為 `String.lines()` 就坐在 `String.length()`
旁邊。在 hello world 裡量到的是 **1,262 個函式存活，其中 951 個是前綴的方法，而真正被
呼叫到的只有 42 個**；其餘 1,233 個是靠位址活著的。（`--no-lto` 在各個 commit 上只差
17–54 KB，所以這不是 LTO 的設定變了，是後端寫出來的內容變多了。）

**規則**有兩層：*有呼叫點調度那個索引，槽位才留*，以及*只有可能是那個調度接收者的
類別才需要回答它*。一個類別要能當接收者，就得繼承自那個調度編譯時認定的 owner，而
產生的 C 把 owner 寫在裡面（`((RET(*)(OWNER*, ...))((recv)->obj.cls->vtable[N]))`），
所以第二層是一次 `isSubclass` 的類別記錄走訪；沒有它，一個可達的 `Class.toString` 就會
保住「每個覆寫過這個 selector 的類別」的槽位 7，而那幾乎是整個程式庫。這個改寫只把
`NULL` 寫進槽位的初始值，不重新編號、不縮短表（執行期與類別記錄共用的版面因此不變），
任何還活著的類別永遠保留 0、1、2 三個槽位，介面表不動（程式自己提供的 native 方法可能
用編譯器沒看過的 selector 調度）。

判斷「哪些索引有呼叫點」要掃過產生的 C，而第一次的版本掃錯了：它在函式主體裡遇到行首
單獨一個 `}` 就當函式結束，但 pattern switch 的降階會在函式**內部**、左邊界寫下自己的
收尾大括號，於是主體提早結束、那個大括號之後的每個調度都被算成「沒有定義用到」，
對應的槽位就被填成 `NULL`——`t133_arrow_blocks`、`t84_sealed_switch` 與
`t51_java25_tour` 就是這樣壞的。現在它數大括號的深度，而且認得字串字面值與註解
（產生的 C 會把 JSON 放在字面值裡，所以 `"{}"` 是字串，`/* */` 可以跨行），深度回到
零才是主體結束。

效果（同一台機器、`-O2`）：hello world 501,072 → 95,832（只問呼叫點）→ 55,920（再加上
接收者那一層）；`t84_sealed_switch` 521,456 → 113,904 → 74,888、`t133_arrow_blocks`
509,536 → 105,688 → 61,064、`t51_java25_tour` 523,696 → 438,560 → 253,328，三支的輸出
在每一步都逐位元組不變。**會反射的程式不變**：`t146_reflect` 4,859,976、`t101_gson`
4,823,592，與剪枝前相同，因為反射會從 `main` 抓住每一張成員表。

**底線。** 剪枝後 hello world 的 C 裡有 628 個 vtable 陣列，每一個都還回答槽位 0、1、2，
而只有一個在索引 3 以上有填東西（`Class` 自己的 7、12、13、16）。槽位 0、1、2 不能用
同一條規則收窄：執行期對它沒建立的物件按索引讀它們（`print_uncaught` 與字串輔助函式讀
`[0]`、`ty_obj_hash` 讀 `[1]`、`ty_obj_equal` 讀 `[2]`），所以它們的 owner 是繼承樹的
根；要再窄下去需要「這個類別永遠不會被實例化」這個事實，而產生的 C 不決定它——而且在那
裡答錯是跳到 `NULL`，不是浪費幾個位元組。

## 後端與平台

### 兩個後端

**C 後端是預設**：它替整個程式產生 C，上面那張對應表就是它的規則。`--backend=llvm`
改用 **LLVM 後端**，直接產生**這個程式自己的 LLVM IR 模組**（`internal/codegen/llvm.go`
的 `EmitLLVM`）：執行期仍然是 C，clang 只負責把模組組譯並與執行期連結。模組帶著
目標 triple，也直接呼叫這個平台的 C 函式庫，所以它只對它被寫出來的那個平台是對的
——現在只有 linux/amd64，其他目標以 `TY-INT-0101` 拒絕。

降不下去的建構是 `TY-INT-0100` 診斷，指名那個建構，**不會退回 C 後端**：一個程式
不是用它編得過，就是拿到一個說得出為什麼的診斷。界線是量出來的：`tests/programs`
掃過一輪得到 **76 支逐位元組相同、0 支輸出錯誤、119 支被 emitter 拒絕、0 個模組
clang 不收**（最後一項不為零就讓掃描以非零結束，因為 clang 不收的模組是 bug，不該
混在拒絕裡）。被拒絕的那些按里程碑排序：閉包（lambda 與方法參照、區域類別與匿名
類別）、record／enum／註解被合成出來的成員（建構子、accessor、`equals`／`hashCode`／
`toString`）、型別 pattern 與帶守衛的 switch、內部類別，然後是其餘（`synchronized`、
介面調度、try-with-resources、`Class.forName` 等）。

這是後端的現況，不是「Teyru 不用 C」：執行期是 C，預設後端也是 C。

### 平台層

執行期對作業系統的每一項需求都收在 `internal/runtime/src/tyrt_plat.h` 裡，四十個
`typlat_*` 函式，分成時間與 CPU、mutex、condition variable、執行緒、啟動、socket
與檔案幾組；實作有兩半，`tyrt_plat_posix.c` 與 `tyrt_plat_win.c`。呼叫它們的只有
`tyrt.c`、`tyrt2.c`、`tyrt_thread.c`、`tyrt_net.c` 與 `tyrt_tls.c`（`tyrt_reflect.c`
一個都不用）。
刻意**不**抽象化的東西也寫在標頭檔裡：mingw 的 C 函式庫長得跟 POSIX 一樣，所以
`open`／`read`／`write`／`stat` 這一組由 `tyrt_net.c` 直接呼叫，只有形狀不同的四件事
（開啟旗標、`mkdir` 的參數個數、`mkdtemp`、暫存目錄）放在這一層後面。

TLS 是這一層唯一的例外，而例外本身是一個檔案：`tyrt_tls.c` 寫在 **OpenSSL** 上，只有
程式的可達程式碼碰得到它時才會被編譯並加上 `-lssl -lcrypto`，所以不用 TLS 的程式不會
被連結 OpenSSL；沒有 OpenSSL 的目標（windows 與 macOS）在寫出任何輸出檔之前就被指名
拒絕，而 OpenSSL 的樓地板（1.1）是一個前置處理器的 `#error`。見
[docs/native.md](/docs/native)。

`teyru build --target <os>/<arch>` 決定用哪個編譯器、哪些旗標、編哪一半平台層與輸出
檔名；目標表有五列，每一列背後有多少證據寫在首頁的〈後端與平台〉（[docs/index.md](/docs)）。

## 效能設計

預設後端產生的 C 由 clang/LLVM 以 `-O2` 加 LTO 編譯（`--no-lto` 可關閉；不支援 LTO 的
工具鏈會自動退回），跨函式 inline、常數傳播與迴圈向量化都由 LLVM 負責。在此之上，
編譯器與執行期刻意讓熱路徑保持單一指令層級：

| 機制 | 位置 | 說明 |
|---|---|---|
| 行內配置 | `tyrt.h` 的 `static inline ty_alloc` | 指標碰撞（bump pointer）路徑完全內聯，只有區塊用盡或超過 GC 門檻才呼叫 `ty_alloc_slow` |
| 行內邊界檢查 | `codegen.boundCheck` | 檢查以敘述運算式內聯在取用點，每個索引都產生一次比較（常數索引也一樣，`sema` 不先摺疊，化簡留給 LLVM） |
| 常數折疊 | `codegen.foldBinary`、`ident` | 字面值運算與字串相加在編譯期算完；`static final` 常數是把值替換進去，外層的算式留給 LLVM |
| 死 chunk 回收 | `tyrt.c` 的 sweep | 一個 chunk 內若沒有任何存活物件就整塊 `free` 還給系統，之後的回收不再走它；仍在使用的 chunk 則每個區塊都要走過（計數存活一次、標記或釋放一次），所以單次回收的成本與保留的記憶體量成正比，而不是與存活量成正比 |
| 字串常數 | `codegen.strLit` | 字串字面值是靜態 `tystr`，不經配置、不進 GC |
| 類別初始化 | `codegen.clinitStmt` | 惰性初始化，但旗標由產生的程式碼自己測；繼承鏈上沒有靜態初始化區塊的類別不會有 `<clinit>` 函式（slot 是 `NULL`），`main` 也不會點名它——點名等於在 `main` 裡取它的位址，而一個位址就足以讓連結期最佳化把整個類別連同它的 vtable、介面表與所有方法保留在執行檔裡 |
| 逃逸分析 | `codegen.escape.go` | 不離開所在方法的物件放在 C 堆疊上，LLVM 得以提升欄位並刪除物件 |
| 原生互通 | `codegen.native.go` | `native` 方法的 C 符號與宣告由編譯器產生（`--native-header`） |

逃逸分析（`escape.go`）只提升同時滿足兩個條件的區域物件：宣告型別與 `new` 的類別
完全相同（`sameCreatedClass`），且該類別有編譯器配置好的 struct 與可直接呼叫的
建構子（`promotable`）。判定方式是走訪方法內的每一處使用（`escWalk`）：把物件當接收者
讀原生欄位、讀「不可能裝得下這個物件」的參考欄位、寫入物件自己的欄位（含
`c.next = c`）、`instanceof`、以及呼叫「接收者不會外流」的方法算安全。只要參考本身
被當成值用掉（當引數、`==`／`!=`、轉型、賦值給別的變數）、被存進別的物件或陣列、
被回傳／拋出／`yield`、被 lambda 或方法參考或匿名類別捕獲，或走到分析未涵蓋的節點，
就留在堆積。方法是否會讓接收者外流是對呼叫圖做的傳遞分析（`leaksThis`）：native
方法假設不會，沒有主體的方法假設會，分析中遇到環路也視為會。被提升的物件本身不在
chunk 裡（`valid_obj` 會拒絕它的位址），但它的參考欄位就在 C 堆疊上，保守的原生堆疊
掃描因此仍看得到它指向的堆積物件。

已知的效能邊界：逃逸分析只涵蓋留在方法內的物件；真正上堆積的物件仍走保守式
標記清除（無分代假設），在「物件長期存活、反覆回收」的負載上 HotSpot 仍可能
勝出。目前的五項 benchmark 都快於 JVM；重現方式見 `sh scripts/bench.sh`。

## 垃圾回收

- **保守式標記清除**。物件不搬移，所以 C 端的暫存指標永遠有效。
- 根：shadow stack（`ty_roots`／`ty_sp`）、以 `ty_gc_register_static` 註冊的靜態欄位
  位址表、以及**原生堆疊的保守掃描**（起點為當前堆疊指標，終點為執行緒堆疊頂端，
  由 `pthread_getattr_np` 取得）。堆疊上的字不保證是物件，所以每個候選位址都要通過
  `valid_obj`：必須 16 位元組對齊、必須是某個 chunk 裡某個區塊的開頭（`starts`
  位元圖每次回收前重建，落在區塊內部的位址一律不算），而且不能是已釋放的區塊。
  落在 slab 涵蓋的位址範圍之外的字，在走 slab **之前**就被拒絕：不在那個範圍裡的字
  不可能在任一 slab 裡，所以那次走訪本來也會回答 0。這是純粹的過濾，只會少做事，
  不會改變任何答案。
- 標記：`tyclass.refoffs` 列出每個類別需要追蹤的參考欄位位移；陣列用 `refs` 旗標。
- **執行緒**：執行期為每條執行緒留一筆註冊資料（`internal/runtime/src/tyrt_thread.c`），
  回收開始前先停住每一條，再掃各自的堆疊，所以停止是**世界性**的。協定是**合作式**的：
  安全點在迴圈回邊、配置慢路徑、等 heap 鎖、sleep／join／監視器等待，以及執行緒啟動；
  一條既不迴圈、不配置也不阻塞的執行緒（卡在原生 `read()` 裡的那種）到不了停止點，
  回收就得等它回來。
- 清除：未標記的區塊進入大小分級的 free list（`TY_NCLASS` 級，過大的走 `bigfree`），
  下一次配置優先重用；區塊大小字（header 第一個字）的最高位 `TY_FREE_BIT` 表示已釋放，
  free list 的鏈結就放在第二個字。完全空掉的 chunk 直接 `free` 還給系統，所以長時間
  執行的程式不會一直佔住尖峰記憶體，但**頭 chunk 例外**：它承載 bump 指標，永遠保留。
- 觸發：配置量超過 `ty_gc_threshold` 這一個條件。門檻初始 4 MB，每次回收後設為存活量
  的兩倍，最低不低於 4 MB。chunk 用完**不是**回收的理由——free list 沒有可用的區塊時
  就直接長一個新 chunk，因為門檻還沒到就回收只是白白重掃一次活著的物件。
- **從 free list 拿下來的區塊，在交出去之前就是一個根。** 這一條是修來的，值得寫下來，
  因為它壞的方式看不出來：`ty_heap_unlock` 是唯一「先解開 heap mutex、才把執行緒從停止
  狀態拿掉」的地方，所以從 free list 取下一塊到交給呼叫者之間，那條執行緒**仍然算在
  `n_stopped` 裡**。在那個窗口開始的回收不會等它——它走過那塊 slab、讀到區塊說自己是
  空的（也沒有任何東西指向它），於是當成可用空間：把區塊接回 free list，或把整塊 slab
  還給系統；接著那條執行緒醒來，往同一段記憶體寫、再把它交出去。同一塊記憶體發出去兩次，
  或寫進已經還給系統的記憶體。四條執行緒的配置壓力測試（各 30 萬次配置）在修好前 400 次
  跑出 63 次崩潰，每一次都在 free list 這條路、而且都在同一次回收剛釋放的 256 KB slab
  裡；修好後是 0 次。
  修法用的是這個檔案自己的慣例：在放掉鎖**之前**就把區塊放上該執行緒的 shadow stack，
  物件存在之後才移除，所以回收器一定看得到它。**回收器一個字都沒改**，也不需要改；但
  順序有意義——標記不是結束，被標記的物件會被**追蹤**，而剛從 free list 拿下來的區塊還
  留著前一個租戶的位元組，所以先把大小字與標記字寫好、把類別字寫成 0（追蹤它就變成
  no-op）才上根，其餘的位元組等放掉鎖之後再清（否則多 MB 的陣列會在 heap 鎖裡被清）。
  需要這樣做的只有兩處：free list 交出的區塊與剛拿到的 slab 的第一塊；bump 路徑交出的
  區塊在回收器會走訪的水位之上，任何回收都看不到它，所以那裡**不能**加。
- 已知代價：每次回收都要掃描整個使用中的堆疊，且沒有分代假設；清除階段還要走過每個
  保留 chunk 的每個區塊。

## 例外

`ty_cur_catch` 是一條 handler 鏈。`throw` 呼叫 `ty_throw`，後者 `longjmp` 到最近的
handler；沒有 handler 時印出訊息並以狀態 1 結束。

`finally` 有兩條路徑，缺一不可：

1. **例外路徑**：`try` 外層包一個 handler，`setjmp` 回來後先跑 `finally`，
   再把例外重拋。catch 區塊內再拋出時也走同一條路。
2. **正常離開路徑**：`return`、`break`、`continue` 不會經過 `longjmp`，
   所以程式碼產生器維護一個 finally 堆疊（`Emitter.finallys`），在每個
   跳躍敘述前先跑完被離開的 `finally`（由內而外），最後才跳。
   `try`-with-resources 的 `close()` 是同一個機制的隱含 `finally`，
   因此資源在 return 與例外兩條路徑上都會關閉。

區域與匿名類別捕獲的區域變數會變成合成類別的欄位（`Class.CapFields`），
由建構子或 closure 建立運算式填入；這讓「方法參考的接收者」也只在建立時求值一次。
