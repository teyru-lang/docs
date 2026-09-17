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

**TLS.** `server.ssl(certificate, privateKey)` takes the **paths** of a PEM certificate chain
and its private key (Spring's `server.ssl.certificate` and
`server.ssl.certificate-private-key`), and once it is given, every connection this server
accepts is TLS and `server.isSecure()` answers whether it is. The pair of files is read and
checked at configuration time, so an unusable certificate fails there — where the program can
still say what is wrong — rather than making every client that arrives fail. A program that
builds its own `HttpServer` (the "The server on a thread of its own" section below, and the
`Application.boot` + `routerFrom` path) calls it itself; `Application.serve(ctx, port, idleMs)`
reads those two properties and calls `ssl()` itself when `server.ssl.certificate` is there —
`SpringApplication.run` does not.

The layer is OpenSSL, so only POSIX targets have it; windows and macOS are a named refusal, and
it comes before any output file is written (see [docs/native.md](/en/docs/native)), while a
program that does not touch TLS is not linked against OpenSSL. Since W9, "reaches TLS" means
reachability over **the program's own call graph** (the reflection member tables do not count),
so a web program that never calls `ssl()` builds and serves on a machine with **no OpenSSL
headers at all** — measured by pointing `cc` at a wrapper that pretends `openssl/err.h` is
missing: `web.teyru` built, and `GET /ok` answered `fine [200]`. The test with a server and a
client round tripping inside one program is `tests/programs/t163_https_roundtrip.teyru`; two
requests on one TLS connection, and the handshake timeout, are `t191_tls_keepalive.teyru` and
`t192_tls_handshake_timeout.teyru`.

**A handler that breaks itself does not take the server down.** A recursion that runs too
deep (see "Runtime model" in [docs/index.md](/en/docs)) gives that request a 500, the server
goes on serving the next one, and the serving thread is still alive —
`tests/programs/t241_http_stack_overflow.teyru`.

### Concurrency

A server has one thread that accepts and a pool that answers. `accept()` belongs to the
accepting thread and nothing else does: a connection is handed to a worker, TLS handshake
included, and the accepting thread is back in `accept()` before the worker has read a byte.
A client that is slow, silent or never finishes what it started holds one worker; the
listener goes on accepting.

The pool is a cached one (`lib/37_executor.teyru`): a worker with nothing to do leaves after a
second, and a new one is started when work arrives with none idle. That is a property of the
runtime rather than a tuning choice — there are no daemon threads here, so a fixed pool of
parked workers would mean a program that served one connection and returned from `main`
never exits.

Concurrency is bounded three times, and every bound is a number a client can reach:

| What | Default | What happens past it |
|---|---|---|
| Worker threads answering connections | 64 | the connection waits in the queue |
| Connections waiting for a worker | 100 | the accepting thread answers 503 with `Retry-After: 1` and closes |
| WebSocket sessions | 256 | the upgrade is answered 503 before the 101, and the connection closes |

A WebSocket is not served by the request pool at all: the session is handed to a thread of
its own (`SocketSessionTask`), so a session that lasts all afternoon costs one session slot
and not one of the workers that answer requests.

`stop()` (and `close()`, which calls it) stops accepting and taking, ends a connection that is
waiting for a request rather than waiting with it, gives the requests in flight **two
seconds** (`SHUTDOWN_GRACE_MS`) to finish, and then closes what is left. A worker notices
within **a quarter of a second** (`READ_POLL_MS`), because every wait is a poll of at most
that long; the same bound is what keeps a worker blocked in `recv()` from holding a
stop-the-world collection.

This section has tests: `tests/programs/t223_http_concurrency.teyru` (one connection sending
a byte every 2 seconds while another client completes 20 GETs inside a second each; 100
concurrent clients sending 10 keep-alive requests each, all 200; a server with 2 workers and
a queue of 1 answering 503) and `tests/programs/t225_http_serve_loop.teyru` (`serve()`
answers, `close()` ends it, the thread finishes).

### What a client is held to

Read from the configuration with these defaults; the property names are the keys, and
`Application.configureLimits` is where they are read (the last step of
`Application.configureServer`):

| Property | Default | Meaning | Refusal |
|---|---|---|---|
| `server.teyru.max-request-line-bytes` | 8192 | the request line, in bytes | 414 |
| `server.max-http-request-header-size` | 8192 | the whole header block, in bytes | 431 |
| `server.teyru.max-header-count` | 100 | how many headers (and trailers) | 431 |
| `server.teyru.max-body-bytes` | 10485760 | the request body, in bytes | 413 |
| `server.teyru.header-timeout-ms` | 10000 | the head, from the first byte to the blank line | 408 |
| `server.teyru.body-timeout-ms` | 30000 | the body, as a whole | 408 |
| `server.teyru.keep-alive-idle-ms` | 15000 | a connection between two requests | the connection closes |
| `server.teyru.max-requests-per-connection` | 100 | requests on one connection | the answer says `Connection: close` |
| `server.teyru.worker-threads` | 64 | connections answered at once | 503 |
| `server.teyru.accept-queue` | 100 | connections waiting for a worker | 503 |
| `server.teyru.websocket.max-connections` | 256 | open sessions | 503 before the 101 |
| `server.teyru.websocket.max-message-bytes` | 1048576 | one message, fragments included | 1009 |
| `server.teyru.websocket.idle-timeout-ms` | 60000 | a session that says nothing | 1001 |

`server.max-http-request-header-size` is Spring Boot's own key and the rest are under
`server.teyru.*`, in the shape `server.tomcat.*` writes its own. **The handshake is the
asymmetry: it has a bound of its own and no key** — a TLS handshake is bounded at a fixed 10
seconds (`handshakeTimeoutMs`, which is what `s.setSoTimeout` is given), a separate constant
on the same clock as `header-timeout-ms`, so changing either property does not move it. A value that is not a number
is the default rather than a refusal to start: the defaults are safe numbers by
construction, and a server that will not boot over a typo in a limit is one nobody can
correct from a phone.

Every limit is checked while the bytes arrive and not after them, so the refusal comes before
the cost: a `Content-Length: 1000000000` is answered 413 within a second and the process's
resident set does not grow by the gigabyte the client asked for (measured as RSS growth under
16 MB, read from `/proc/self/status` on Linux). A body is read into a buffer that grows with
what actually arrives.

The deadlines are totals and not per-read timeouts. Each read is given the smaller of what is
left of the deadline and a quarter of a second, so a client that sends one byte every two
seconds is refused when its deadline arrives rather than being granted a fresh timeout for
every byte.

The limits are tested by `tests/programs/t221_http_limits.teyru`; byte bodies (a
`Content-Length` that is the UTF-8 length, a multipart part of all 256 byte values
round-tripping byte for byte) by `tests/programs/t220_http_body_bytes.teyru`.

### What the parser refuses (RFC 9112)

`Content-Length` together with `Transfer-Encoding` (400), a `Content-Length` declared twice
with different values or one that is not a number, negative or too large to be one (400), a
`Transfer-Encoding` whose last coding is not `chunked` (400) or one that names a coding this
server does not implement (501), whitespace between a header name and its colon (400), a
header line that continues the one before it (obs-fold, 400), a header name that is not a
token (400), an HTTP version other than 1.0 or 1.1 (505), a chunk size that is not
hexadecimal or that overflows (400), a chunk over the body limit (413), and an `Expect`
naming something other than `100-continue` (417). An absolute-form request target is routed
by its path.

A request that is refused closes the connection: the bytes it declared may still be on their
way, and a stream whose position is known only to the client is not one the next request can
be read from.

That is verified as behaviour and not only as a list: `tests/programs/t222_http_parser_fuzz.teyru`
(4000 mutated requests, 0 crashes) next to the table in `tests/programs/t221_http_limits.teyru`.

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

**Expiry.** `setMaxInactiveInterval(seconds)` gives one session an idle limit and
`Sessions.setTimeout(seconds)` gives the whole store a default; `0` (or anything negative)
means **no limit**, a session's own interval wins when it has one, and otherwise the store
default applies. The setting file takes Boot's `server.servlet.session.timeout`, whose value
is a duration — `30m`, `2h`, `1d`, `45s` — or a bare number of seconds;
`spring.web.session.timeout` is the shorter spelling of the same thing, and Boot's key wins.
A value that cannot be read becomes `0` (no limit) rather than a guess.

An expired session is not a session: `find(req)` drops it and answers `null`, so the cookie
the client is still holding names nothing and the next request that wants a session is given
a new one (`tests/programs/t181_session_timeout.teyru`).

**There is deliberately no background reaper.** This runtime joins every thread when the
program ends, so a reaper looping forever would stop a program from finishing; instead every
request checks a few sessions — a cursor advances, eight per call — so the cost is spread
over the traffic rather than handed to a reaper, and `Sessions.prune()` walks the whole store
at once for a test or a quiet moment. Worth knowing: **with no store default set, that cursor
does nothing** — a session that set only its own interval is found by `find()` or by `prune()`.

### Validation

`lib/36_validation.teyru` is the piece of bean validation a web layer needs: a
class declares constraints on its own fields, and one call checks them.

| annotation | meaning |
|---|---|
| `@NotNull` | the field has to hold something |
| `@Size(min = …, max = …)` | a `String` field's length has to be within `[min, max]`, both ends included |
| `@Min(value = …)` / `@Max(value = …)` | the lower / upper bound of a numeric field |

All four declare `String message() default …`, so an unwritten message has a
default. `Validation.check(bean)` reads the object's own declared fields
(through the same reflection the JSON binding reads), and the **first** field
that violates a constraint throws `ValidationException` with the message
`field: message` — Spring reports every violation at once, this reports the
first, and a caller that wants the rest can ask again.

The web layer calls it on **every object the binding built**, so a request body
that breaks a constraint of its own type is answered with a 400 whose body is
`bad request: field: message`: the client made the mistake, and the answer says
which field. A `@Min`/`@Max` on a field that is not a number, or a `@Size` on a
field that is not a `String`, is a violation too, whose message says the
constraint cannot read that field — the class is written wrong, but that must
not crash the server. `tests/programs/t160_validation.teyru` covers this.

**Those four names are taken.** Teyru's simple names live in one flat
namespace, so `NotNull`, `Size`, `Min` and `Max` are already the names of the
constraint annotations and a program cannot use them for a type of its own:
declare a `class Size` and `@Size` means that class instead, so the constraint
stops being checked (silently).

### Uploads (multipart)

`HttpRequest.multipart(String name)` answers the part a `multipart/form-data`
request sent under that field name, as a `MultipartFile`: `name`,
`originalFilename`, `contentType`, `content` (a request body is a String
already, so a file arrives as the characters that were sent), plus `isEmpty()`
and `size()`; it is `null` when the request carries no such part.

It is also `null` when the request is not multipart, when its `Content-Type`
names no boundary, or when its body is not the multipart it claims to be — not
an exception, because whether that is a 400 is the handler's decision. The
urlencoded form is untouched and still binds through `@RequestParam` (see
`tests/programs/t161_multipart.teyru`).

### Compressed responses

Whether a response is compressed is **the handler's decision**: set `HttpResponse.gzipBody`
to `true`, and the connection loop reads `Accept-Encoding` on the way out and compresses
only when every one of these holds:

- the request accepts gzip (`gzip` or `*`; `gzip;q=0` is a refusal, not an offer);
- the body is at least 1024 bytes — gzip's own header and trailer are 18 bytes, and a body
  that is already one packet is not made better by being one packet and a header;
- the compressed body is **actually shorter**.

The compression itself is `lib/44_zip.teyru` (see [docs/language.md](/en/docs/language) §11).
`Content-Encoding: gzip` is written only when the body really was compressed; whenever the
handler asked for compression the response carries `Vary: Accept-Encoding`, **whether or not
this particular request got the compressed form** — a cache must not hand a compressed body
to a client that never said it could decode one. `Content-Length` is recomputed by the server
from the (compressed) body as it sends it.

The client half is opt-in: `HttpClientRequest.acceptGzip()` is what sends
`Accept-Encoding: gzip`, and an answer that says `Content-Encoding: gzip` is decoded for the
caller while the headers — `Content-Length` among them — keep the numbers that were on the
wire. A malformed gzip is not swallowed: `ZipException`/`EOFException` come out of `send`
(`tests/programs/t180_http_gzip.teyru`).

### Testing

`MockServer` asks the server without opening a socket:

```teyru
MockServer server = new MockServer(ctx)
server.get("/pets")                                  // the body
server.request("POST", "/pets", body, "application/json")
server.handle(req)                                   // a request you built, for headers
```

The reason is the same one Spring has MockMvc: testing a route should not need a
port, a client, or a second thread. `server.handle(req)` takes a request that is
already prepared — call `readCookies()` yourself if it carries a cookie.

### The server on a thread of its own

The accept loop is a `Runnable` too (`ServerTask`, in `lib/18_web.teyru`), so a
client and a server fit in one program:

```teyru
HttpServer server = new HttpServer(0, Application.routerFrom(ctx), ctx)
server.bind()                                  // bind first, so the port is known
ServerTask task = new ServerTask(server)
Thread serving = new Thread(task, "server")
serving.start()
// … send requests …
task.stop()
serving.join()
```

`server.bind()` has to come before the thread starts: the port
(`server.getPort()`) is what the URLs are built from, and a listener that is
already bound answers a connection that arrives while the serving thread is
still on its way to accept. `stop()` stops accepting, ends a connection that has not started
reading a request rather than waiting with it, gives the requests in flight two seconds to
finish, and then closes what is left; `isRunning()` answers whether it is still going. A port
of 0 asks the kernel for a free one.
`tests/programs/t162_http_roundtrip.teyru` is exactly this: the server on a
thread, the main thread as the client, a round trip inside one program.

## Known limitations

1. **The connection count is bounded, and past the bound the answer is 503.** 64 connections
   are answered at once by default and 100 more may wait; past that the accepting thread
   answers 503 and closes (the Concurrency section above). That is a deliberate bound:
   thread-per-connection with no ceiling lets one client decide how many threads this process
   uses. Serving more connections means raising those two numbers, and paying for it in
   memory and scheduling.
2. **No HTTP/2, and no HTTP/3.** A version that is not 1.0 or 1.1 is a 505; there is no ALPN
   negotiation over TLS either, so HTTPS speaks HTTP/1.1 and nothing else.
3. **Almost no content negotiation.** Only the method's declared type is looked at, not
   `Accept`; the one exception is `Accept-Encoding` and gzip — and that needs the handler to
   turn `gzipBody` on first. brotli, deflate and the other codings are not there.
4. **Sessions live in the process.** With two processes behind one address a
   request has to come back to the one that made the session, and the id is 128
   bits of `java.util.Random` — enough for one server, not a cryptographic
   source.
5. **No SSE.** Multipart uploads and validation annotations are both there, in
   the two sections above; server push is not.
6. **No `@Conditional`, `@Import`, `@Lazy`, AOP or transactions**, and no scope
   control for `@ComponentScan`: the whole program is in scan scope, because the
   compiler sees everything — if you want to exclude something, just don't
   annotate it.
7. **`SpringApplication.run` does not read `server.ssl.certificate`.** What reads
   those two properties is `Application.serve`, which builds the server itself;
   `SpringApplication.run` also builds one, but has no such branch. To serve HTTPS
   from that entry point, build an `HttpServer` yourself, call `ssl(cert, key)` and
   serve it yourself, or use `Application.serve` instead.
