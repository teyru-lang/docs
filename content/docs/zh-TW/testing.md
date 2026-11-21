---
title: "測試規範"
description: "怎麼寫 Teyru 測試：命名、結構、斷言、決定性，以及 runner 補上的逾時、輸出隔離與選取。"
---

這一頁是**寫測試的規範**，不是 API 清單；runner 的旗標與斷言的完整清單在
〈工具鏈〉。兩頁合起來回答一個問題：一個測試要怎麼寫，失敗訊息才足以讓人不必重跑。

`teyru test` 沒有堆疊追蹤，失敗座標就只有 `Class.method`；runner 也刻意讓每個測試
各自獨立——新的實例、捕捉起來的 stdout。規範的大部分規則都是這兩件事逼出來的。

## 命名與位置

1. 檔名與類別用 `<Subject>Test`，放在受測程式**同一個目錄**（同一個套件）。runner 以
   目錄為單位編譯，同一個目錄的程式與測試一起看得到。

2. 方法名是**行為句子**：`addsTwoNumbers`、`throwsWhenDivisorIsZero`、
   `roundsHalfUpAtExactHalf`。不要 `testAdd`——沒有堆疊追蹤時，方法名就是唯一的位置。

3. **一個 `@Test` 只驗一個行為**。失敗輸出只有 `Class.method`，方法名就是座標；一個
   方法驗三件事，紅燈只會說「這個方法壞了」，不會說哪一件。

4. `@Test` 必須是 `public void`、無參數、非 `static`、非 `private`，而且有主體；類別必須
   是 top-level、非抽象、有無參數建構子。違反是 `TY-TYP-0117`／`TY-TYP-0118`。

## 結構

5. Arrange／Act／Assert 三段，中間空一行；**只有一個 Act**。兩個 Act 就是兩個測試。

6. 每個測試一個新實例。可變狀態放欄位、在 `@BeforeEach` 初始化；測試之間不共用 static
   狀態。

7. `@BeforeAll`／`@AfterAll` 只放**不可失敗**的準備。它失敗時整個類別記一條失敗，其餘
   測試不會執行。

8. `@AfterEach` 不得依賴前面的步驟成功；失敗時 runner 也保證會呼叫它。

## 斷言

9. **expected 在前、actual 在後**，一律。讀失敗訊息的人先看到的是期望值。

10. 值比較用 `assertEquals`；不要 `assertTrue(a == b)`——訊息會失去兩邊的值。

11. 浮點用 delta 形式：`Assert.assertEquals(expected, actual, 1e-9)`。沒有 delta 的
    `assertEquals(double, double)` 是精確比較（`Double.compare`），只用在要釘住位元的情形
    （NaN、`-0.0`）。

12. 陣列用 `assertArrayEquals`；不要 `assertEquals(int[], int[])`——它會走 `Object` 多載，
    比的是參考，訊息印的是兩個位址。

13. 例外：`Throwable t = Assert.assertThrows(X.class, action)`，再對 `t.getMessage()` 做
    精確斷言。只驗類別不算驗證；訊息是使用者會看到的東西。

14. 不要在斷言兩邊放不同型別。`assertEquals("1", 1)` 走 `Object` 多載，訊息會同時標出
    兩個型別，但那個測試從一開始就寫錯了。

15. 需要上下文時用 message 多載：`Assert.assertEquals(expected, actual, "row 7")`。
    table-driven 的測試**一定**要帶 message，否則紅燈不知道是哪一列。

16. 多個獨立性質要一次驗完時用 `Assert.assertAll(...)`；它會把每一個失敗都列出來，而
    不是停在第一個。

## 決定性

17. 禁止 `Thread.sleep` 當同步；用 latch、condition 或 `CountDownLatch`。真的需要等待就
    等條件，不要等時間。

18. 禁止依賴 wall clock、時區、locale、主機檔案或環境變數；需要就注入。

19. 禁止未定種子的隨機；種子寫死，失敗訊息印出種子。

20. 網路測試自己起對端、自己關掉；不連外。

21. 測試不得呼叫 `System.exit`。

## 輸出與 CI

22. 測試 body 的 stdout 會被 runner **捕捉**，只在失敗（或 `-v`）時印出，所以「印出來
    除錯」不會弄壞報告，但也不該靠它。要斷言輸出，把行為改成回傳值。

23. `teyru test` 找不到任何測試時是 **exit 2**；`-no-tests-ok` 才是接受空集合。CI 不要
    用後者蓋掉打錯的路徑。

24. CI 用 `timeout 600 teyru test ./...` 包住，並檢查輸出的總結行。exit 2 是編譯錯誤、
    1 是測試失敗、0 才是全過。

25. 有測試卡死時用 `-timeout`：預設每個測試 60 秒，`-timeout 0` 關掉；`-deadline` 是整
    個目錄的上限。逾時的 FAIL 行會指名卡住的那個測試。

## 沒有的東西（具名，不是忘了）

- **參數化測試**（`@ParameterizedTest`／`@ValueSource`）：一個 `@Test` 仍然只能有一個
  行為、一組輸入。多組輸入寫成迴圈，並用 message 多載指名是哪一列
  （`Assert.assertEquals(expected, actual, "case " + i)`）——這正是 message 多載存在的理由。
- **`@Nested`**：巢狀測試類別需要外圍實例才能建構，runner 對它以 `TY-TYP-0118` 拒絕。
- **測試之間共用 static 狀態的 fixture**（`@BeforeAll` 之外的 once-per-suite 物件）：
  每個測試類別各自建構，不跨類別共用。

## 分層

26. `tests/test-framework/` 只放 runner 契約（生命週期、斷言、輸出、exit code）；
    語言／標準庫語意放 `tests/programs/` 的 golden；Java 語意改動放 `tests/java-compat/`
    的 JDK 差分。三者不互相取代。

## 選取與跳過

```sh
teyru test -run CalculatorTest.adds   # 正規表達式比對 Class.method（也接受只有方法名）
teyru test -tag slow                  # 只跑 @Tag("slow") 的測試
teyru test -run rounds -v             # 連通過的測試的捕捉輸出一起印
```

`@Disabled("reason")` 讓一個測試不跑但留下 `SKIP Class.method: reason`；類別上的
`@Disabled` 是整個類別。跳過的測試不算通過，也不算失敗，總結會多一個 `N skipped`。

## 不要做的事

- 不引入 mock 框架；手寫 fake（介面 + 假實作）。
- 不測 private 成員。同套件的 package-private 可以測，但優先測 public 行為。
- 不從 production 程式引用測試類別。

## 與其他語言的對照

- 骨架照 **JUnit 5**：`@Test`／`@BeforeEach`、`Assert.assertEquals(expected, actual)`、
  每個測試新實例。拿掉的是反射發現與 `@Nested`（這個語言明確拒絕）。
- 紀律照 **Go `testing`**：table-driven、`-run`、`-timeout`、每個測試捕捉 stdout、失敗
  才印。拿掉的是「沒有斷言庫」的極簡主義——`Assert` 留著。
- 失敗語意照 **Rust 的 `should_panic(expected = ...)`**：`assertThrows` 搭配精確的
  `getMessage()`，只驗類別不算驗證。
