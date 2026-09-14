---
title: "Teyru's module system"
description: "Module paths, import paths and teyru.mod: fetching and verification follow Go's approach."
---

A module is "a set of packages version-controlled and fetched together", and its
identity is its **module path** (for example `example.com/app`). An import path is
the module path plus the package's location within the module:

```
example.com/app               module (a repository address such as github.com/x/y)
example.com/app/util          the util package inside the module
example.com/greeting/text     the text package inside the dependency module
```

The module system is implemented in `internal/mod`, the build side hooks in at
`internal/driver`, and the command line is in `cmd/teyru`.

---

## teyru.mod

It lives in the module root directory and is the marker that "this directory is a
module". The build searches upward from the path being compiled, and the first
`teyru.mod` it finds is the module this build belongs to.

```
module example.com/app

teyru 1

require (
	example.com/greeting v0.1.0
)
```

| Directive | Meaning |
|---|---|
| `module <path>` | The module path; required, and only once. The import paths of every package in this module start with it. |
| `teyru <n>` | The language version. A module states which generation of the language it was written for, so that a future compiler has grounds to reject a module it would have to reinterpret. |
| `require <path> <version>` | A dependency. It can be a single line, or a `require ( ... )` block; `teyru mod tidy` always normalizes it into a block. |

Anything after `//` is a comment. **An unrecognized directive is an error**: Go
directives such as `exclude`, `replace` and `go` are all rejected. Silently
ignoring one would let `teyru mod tidy` rewrite the file into a file with a
different meaning.

### Versions

`vMAJOR.MINOR.PATCH`, optionally with a prerelease (`v2.0.0-rc1`). A version is
both a git tag and a directory name in the cache, so **only one spelling is
accepted**: `1.2.3`, `v1.2`, `v01.2.3` and `v1.2.3+build` are all rejected — they
can all point at the same tag, and accepting them would mean one version has two
names.

From v2 onward, the major version number belongs to the import path
(`example.com/dep/v2`). Path and version must agree with each other:
`example.com/dep/v2@v1.0.0` puts v1's source code into a program that requires v2,
and both directions are rejected.

### Canonical format

What `teyru mod tidy` writes is always the canonical format, and running it again
produces no diff:

```
module example.com/app

teyru 1

require (
	example.com/greeting v0.1.0
	example.com/other    v1.2.3
)
```

`module` comes first, then a blank line, then `teyru`, then a blank line, then the
require block: paths sorted, versions aligned into one column. A single-line
`require x v1.0.0` is also expanded into a block, because the next `teyru get`
will add another line, and that is what the file will look like next. Comments
stay where the author put them, except for comments attached to the `require`
directive itself (the `require` line and the line above it): those are dropped.

---

## Imports

Both spellings work, and they refer to the same package:

```
import example.com/greeting/text   // the module spelling
import example.com.greeting.text   // the dot spelling
```

The parser follows Java's import syntax, except that path segments accept `/` and
`-`, so `example.com/greeting/my-util` is a legal path and is canonicalized to the
package name `example.com.greeting.my-util`. The line and column positions that
diagnostics compute therefore point at the real characters on disk, with no need
to rewrite the source before parsing.

`import static example.com/dep/pkg.Widget.icon` imports a single static member of
a type (`Widget.*` imports all of them; a static import that stops at the type
itself is `TY-TYP-0086`, because it wants a member name).
`import example.com/dep/pkg.Widget` imports that type, and
`import example.com/dep/pkg` with no suffix imports the whole package.

An import path may also be the **name the package declares**: a directory with
`package todo` has the identity `example.com/app/todo`, and both
`import todo.Store` and `import todo.*` can reach it — the name is the one the
author wrote and the identity is the one the build gives it, and both are looked
up. When two `import p.*` both provide the same simple name (whether `p` is
written as the identity or as the declared name), `TY-TYP-0099` is reported at
the use site, rather than picking one by load order.

### A package's identity is its import path

The build rewrites each file's `ast.File.Package` into the **import path** of the
package it belongs to. The declared package name is only a name, and two modules
can both declare `package util` without colliding — what separates them is the
import path, and the C symbol is then turned by `util.Mangle` from `/` and `.`
into `_`.

A single directory may declare only one package, otherwise `TY-IO-0104` is
reported: silently merging two packages would compile a program that no import
ever asked for.

### Loading dependencies

- Resolution uses the **longest prefix**: the module path `example.com/a` is a
  prefix of both `example.com/a` and `example.com/a/pkg`, and the import refers to
  the more specific one.
- A package is "the longest segment within the module that is a directory
  actually containing `.teyru` on disk"; whatever is left after it is the name of
  a type or member. So both `example.com.dep` and `example.com.dep.Widget` stop at
  the module root directory.
- One directory is one package, **with no recursion**: a dependency module has a
  second entry point under `cmd/`, and pulling it in along the way would compile a
  program the import did not ask for.
- Loading is **lazy**: a module that is `require`d but missing from the cache is
  not an error until real source code imports it. The module file lists the things
  the author might need, and a build should not fail over a declaration nobody
  uses.

---

## Module cache

```
$TEYRUPATH/pkg/mod/example.com/greeting@v0.1.0/
```

`TEYRUPATH` defaults to `~/.teyru`. Fetching is a shallow clone of the module
path:

```
git clone --depth 1 --branch <version> https://<module path> <temp dir>
```

After the clone, `.git` is deleted (a module's hash is computed over source code,
not history), and the whole directory is **renamed** into the cache: a cache
entry either appears complete or does not exist, and a build reading the cache
never sees half a module.

`TEYRU_GIT_URL` replaces the `https://` prefix, for use with mirrors, `file://`
paths or a local server; Teyru does not do vanity URL lookups (Go's
`?go-get=1`), so a module on a custom domain specifies its source with that.

A version already in the cache is **never fetched again**: a given version of a
module is immutable, a second fetch could only produce a different copy, and the
checksum re-verified on every build is the proof that the first one was right.

`mod.LocalFetcher` is the network-free version of the same thing: it copies from
`<root>/<module>@<version>/`. Tests use it, and `tests/modules/fixtures` is such a
mirror.

---

## teyru.sum

Each line records one module version that has already been fetched:

```
example.com/greeting v0.1.0 h1:Q5zOZ...
example.com/greeting v0.1.0/teyru.mod h1:ujwgc...
```

The hash is Go's `dirhash.Hash1`: each file is hashed into the line
`sha256(content)  <relative path>\n`, the lines are concatenated in path order and hashed
with sha256 again, and after base64 encoding `h1:` is prepended. Directories
starting with a dot (the `.git` left behind by fetch) and symbolic links do not
count — the former is not part of the module, and the latter would let a module
pull in anything on disk.

The second kind of line records the dependency module's **own `teyru.mod`**: the
contents of that file determine which other modules are in the build list, and
changing one line of it can change the whole build without touching any source
code. It is not required to be there — the tree hash already covers that file's
bytes.

Verification happens **when a package is used**, not when dependencies are
listed. So:

| Situation | Result |
|---|---|
| In cache, present in `teyru.sum`, and the two agree | Build |
| Not in cache | `TY-IO-0102`, with `teyru get <module>@<version>` in the message |
| In cache, but `teyru.sum` has no such line | `TY-IO-0102`, requiring `teyru get` first |
| In cache, but the hash differs | `TY-IO-0103`, **stop the build** |

The last one is the only error in the whole module system that is about a
security problem: the same version, different contents. The build will not
compile something that is "not the copy the module file originally wrote down".

---

## Commands

```sh
teyru mod init example.com/myapp   # write a teyru.mod in the current directory
teyru get example.com/dep@v1.0.0   # fetch into the cache, record the checksum, write it into require
teyru mod tidy                     # make teyru.mod and teyru.sum match the source code
teyru build [paths...]             # compile to a native executable (a.out by default)
teyru run   [paths...] [-- args]   # compile and run
```

`teyru mod tidy` does three things, and **never goes online**:

- removes requires that no source code imports;
- adds modules that source code imports and that the cache can supply, using the
  highest version in the cache;
- keeps in `teyru.sum` only what the build list needs, and re-verifies the hash of
  every module it keeps.

It does **not** raise a version that is already recorded on its own initiative:
that is a decision with consequences, the source code does not show it, so it
only reports (`kept the requirement ...`). Modules the cache cannot supply are
also only reported, and their checksum line is kept — it cannot be recomputed, and
deleting it would only hide the missing fetch.

How paths are written:

| Form | Meaning |
|---|---|
| `<dir>` | the entire package tree rooted at that directory (recursive) |
| `./...` | same as above; `...` on its own is not a path |
| Omitted | the module the current directory belongs to; when not in a module, the current directory |

A directory containing `teyru.mod` is another module, and the walk stops when it
reaches one: its packages are compiled only when it is itself the subject of the
build. A `teyru build` with no path, inside a module, compiles that module.

---

## Diagnostic codes

| Code | When |
|---|---|
| `TY-IO-0101` | `teyru.mod` cannot be read or is not a module file (parse error, invalid version, unrecognized directive…). |
| `TY-IO-0102` | An import cannot find a module that can provide it, the cache does not have that version, `teyru.sum` does not have that entry, or the package directory cannot be read. |
| `TY-IO-0103` | checksum mismatch. The cached contents are not the copy `teyru.mod` originally wrote down. |
| `TY-IO-0104` | Two different package names are declared in the same directory. |

These four codes each also have a row in `docs/diagnostics.md`, giving the message
and the fix.

---

## Differences from Go

Deliberate trade-offs, not things left undone:

- **No proxy and no vanity URL lookups**. The module path is the repository URL,
  and what you fetch is what the author pushed. To mirror, use `TEYRU_GIT_URL`.
- **There is no `replace`, `exclude`, `retract` or `vendor`**; any occurrence is a
  parse error.
- **Version selection is "the highest requirement wins"**, not full MVS: the build
  list is decided only by the `teyru.mod` files that can be seen. When a module
  whose packages have already been compiled is required at a higher version by
  another dependency, `versionConflict` is reported rather than silently
  switching — one build cannot have two versions of a module at the same time.
- **The build does not go online**. Anything missing from the cache has to be
  fetched with `teyru get` yourself.
- **The main module's own packages also have import-path identities**, treated
  exactly like dependencies.

## Known limitations

- There is no `teyru mod why`, no `teyru list`, and no upgrade syntax for
  `teyru get`.
