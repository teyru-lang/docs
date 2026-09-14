---
title: "Framework: a Spring-shaped container and web layer"
description: "Dependency injection and request binding are both done at compile time, instead of scanning with reflection at startup the way Spring does."
---

`lib/17_container.teyru` and `lib/18_web.teyru`, together with
`internal/sema/framework*.go`, make up an application framework whose
interfaces are copied from Spring but whose implementation differs.

## Reflection, and the one thing that is not

Spring scans the classpath at startup, reads annotations, uses reflection to
create and inject beans, and binds requests to methods. This container reads
annotations and uses reflection to create and inject too
(`lib/28_container_reflect.teyru`). What differs is the bean list: there is no
classpath to scan, so the compiler writes that list down, and everything else
about a bean is read off the class while the program starts.

The differences between the two are concrete:

| | Spring | Teyru |
|---|---|---|
| Where beans come from | Scanning the classpath at runtime | The compiler writes down the classes annotated with `@Component` and the like; there is no classpath to scan |
| Reading annotations and injecting | Reflection at runtime | Reflection at runtime, reading the class itself |
| Missing bean | `NoSuchBeanDefinitionException`, at startup | `IllegalStateException`, at `refresh()` |
| Circular dependency | `BeanCurrentlyInCreationException`, at startup | `IllegalStateException`, at `refresh()`, with the cycle in the message |
| Adding a bean at runtime | Possible | Not possible: the list comes from the compiler |
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
find the one marked `@Autowired`; otherwise use the no-argument one. With the
constructor that was chosen, every parameter must itself be marked `@Autowired`
(or `@Value`) to be injected: an unmarked parameter is not filled in, the
generated factory calls the constructor with the missing arguments, and the
compile fails with `TY-TYP-0072`. If several are marked `@Autowired`, or none
are and there are several with no no-argument constructor, it is `TY-TYP-0105`.

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
| `@RequestHeader` | A request header (names are case-insensitive); `defaultValue` is the value used when the header is absent, and with none given it is an empty string |
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

**Response**: returning an `HttpResponse` decides everything yourself; returning a
`String` is `text/plain`; returning `void` is an empty body; anything else is
written as `application/json` by the Gson binding (see `docs/json.md`) —
records, enums (written as the constant's name), arrays, `List` and `Map` alike.
The old "primitive types have no mapping" diagnostic, `TY-TYP-0111`, is gone:
the binding takes every type now.

**Handler parameters**: a parameter of type `HttpRequest` is the request itself,
whatever it is named — the way Spring hands a handler its `HttpServletRequest`.
Any other unannotated parameter is still a query parameter of the same name.

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

### Starting up, and settings

```teyru
class Main {
  public static void main(String[] args) {
    SpringApplication.run(Main.class, args)
  }
}
```

`SpringApplication.run` is `new ApplicationContext()` plus
`SpringApplication.loadConfig(ctx, args)` plus `ctx.refresh()`. Settings come
from `application.properties` in the working directory (`--spring.config.name=`
points at another file) and then from `--key=value` arguments on the command
line, which win. Read one back with `ctx.getProperty("app.name")` or
`ctx.getProperty("app.name", "fallback")`, and ask whether one exists with
`ctx.hasProperty(...)`.

`@ConfigurationProperties(prefix = "app")` on a bean binds `app.*` into its
fields, with relaxed names: `app.max-size` and `app.max_size` both reach
`maxSize`. A bean under `@Profile("prod")` is built only when that profile is
active (`--spring.profiles.active=prod`). A `@PreDestroy` method runs when the
context is closed with `ctx.close()`.

### The concerns that cross requests

| thing | how it is declared | what it does |
|---|---|---|
| `@ControllerAdvice` with `@ExceptionHandler(X.class)` | the advice on the class, the handler on a method | a controller that throws `X` (or a subclass) is answered by this method, whose return value is the response — an `HttpResponse`, a `ResponseEntity` or a body |
| `HandlerInterceptor` | a bean implementing it | `preHandle` runs before every route and answering false is a 403; `afterCompletion` runs before the answer is written |
| static files | `spring.web.static=<dir>` | a path no route claims is a file in that directory, its content type from its extension; a path containing `..` is a 404 |
| CORS | `spring.web.cors=origin,origin` | a preflight is answered by the server and never reaches a controller, and the headers go on the answer that is finally sent |

A route is called reflectively, so what a controller throws arrives wrapped in
an `InvocationTargetException`; the wrapper is taken off before the advice is
chosen, so advice matches the exception the controller meant.

### Sessions

```teyru
@GetMapping("/cart")
String cart(HttpRequest req) {
  HttpSession s = Sessions.of(req)
  Object n = s.getAttribute("count")
  int v = n == null ? 0 : ((Integer) n).intValue()
  s.setAttribute("count", Integer.valueOf(v + 1))
  return "count=" + s.getString("count")
}
```

`Sessions.of(req)` finds the session the request's cookie names, or makes one
and puts a `Set-Cookie` (`TEYRUSSESSIONID`, `HttpOnly`) on the answer the server
is about to send. That is the only place it can go: a route's response is built
after the handler has returned, which is also why a handler is given the request
rather than an injected response.

`isNew()` is true only for the request that made the session. `find(req)` looks
one up without making one, which is what a login page reads. `invalidate()`
takes the id out of the store, so the cookie the client still holds names
nothing and the next request gets a fresh session. `attributeNames()` keeps the
order attributes were first set in. `Sessions.count()` and `clear()` are for
tests.

### Testing

`MockServer` asks the server without opening a socket:

```teyru
MockServer server = new MockServer(ctx)
server.get("/pets")                                  // the body
server.request("POST", "/pets", body, "application/json")
server.handle(req)                                   // a request you built, for headers
```

The reason is the same one Spring has MockMvc: testing a route should not need a
port, a client, or a second thread (and this language has no threads yet).
`server.handle(req)` takes a request that is already prepared — call
`readCookies()` yourself if it carries a cookie.

## Known limitations

1. **One connection at a time.** The language has no threads
   (`docs/language.md` §13), so a second connection waits for the first to
   finish. This is enough for "a program that answers requests", but not for
   "serving a crowd"; the shape is already the shape thread-per-connection
   needs.
2. **No content negotiation.** Only the method's declared type is looked at, not
   `Accept`.
3. **Sessions live in the process.** With two processes behind one address a
   request has to come back to the one that made the session, and the id is 128
   bits of `java.util.Random` — enough for one server, not a cryptographic
   source.
4. **No multipart uploads, no validation annotations, no SSE.**
5. **No `@Conditional`, `@Import`, `@Lazy`, AOP or transactions**, and no scope
   control for `@ComponentScan`: the whole program is in scan scope, because the
   compiler sees everything — if you want to exclude something, just don't
   annotate it.
