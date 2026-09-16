---
title: "Teyru diagnostics at a glance"
description: "The stable code format TY-<stage>-<four digits> of every diagnostic, and the representative messages for each stage."
---

Every diagnostic has a stable code, with the format `TY-<stage>-<four digits>`. Stage prefixes:

| Prefix | Stage | Representative |
|---|---|---|
| `TY-SYN` | Lexing and parsing | Semicolons, parentheses, line breaks, literals |
| `TY-TYP` | Semantic analysis (names, types, members) | Symbol not found, type mismatch, overloading |
| `TY-PROP` | Native property rules | Accessor conflicts, storage requirements |
| `TY-INT` | Compiler internals / prelude library | Corrupt prelude, unsupported nodes |
| `TY-IO` | File access | Source file cannot be read |

The output format is `file:line:column: error[code]: message`, for example:

```
hello.teyru:4:11: error[TY-TYP-0051]: incompatible types: String cannot be converted to int
```

`TY-SYN-0001`, `0002`, `0004`–`0011` are produced by the lexer (`TY-SYN-0003` is the exception: it is
emitted by the parser at the end of a statement and at a `throw` line break), and everything from
`TY-SYN-0100` onwards is produced by the parser too.

---

## TY-SYN: lexing and parsing

| Code | Message | Explanation and fix |
|---|---|---|
| TY-SYN-0001 | `';' is not Teyru syntax; end statements with a newline` | Teyru has no semicolons. Delete the semicolon and let the statement end with a newline; in a `for` header, separate the parts with a colon instead. |
| TY-SYN-0002 | `unexpected character %q` | A character that belongs to no token appeared (usually a full-width punctuation mark or a pasted control character). |
| TY-SYN-0003 | `expected end of line, found %s`／`throw expression must start on the same line` | There are leftover tokens after the statement; or the `throw` expression is cut off by a line break. Write the expression on the same line, or start it with `(` so that it spans lines. A `yield` that needs a value does not get this message: after a line break it is treated as an identifier, and you get `cannot find symbol yield`. |
| TY-SYN-0004 | `unterminated block comment` | A `/*` with no matching `*/`. |
| TY-SYN-0005 | `invalid unicode escape` | `\uXXXX` is not four hexadecimal digits. |
| TY-SYN-0006 | `unterminated string literal`／`unterminated text block` | The string is not closed before the line break, or the text block is missing its closing `"""`. |
| TY-SYN-0007 | `text block must start with a line break after """` | A line break must follow `"""` immediately. |
| TY-SYN-0008 | `unterminated character literal`／`character literal does not fit in a char` | The character literal is not terminated, or it exceeds U+FFFF. |
| TY-SYN-0009 | `malformed integer literal`／`malformed floating-point literal` | Malformed number (for example no digits after `0x`, or `1e` with no exponent). |
| TY-SYN-0010 | `integer literal out of range` | The integer literal exceeds the number of bits that can be represented: decimal `int` is limited to 2^31-1 and `long` to 2^63-1, non-decimal `int` to `0xFFFFFFFF` and `long` to `0xFFFFFFFFFFFFFFFF` (boundary values wrap round to negative). For a larger value, add the `L` suffix. |
| TY-SYN-0011 | `invalid escape sequence \%c` | The string or character literal contains an escape sequence Teyru does not recognise (for example `\q`). The valid ones are `\n` `\t` `\r` `\b` `\f` `\s` `\0` `\\` `\'` `\"`, octal `\nnn` and `\uXXXX`. |
| TY-SYN-0100 | `expected '%s', found %s` | A token that was expected is missing (`)`, `]`, `{`, `}`, `:` and so on). |
| TY-SYN-0101 | `expected identifier, found %s` | Something else sits where an identifier is required; common when a keyword is used as a name. |
| TY-SYN-0102 | `unexpected %s at top level` | The top level of a file allows only package/import/type declarations, or members written directly (the implicit class form). |
| TY-SYN-0103 | `unexpected %s in class body` | The class member declaration is incomplete. |
| TY-SYN-0104 | `expected ',' ':' or '}' after enum constants` | The enum constant section and the member section must be separated by a single `:`. |
| TY-SYN-0105 | `expected 'get' or 'set' accessor, found %s` | Only `get` and `set` may appear in an accessor block. |
| TY-SYN-0106 | `unexpected %s` | A statement that cannot be parsed appears in the block. |
| TY-SYN-0107 | `try resources must be separated by line breaks` | Separate each try-with-resources resource with a line break, not a semicolon. |
| TY-SYN-0108 | `try requires catch or finally` | A `try` needs at least one `catch` or `finally`. |
| TY-SYN-0109 | `expected 'case' or 'default', found %s` | Only `case`/`default` may appear in a switch block. |
| TY-SYN-0110 | `cannot mix '->' and ':' case labels` | A single switch may use only one form of label. |
| TY-SYN-0111 | `expected expression, found %s` | Another token sits where an expression is required. |
| TY-SYN-0112 | `array dimension expression after empty dimension` | `[5]` cannot be written after `new int[3][]`. |
| TY-SYN-0113 | `array creation with both dimensions and initializer` | `new int[3]{1,2,3}` is not legal; give either a size or initial values. |

## TY-TYP: types and symbols

### Declarations and members (0001–0025)

| Code | Message | Explanation and fix |
|---|---|---|
| TY-TYP-0001 | `duplicate type %s (also declared at %s)`／`duplicate nested type %s` | A type with the same name is declared twice. |
| TY-TYP-0002 | `type variable %s cannot have type arguments` | A type variable cannot itself carry type arguments. |
| TY-TYP-0003 | `cannot find type %s` | The type name cannot be found; check the spelling, the import or the prelude. |
| TY-TYP-0004 | `type %s expects %d type arguments, found %d` | The number of generic arguments does not match. |
| TY-TYP-0005 | `primitive type %s cannot be a type argument; use its box type` | Generics cannot use a primitive type; use the wrapper class. |
| TY-TYP-0006 | `class cannot extend interface %s` | A class uses `implements` for an interface. |
| TY-TYP-0007 | `cannot extend final class %s` | A class marked `final` cannot be extended. When `final` is applied by `@Value`/`@UtilityClass`, this is reported only after annotation expansion (the “block inheritance” check used to run before expansion, so those two annotations had no effect). |
| TY-TYP-0008 | `cyclic inheritance involving %s` | The inheritance relationship forms a cycle. |
| TY-TYP-0009 | `%s is not an interface` | Only an interface may follow `implements`. |
| TY-TYP-0010 | `duplicate field %s in %s` | A field is declared twice in the same class. |
| TY-TYP-0011 | `duplicate method %s in %s`／`duplicate constructor %s` | A method or constructor with the same signature after parameter erasure is declared twice. |
| TY-TYP-0012 | `varargs parameter must be last` | `...` may only go on the last parameter. |
| TY-TYP-0013 | `interface method with a body must be default, static or private` | An interface method with a body must be marked `default`/`static`/`private`. |
| TY-TYP-0014 | `method %s needs a body` | A non-abstract method needs a body. |
| TY-TYP-0015 | `abstract or native method %s cannot have a body` | An `abstract`/`native` method cannot have a body. |
| TY-TYP-0016 | `abstract method %s in non-abstract class %s` | A class with abstract methods must be marked `abstract`. |
| TY-TYP-0017 | (removed) | A `native` method can now be declared in any class and implemented in C supplied through `--native`. |
| TY-TYP-0018 | `'%s' is only allowed for local variables; fields need an explicit type` | `var`/`val` cannot be used for a field, a parameter or a return type. |
| TY-TYP-0019 | `%s must implement %s from %s` | A concrete class does not implement an abstract method of an interface or superclass. |
| TY-TYP-0020 | `missing return statement` | A method with a return value has paths that lack a `return`. |
| TY-TYP-0021 | `duplicate local variable %s` | A local variable is declared twice in the same scope. |
| TY-TYP-0022 | `break outside of loop or switch` | `break` may only appear inside a loop or switch (the labelled form is the exception). |
| TY-TYP-0023 | `continue outside of loop` | `continue` may only appear inside a loop. |
| TY-TYP-0024 | `thrown value must be a Throwable, found %s` | The object thrown by `throw` must extend `Throwable`. |
| TY-TYP-0025 | `cannot synchronize on void` | The lock of a `synchronized` cannot be a void expression. |

### Statements (0026–0044)

| Code | Message | Explanation and fix |
|---|---|---|
| TY-TYP-0026 | `local variables cannot be declared final; use 'val'` | Use `val` for a local variable that cannot be rebound. |
| TY-TYP-0027 | `'%s' requires an initializer` | `var`/`val` must have an initial value. |
| TY-TYP-0028 | `'%s' cannot infer a type from null` | A type cannot be inferred from `null`; write the type out explicitly. |
| TY-TYP-0029 | `'%s' cannot infer a functional interface type; declare it explicitly` | A lambda needs a target type; declare the interface type explicitly. |
| TY-TYP-0030 | `for-each requires an array or Iterable, found %s` | The enhanced `for` only works on an array or an `Iterable`. |
| TY-TYP-0031 | `incompatible types: %s is not assignable to %s` | The loop variable type does not match the element type. |
| TY-TYP-0032 | `return value required for %s` | A method with a return value cannot `return` empty-handed. |
| TY-TYP-0033 | `cannot return a value from a void method` | A void method cannot return a value. |
| TY-TYP-0034 | `catch type must be a Throwable, found %s` | The `catch` type must be from the `Throwable` family. |
| TY-TYP-0035 | `switch selector must be a char, byte, short, int, Character, Byte, Short, Integer, String or enum type, found %s` | The selector type of the switch is not legal. |
| TY-TYP-0036 | `duplicate default label` | A single switch may have only one `default`. |
| TY-TYP-0037 | `incompatible pattern type %s for switch on %s` | `case <type> <name>` is unrelated to the selector type. |
| TY-TYP-0038 | `case label must be a constant expression` | A case label must be a compile-time constant. |
| TY-TYP-0039 | `duplicate case label` | A label is duplicated within the same switch. |
| TY-TYP-0040 | `array required, found %s` | `[]` is used on something that is not an array. |
| TY-TYP-0041 | `inconvertible types: %s cannot be cast to %s` | This cast can never succeed. |
| TY-TYP-0042 | `incompatible pattern type %s for %s` | The type of the `instanceof` pattern is unrelated to the left-hand side. |
| TY-TYP-0043 | `not an enclosing class: %s` | The enclosing class of `Outer.this` does not exist. |
| TY-TYP-0044 | `no superclass` | `super` is used although there is no superclass. |

### Names and access (0045–0048)

| Code | Message | Explanation and fix |
|---|---|---|
| TY-TYP-0045 | `cannot access instance field %s from a static context` | An instance field cannot be read directly inside a static method. |
| TY-TYP-0046 | `%s has private access in %s` | A private member can only be accessed inside its own class. For a property, what counts is the **modifier of the accessor** (the underlying storage is always private, so the modifiers of the storage field cannot be used to decide); `x.p = v` looks at the setter, while `p.x` and `p.x += 1` look at the getter. Access is mutual within the same nest (the same top-level class). |
| TY-TYP-0048 | `cannot find symbol %s` | The name cannot be found: check the spelling, the scope, the import, or whether you forgot to declare it. |

### Conversions and operators (0049–0067)

| Code | Message | Explanation and fix |
|---|---|---|
| TY-TYP-0049 | `null is not assignable to %s` | `null` cannot be given to a primitive type. |
| TY-TYP-0050 | `possible lossy conversion from %s to %s` | A narrowing conversion is needed; add a cast. |
| TY-TYP-0051 | `incompatible types: %s cannot be converted to %s` | The most common type error: the types of an assignment, an argument or a return are incompatible. |
| TY-TYP-0052 | `operator '!' cannot be applied to %s` | `!` only works on `boolean`. |
| TY-TYP-0053 | `operator '~' requires an integral operand` | `~` only works on integers. |
| TY-TYP-0054 | `operator '%s' requires a numeric operand` | Unary `+`/`-` only works on numeric values. |
| TY-TYP-0055 | `operator '%s' requires a numeric operand` | `++`/`--` only works on numeric values. |
| TY-TYP-0056 | `cannot apply '%s' to a non-assignable expression` | The target of `++`/`--` must be assignable. |
| TY-TYP-0057 | `cannot assign a value to final variable %s` | A `val` or `final` variable cannot be assigned again. |
| TY-TYP-0058 | `cannot assign a value to final field %s` | A final field of another class cannot be assigned. |
| TY-TYP-0059 | `incompatible operand types %s and %s` | The two sides of `==`/`!=` cannot be compared. |
| TY-TYP-0060 | `incomparable types: %s and %s` | Two reference types can never be equal. |
| TY-TYP-0061 | `operator '%s' cannot be applied to %s and %s` | Ordering comparisons only work on numeric values. |
| TY-TYP-0062 | `operator '%s' requires integral or boolean operands` | The operand type of `&`/`\|`/`^` is not legal. |
| TY-TYP-0063 | `operator '%s' requires integral operands` | The shift operators only work on integers. |
| TY-TYP-0064 | `operator '%s' cannot be applied to %s and %s` | The operand of an arithmetic operator is not numeric (a common case: an object that was not unboxed). |
| TY-TYP-0065 | `left-hand side of an assignment must be a variable` | The left-hand side of an assignment cannot be an arbitrary expression. |
| TY-TYP-0066 | `operator '%s' cannot be applied to boolean` | `boolean` cannot be added, subtracted, multiplied or divided. |
| TY-TYP-0067 | `array dimension must be non-negative` | The array size is a negative constant. |

### Construction and instantiation (0068–0075)

| Code | Message | Explanation and fix |
|---|---|---|
| TY-TYP-0068 | `cannot instantiate %s` | This type cannot be used with `new`. |
| TY-TYP-0069 | `%s is abstract; cannot be instantiated` | An abstract class cannot be `new`ed directly. |
| TY-TYP-0070 | `cannot extend final class %s`／`cannot subclass enum %s` | An anonymous class cannot extend a final class or an enum. |
| TY-TYP-0071 | `an enclosing instance of %s is required` | An inner class has to be created where an enclosing instance exists. |
| TY-TYP-0072 | `no suitable constructor found for %s(%s)` | No matching constructor; check the number and the types of the arguments. |
| TY-TYP-0073 | `array clone takes no arguments` | `clone()` takes no arguments. |
| TY-TYP-0074 | `this(...) and super(...) may only be called from a constructor` | `this(...)`/`super(...)` may only be written inside a constructor (it can be one of the “statements before `super()`” that JEP 513 allows, see docs/language.md §4.2). |
| TY-TYP-0075 | `recursive constructor invocation` | The constructor calls itself recursively. |

### Method resolution, lambda and pattern (0076–0094)

| Code | Message | Explanation and fix |
|---|---|---|
| TY-TYP-0076 | `cannot find method %s(%s)`／`cannot find method %s for this functional interface` | The method cannot be found: check the name, the parameter types, the visibility or the receiver type. |
| TY-TYP-0077 | `non-static method %s cannot be referenced from a type name` | Only static methods can be called through a class name. |
| TY-TYP-0078 | `cannot invoke %s on %s` | Calling a method on this type is not legal. |
| TY-TYP-0079 | `%s has %s access in %s` | The method is not visible enough. |
| TY-TYP-0080 | `cannot find symbol %s in %s`／`on array` | The member does not exist on that type. |
| TY-TYP-0081 | `cannot infer the functional interface for this lambda; declare the target type`／`cannot infer the functional interface for this method reference` | The lambda/method reference has no target type; specify one explicitly. |
| TY-TYP-0082 | `lambda target type must be a functional interface, found %s`／`method reference target type must be a functional interface` | The target type is not an interface. |
| TY-TYP-0083 | `%s is not a functional interface` | The interface has several abstract methods and cannot be a lambda target. |
| TY-TYP-0084 | `lambda has %d parameters but %s requires %d` | The number of lambda parameters does not match. |
| TY-TYP-0085 | `cannot construct %s` | The target of the constructor reference cannot be constructed. |
| TY-TYP-0086 | `cannot resolve static import %s` | No matching member can be found for the static import. |
| TY-TYP-0087 | `record pattern requires a record type, found %s` | The left-hand side of the destructuring pattern is not a record type (the `Point` in `case Point(int x, int y)` must be a record). |
| TY-TYP-0088 | `record pattern for %s needs %d components, found %d` | The number of bindings in the destructuring does not match the number of record components; a nested destructuring has to match up item by item as well. |
| TY-TYP-0089 | `'case null' requires a reference selector` | `case null` only works on a switch selector of reference type; for a primitive type use `default` instead. |
| TY-TYP-0090 | `%s does not name a super interface` | The `Interface` in `Interface.super.method()` does not exist or is not an interface. |
| TY-TYP-0091 | `%s is not a super interface of %s` | A qualified `super` can only point at an interface the class itself implements (directly or indirectly). |
| TY-TYP-0092 | `a primitive pattern needs a name to bind the value to` | A primitive pattern must bind a variable: `o instanceof int i`, not just `o instanceof int`. |
| TY-TYP-0093 | `boolean cannot be converted to %s` | `boolean` can only be matched by a `boolean` pattern. |
| TY-TYP-0094 | `primitive pattern %s needs a boxed value, found %s` | The selector is neither a reference type nor a primitive numeric value. |
| TY-IO-0101 | An error in the module file itself (`teyru.mod` cannot be parsed, wrong version syntax…) | The message comes from `internal/mod` and names the file and the reason. |
| TY-IO-0102 | `cannot read package %s: %v` | The imported package is not found in the module cache, or its source files cannot be read. Run `teyru mod tidy` or `teyru get` first. |
| TY-IO-0103 | Hash mismatch for `teyru.sum` | The module contents in the cache differ from what `teyru.sum` records. Either the dependency was changed or the cache was touched; the build stops instead of using it. |
| TY-IO-0104 | `%s declares package %s, but %s in the same directory declares %s` | Two files in the same directory declare different packages. |
| TY-TYP-0095 | `cannot infer the type arguments of %s(%s)` | The type arguments of the generic method cannot be inferred: there is no argument that carries a type and no target type to use (lambda parameters are the most common case). Write the type arguments, or pass an argument that has a type. |
| TY-TYP-0096 | `switch expression does not cover all possible input values` | A switch **expression** must be exhaustive: an `int`/`String` selector must have a `default`, and an enum selector must cover every constant. A switch statement is not subject to this. |
| TY-TYP-0097 | `native methods %s and %s both need the C symbol %s` | Two overloaded native methods encode to the same C symbol (for example the class name `AI` and `int[]`). Rename one or change a parameter type. |
| TY-TYP-0098 | `non-static %s cannot be referenced from a static context` | The lambda body uses the `this` of the place where it is written (including unqualified instance method calls, bare field names and `super`), but the lambda is written in a static method or a static initialiser block, so there is no instance to capture. Java rejects it as well. |
| TY-TYP-0108 | (removed) | The JSON binding reads the class at run time; there is no step that generates one. |
| TY-TYP-0109 | (removed) | As above: two fields of one @SerializedName name are only visible when they are read. |
| TY-TYP-0112 | (removed) | A class read from JSON is built at run time, so a constructor that cannot be called shows up at newInstance. |
| TY-TYP-0111 | (removed) | A controller's answer is written as JSON by the binding whatever type it is. |
| TY-TYP-0110 | (removed) | Whether a field's type binds is something the reading finds out. |
| TY-TYP-0114 | `not a statement: %s has no effect` | An expression statement without a side effect (JLS 14.8). This language ends an expression at the line break, so `long x = a` followed by a newline and `+ b` are two statements, the second a silent unary plus — `x` comes up one term short with no message at all. It is reported now. |
| TY-TYP-0113 | `resource type %s is not a subtype of AutoCloseable` | The resource type of try-with-resources must be a subtype of `AutoCloseable`. The implicit `close()` is one interface call, so a class that merely “happens to have a `close()` method” compiles into an itable call on an object that has no such entry, and blows up at run time. |
| TY-TYP-0115 | `cannot resolve import %s` | The import path points at nothing. In Teyru a name is looked up by its **simple name**, and whatever package is written in front makes no difference, so a misspelt package such as `import java.utli.List` used to be ignored silently and you still got `List`. Now an import has to point at: a package the standard library answers for (the `teyru` package itself, plus `java.util`, `com.google.gson`, `lombok`… for compatibility, see docs/language.md §11), a package declared by some file in this build, or a type whose fully qualified name is exactly this path. |
| TY-TYP-0100 | (removed) | Two beans of one name are refused by the container at refresh(). |
| TY-TYP-0101 | `%s is declared by the framework and cannot be redefined` | `__TeyruFramework` is the generated class the container's registry lives in; its name is reserved. |
| TY-TYP-0102 | `@Bean method %s must not be static` / `@Bean method %s must return the bean's type` / `@Bean method %s does not return a class type` | A `@Bean` method must not be static and must return a class type (a primitive is boxed). |
| TY-TYP-0103 | (removed) | A missing bean is an exception at refresh() now, which is when Spring finds out too. |
| TY-TYP-0104 | (removed) | Two candidates are an exception at refresh(), with both names in the message. |
| TY-TYP-0105 | (removed) | Which constructor to call is decided at run time: the @Autowired one, the only one, or the one that takes nothing. |
| TY-TYP-0106 | (removed) | A @PostConstruct signature is checked when it is called. |
| TY-TYP-0107 | (removed) | A dependency loop is an exception at refresh(), with the cycle in the message. |
| TY-TYP-0099 | `reference to %s is ambiguous: it is declared in both %s and %s` | Two `import p.*` both provide the same simple name (JLS 6.5.5.1). Write the fully qualified name or disambiguate with a single-type import (`import a.Widget`). |

## TY-PROP: native property

| Code | Message | Explanation and fix |
|---|---|---|
| TY-PROP-0001 | `a property declaration must declare exactly one name` | A property can declare only one name. |
| TY-PROP-0002 | `duplicate get accessor`／`duplicate set accessor` | `get`/`set` may each appear only once. |
| TY-PROP-0003 | `computed property %s cannot use storage modifiers` | A property without storage cannot use `final`/`volatile`/`transient`. |
| TY-PROP-0004 | `final property %s cannot declare a setter` | A `final` property cannot have a setter. |
| TY-PROP-0005 | `property %s has no getter` | A property with only a setter cannot be read; inside the accessor, use `field`. |
| TY-PROP-0007 | `property %s has no setter` | A property with only a getter cannot be assigned. |
| TY-PROP-0008 | `property %s needs a getter for compound assignment` | `p.x += 1` needs a getter and a setter. |

## TY-INT and TY-IO

| Code | Message | Explanation |
|---|---|---|
| TY-INT-0001 | `prelude is missing class %s` | The prelude is corrupt or the class was overridden; this is an internal compiler error. |
| TY-INT-0002 | `unsupported expression %T` | Semantic analysis met a node it does not handle; this is an internal compiler error (please report it). |
| TY-INT-0004 | `@Singular goes on a builder field, not on the class` | On a class it means nothing. |
| TY-INT-0005 | `@Singular needs a List or Map field, found %s` | `@Singular` only works on a collection field. |
| TY-INT-0006 | `@CustomLog needs %s in a %s file in the source file's directory or above it`／`@CustomLog cannot pass TYPE: …`／`@CustomLog: cannot resolve the factory class %q named by %s` | `@CustomLog` relies on `lombok.log.custom.declaration` in `lombok.config` to know how to build the logger (see docs/lombok.md for how it is read): a missing key, a pattern that uses `TYPE`, or a pattern naming a class that cannot be found are all reported here. You can also switch to `@Log` or declare the field yourself. |
| TY-IO-0001 | `cannot read %s: %v` | The source file cannot be read; check the path and the permissions. |

## Runtime errors

A run-time failure is not a diagnostic code but a member of the `Throwable` family:

| Exception | When it is thrown |
|---|---|
| `NullPointerException` | Unboxing `null`, or reading/writing a field, calling a method (`String` methods, `clone()`, interface methods and virtual calls all count), reading/writing an array element or taking `length` |
| `ArrayIndexOutOfBoundsException` | An array index outside `[0, length)` (both reads and writes; a `null` array throws `NullPointerException` first); a range argument out of bounds in the `Arrays.copyOfRange` family uses it too |
| `StringIndexOutOfBoundsException` | A string or `StringBuilder` index or range outside: `charAt`, `substring`, `delete`, `StringBuilder.insert` and the like (every one of `String`'s bounds checks is this one) |
| `IndexOutOfBoundsException` | A container's own index, such as the index of `ArrayList.get`/`set`/`remove` outside `[0, size)` |
| `NoSuchElementException` | `Iterator.next()` called again although there are no elements left |
| `ArithmeticException` | Integer division by zero or remainder by zero |
| `ClassCastException` | A cast that fails, through `cast` or `instanceof` |
| `NegativeArraySizeException` | A negative array length |
| `AssertionError` | A failed `assert` |
| `IllegalArgumentException` | `enum.valueOf` cannot find the constant, and so on |

The three out-of-bounds ones have the same hierarchy as Java's: `IndexOutOfBoundsException` is
the parent, `ArrayIndexOutOfBoundsException` and `StringIndexOutOfBoundsException` sit under
it, so `catch (IndexOutOfBoundsException e)` catches all three. That is also the most common
way it is written in Java code, and it works here as it does in Java (see
[docs/language.md](/en/docs/language) §10).

An exception that is not caught prints `Exception in thread "main" …` and exits with status 1.
Reaching an abstract method that has no implementation prints `teyru: no implementation for …` and exits with status 70.
