# Native CLI and Go releases

`native-release.yml` builds the CLI and the C ABI in release mode on native
runners for macOS arm64/amd64, Linux arm64/amd64, and Windows amd64. Windows
uses `x86_64-pc-windows-gnu` so the static library links with cgo's MinGW-w64
GCC compiler. Linux artifacts require glibc compatible with Ubuntu 24.04;
they are not musl builds. macOS artifacts target macOS 11 or later.

Pull requests changing this workflow, its scripts, Go bindings, or the C ABI
run the full build and consumer matrix. Manual workflow dispatch also runs a
dry run. Neither publishes anything. Only a root version-tag push publishes.

## Release contents

Each target produces a CLI archive and an FFI archive (`.tar.gz` on Unix,
`.zip` on Windows), with a `.sha256` file for each archive. The FFI archive
contains its static library, shared library, C header, license, and
`release.json`. The CLI archive contains the executable, license, and metadata.

The combined release includes `SHA256SUMS`, the standalone C header, and
release notes recording the source commit, Rust version, work protocol
`work_1`, and the actual FFI ABI returned by the compiled library. There is
no separate numeric work-server ABI; its compatibility identifier is `work_1`.

The workflow rejects missing targets, checksum mismatches, inconsistent source
commits or versions, and unexpected native ABI versions.

## Go module publication

A root release `v<version>` also produces the generated tag
`nano-rspow-go/v<version>`. Its commit has the source release as its parent and
adds the five static libraries and header to the module, with cgo directives
selected by the normal Go target. Libraries stay out of `main`.

The libraries' system-linker flags come from Rust's `native-static-libs`
output. Each archive must fit GitHub's 100 MiB file limit and the whole module
must fit Go's 500 MiB compressed and uncompressed module limits.

Before publication, each of the five native runners downloads the exact
assembled module through a temporary file-based Go proxy. A fresh consumer
runs `go get`, tests the known Nano vector and generation/validation, runs the
module's tests with the race detector, and builds/runs its streaming CLI.
There are no `replace` directives, native-library environment overrides, or
Rust build steps in this consumer verification. The local proxy test disables
the public checksum database because the candidate is not published yet;
normal users keep Go's default proxy and checksum verification.

The generated tag is immutable. Reruns accept an existing tag only if its Go
module tree is identical. Publishing uses the workflow's `GITHUB_TOKEN` with
`contents: write`; no extra publishing secret is needed.

## Running checks locally

From the repository root, substituting your native Rust target:

```sh
cargo build --locked --release --target aarch64-apple-darwin -p nano-rspow-cli -p nano-rspow-ffi
python3 scripts/release/native.py package --target aarch64-apple-darwin
python3 scripts/release/go_module.py --target aarch64-apple-darwin --output dist/go-local
python3 scripts/release/verify_go.py --proxy dist/go-local/proxy
python3 -m unittest discover -s scripts/release -p 'test_*.py'
```

Packaging requires Python 3.12 or later. Use a fresh output directory for each
Go candidate. Without `--target`, Go assembly requires all five native
artifact sets. Unit tests use temporary local Git repositories to exercise
immutable-tag publication; they never push to the project's remote.

## Publishing

First run the full workflow in a pull request or through manual dispatch and
inspect all five consumer results. Bump the workspace using
`node scripts/bump-version.js`, run `cargo check --all-targets`, and commit the
release version before creating and pushing the root `v<version>` tag.

The native workflow then publishes the verified Go tag and attaches the CLI
and FFI archives to the root GitHub release. An existing GitHub release is
reused. A failed matrix publishes neither the Go tag nor native release assets.
Other registry workflows still follow their own version gates.
