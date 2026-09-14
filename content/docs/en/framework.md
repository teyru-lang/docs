---
title: "Framework: a Spring-shaped container and web layer"
description: "Dependency injection and request binding are both done at compile time, instead of scanning with reflection at startup the way Spring does."
---

`lib/17_container.teyru` and `lib/18_web.teyru`, together with
`internal/sema/framework*.go`, make up an application framework whose
interfaces are copied from Spring but whose implementation differs.

## Why not reflection

Spring scans the classpath at startup, reads annotations, uses reflection to
create and inject beans, and binds requests to methods. Teyru has no
reflection — but it **knows the whole program at compile time**: every class,
every field, every constructor, every inheritance edge. So this work is done at
compile time rather than at startup.

The differences between the two are concrete:

| | Spring | Teyru |
|---|---|---|
| Where beans come from | Scanning the classpath at runtime | The compiler enumerates every class annotated with `@Component` and the like |
| Which bean is injected | Looked up by type at runtime | Resolved to a bean name at compile time (`ctx.getBean("userRepo")`) |
| Missing bean | `NoSuchBeanDefinitionException`, at startup | `TY-TYP-0103`, at compile time, with the source location |
| Circular dependency | `BeanCurrentlyInCreationException`, at startup | `TY-TYP-0107`, at compile time, printing the cycle |
| Adding a bean at runtime | Possible | Not possible |
| Startup cost | Scanning and reflection | None — the registry is filled in by static initialization |

The trade-off is explicit: no runtime extension. The benefit is equally
explicit: a whole class of errors moves from "only seen after deployment" to
"doesn't compile".

## Container

```teyru
import teyru.*

@Repository
class UserRepo {
  String find(String id) { return "user " + id }
}

@Service
class UserService {
  @Autowired UserRepo repo
  @Value("${app.name:unnamed}") String appName
  private boolean ready = false

  @PostConstruct
  void start() { ready = true }

  String describe() { return appName + ": " + repo.find("7") }
}

class Main {
  public static void main(String[] args) {
    ApplicationContext ctx = new ApplicationContext()
    ctx.setProperty("app.name", "demo")
    ctx.refresh()
    UserService s = (UserService) ctx.getBean(UserService.class)
    System.out.println(s.describe())
  }
}
```

### Supported annotations

| Annotation | Meaning |
|---|---|
| `@Component`／`@Service`／`@Repository`／`@Controller`／`@RestController` | This class is a bean; the name defaults to the class name with the first letter lowercased, and `@Component("x")` can change it |
| `@Configuration` + `@Bean` | This class is itself a bean too, and each of its `@Bean` methods produces one bean |
| `@Autowired` | The field, constructor parameter, or `@Bean` method parameter is provided by the container |
| `@Qualifier("name")` | Names which one when several of the same type exist |
| `@Primary` | The default choice when several of the same type exist |
| `@Value("${key}")`／`@Value("${key:default}")` | Injects a property |
| `@PostConstruct` | Called after construction and injection (no parameters, returns void) |
| `@Scope("prototype")` | A new instance is built on every lookup; the default is singleton |

### Constructor selection

The rule since Spring 4.3: if there is only one constructor, use it; otherwise
find the one marked `@Autowired`; otherwise use the no-argument one. If several
are marked `@Autowired`, or none are and there are several with no no-argument
constructor, it is `TY-TYP-0105`.

### Lifecycle

`refresh()` builds every singleton, so failures in construction and injection
are reported at startup (rather than on the first request) — a missing bean is
caught even earlier, as the compile-time `TY-TYP-0103`. Bean creation is
recursive: to get A, the B it needs is built first. The `creating` flag blocks
cycles.

`@PostConstruct` is called by the generated injector after injection completes.
`@PreDestroy` is declared but **not** executed — Teyru has no process shutdown
hook, and the container has no `close()`.

## Web layer

```teyru
import teyru.*

@RestController
@RequestMapping("/pets")
class PetController {
  @Autowired PetStore store

  @GetMapping("/{id}")
  Pet one(@PathVariable("id") int id) { return store.find(id) }

  @GetMapping("")
  String list(@RequestParam(value = "q", defaultValue = "all") String q) {
    return "q=" + q
  }

  @PostMapping("")
  Pet create(@RequestBody String body) { return new Pet(body, 1) }
}
```

| Annotation | Meaning |
|---|---|
| `@RequestMapping` (on the class) | The path prefix |
| `@RequestMapping` (on the method) | The path and `method` (omitted means any verb) |
| `@GetMapping`／`@PostMapping`／`@PutMapping`／`@DeleteMapping`／`@PatchMapping` | The path and the verb |
| `@PathVariable` | The value of `{name}` in the path, converted to the parameter's type |
| `@RequestParam` | A query parameter; `defaultValue` can supply a default |
| `@RequestHeader` | A request header (names are case-insensitive); `defaultValue` is declared but has no effect, and a missing header is an empty string |
| `@RequestBody` | The request body; if the parameter is a `String` it is received as-is, and if it is a class (or record) it is parsed with the Gson binding |
| `@ResponseBody` | Declared; `@RestController` already implies it, so it makes no difference whether it is present |

**Parameter conversion**: path and query parameters are both strings, so
parameters of type `int`, `long`, `double`, `float`, `short`, `byte`,
`boolean` are converted via the corresponding `parseX` (`int` uses
`Integer.parseInt`).

**Request body**: when the `@RequestBody` parameter is a `String`, you get the
body as-is (this is how you take a payload you want to inspect yourself); when
it is a class or record, it is parsed by the **Gson binding the compiler
generates for that type** — Spring picks a message converter based on
`Content-Type`, whereas here the type is already known at compile time, and the
converter is that binding. A failed parse throws the same
`JsonSyntaxException`. A type with no JSON mapping is a compile error, not an
exception on the first request.

**Responses**: returning an `HttpResponse` means you decide everything
yourself; returning a `String` is `text/plain`; returning `void` is an empty
body; other classes (including records and enums, with an enum written as a
string of the constant name) are serialized via the Gson binding into
`application/json` (see `docs/json.md`). Primitive types have no mapping and,
like arrays and `List`, are `TY-TYP-0111`.

**Routing**: `Router.match` takes the most specific match — a literal segment
beats a variable segment, so `/pets/mine` is not swallowed by `/pets/{id}`,
regardless of registration order. A path that exists with the wrong verb is
405, and a path that does not exist is 404.

### Server

```teyru
ApplicationContext ctx = Application.boot(args)
Router router = Application.routerFrom(ctx)
HttpServer server = new HttpServer(port, router, ctx)
```

`HttpServer.handle(HttpRequest)` is the only entry point once a request arrives
— it is separate from the socket loop, so it can be tested without a
connection: that is how `tests/programs/t102_web.teyru` and
`tests/programs/t141_web_param_errors.teyru` are tested, the latter covering the
400 from a failed conversion, enum parameters and return values, and
`defaultValue`.

## Known limitations

1. **One connection at a time.** The language has no threads
   (`docs/language.md` §13), so a second connection waits for the first to
   finish. This is enough for "a program that answers requests", but not for
   "serving a crowd"; the shape is already the shape thread-per-connection
   needs.
2. **No content negotiation.** Only the method's declared type is looked at, not
   `Accept`.
3. **Returning arrays, `List`, or primitive types has no JSON mapping yet**
   (`TY-TYP-0111`), because the binding does not support them yet.
4. **Only `Application.boot` reads command-line arguments of the form
   `--key=value`** into properties; there is no reading of an
   `application.properties` file.
5. **`@PreDestroy` is not executed**; there is no `@Conditional`, `@Profile`,
   `@Import`, `@Lazy`, AOP, transactions, or `@ExceptionHandler`.
6. **No scope control for `@ComponentScan`**: the whole program is in scan
   scope, because the compiler sees everything — if you want to exclude
   something, just don't annotate it.
