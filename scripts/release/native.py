#!/usr/bin/env python3
"""Build, package, and verify the native release matrix (no publishing)."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[2]
TARGETS = [
    {"os": "macos-15-intel", "target": "x86_64-apple-darwin", "goos": "darwin", "goarch": "amd64"},
    {"os": "macos-15", "target": "aarch64-apple-darwin", "goos": "darwin", "goarch": "arm64"},
    {"os": "ubuntu-24.04", "target": "x86_64-unknown-linux-gnu", "goos": "linux", "goarch": "amd64"},
    {"os": "ubuntu-24.04-arm", "target": "aarch64-unknown-linux-gnu", "goos": "linux", "goarch": "arm64"},
    {"os": "windows-2025", "target": "x86_64-pc-windows-gnu", "goos": "windows", "goarch": "amd64"},
]


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def version():
    return tomllib.loads((ROOT / "Cargo.toml").read_text())["workspace"]["package"]["version"]


def checksum(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def archive(directory, destination):
    if destination.suffix == ".zip":
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as output:
            for path in sorted(directory.rglob("*")):
                if path.is_file():
                    output.write(path, path.relative_to(directory.parent))
    else:
        with tarfile.open(destination, "w:gz") as output:
            output.add(directory, arcname=directory.name)
    destination.with_name(destination.name + ".sha256").write_text(
        f"{checksum(destination)}  {destination.name}\n"
    )


def static_link_flags(target):
    flags = subprocess.run(
        ["cargo", "rustc", "--locked", "--release", "--target", target,
         "-p", "nano-rspow-ffi", "--", "--print", "native-static-libs"],
        cwd=ROOT, text=True, capture_output=True, check=True,
        env={**os.environ, "CARGO_TERM_COLOR": "never"},
    )
    # CI may force colored compiler diagnostics. Never put ANSI escapes into
    # generated #cgo directives, even if a tool ignores CARGO_TERM_COLOR.
    diagnostics = re.sub(r"\x1b\[[0-9;]*m", "", flags.stderr)
    match = re.search(r"native-static-libs: (.+)", diagnostics)
    if not match:
        raise SystemExit("Rust did not report the static library's system dependencies")
    return match.group(1).strip()


def package(target, output):
    settings = next(item for item in TARGETS if item["target"] == target)
    windows = settings["goos"] == "windows"
    release = ROOT / "target" / target / "release"
    dynamic = "nano_rspow_ffi.dll" if windows else ("libnano_rspow_ffi.dylib" if settings["goos"] == "darwin" else "libnano_rspow_ffi.so")
    link_flags = static_link_flags(target)
    # Load only after rustc finishes: Windows cannot replace a loaded DLL.
    library = ctypes.CDLL(str(release / dynamic))
    library.nano_rspow_abi_version.restype = ctypes.c_uint32
    metadata = {
        **settings, "version": version(), "ffi_abi": library.nano_rspow_abi_version(),
        "work_protocol": "work_1", "rustc": run("rustc", "--version"),
        "source_commit": run("git", "rev-parse", "HEAD", cwd=ROOT),
        "static_link_flags": link_flags,
    }
    if metadata["ffi_abi"] != 1:
        raise SystemExit("Unexpected native ABI: update the release verifier before publishing")
    suffix = ".zip" if windows else ".tar.gz"
    output.mkdir(parents=True, exist_ok=True)
    stage = output / "staging"
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir()
    for kind, files in {
        "nano-rspow": [release / ("nano-rspow.exe" if windows else "nano-rspow")],
        "nano-rspow-ffi": [release / "libnano_rspow_ffi.a", release / dynamic, ROOT / "nano-rspow-ffi/include/nano_rspow_ffi.h"]
            + ([release / "libnano_rspow_ffi.dll.a"] if windows else []),
    }.items():
        name = f"{kind}-v{version()}-{target}"
        directory = stage / name
        directory.mkdir(parents=True, exist_ok=True)
        for source in files:
            shutil.copy2(source, directory)
        shutil.copy2(ROOT / "LICENSE", directory)
        (directory / "release.json").write_text(json.dumps(metadata, indent=2) + "\n")
        archive(directory, output / (name + suffix))
    (output / f"{target}.json").write_text(json.dumps(metadata, indent=2) + "\n")
    shutil.rmtree(stage)


def aggregate(directory):
    records = [json.loads((directory / f'{item["target"]}.json').read_text()) for item in TARGETS]
    for record in records:
        if (record["version"] != version() or record["ffi_abi"] != 1
                or record["source_commit"] != run("git", "rev-parse", "HEAD", cwd=ROOT)):
            raise SystemExit("Release version/ABI mismatch")
    archives = sorted([*directory.glob("*.tar.gz"), *directory.glob("*.zip")])
    if len(archives) != 2 * len(TARGETS):
        raise SystemExit("Incomplete CLI/native artifact matrix")
    lines = []
    for path in archives:
        expected = f"{checksum(path)}  {path.name}\n"
        if path.with_name(path.name + ".sha256").read_text() != expected:
            raise SystemExit(f"Checksum mismatch: {path.name}")
        lines.append(expected)
    (directory / "SHA256SUMS").write_text("".join(lines))
    header = directory / "nano_rspow_ffi.h"
    shutil.copy2(ROOT / "nano-rspow-ffi/include/nano_rspow_ffi.h", header)
    with (directory / "SHA256SUMS").open("a") as output:
        output.write(f"{checksum(header)}  {header.name}\n")
    notes = [f"Native release {version()}", "", f'Source commit: `{records[0]["source_commit"]}`.', "", "Work-server protocol: `work_1`. Native FFI ABI: `1`.", "", "| Target | Rust compiler |", "| --- | --- |"]
    notes += [f'| {r["target"]} | {r["rustc"]} |' for r in records]
    notes += ["", "CLI archives contain nano-rspow. FFI archives contain the static library, shared library, C header and build metadata.", "", "Verify downloads with `sha256sum -c SHA256SUMS` (or `shasum -a 256 -c SHA256SUMS` on macOS).", ""]
    notes += [f"Go module: `go get github.com/CasualSecurityInc/nano-rspow/nano-rspow-go@v{version()}`.",
              f"The generated `nano-rspow-go/v{version()}` tag contains the five native static libraries; main remains source-only.", ""]
    (directory / "release-notes.md").write_text("\n".join(notes))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["matrix", "package", "aggregate"])
    parser.add_argument("--target")
    parser.add_argument("--output", type=Path, default=ROOT / "dist/native")
    args = parser.parse_args()
    if args.command == "matrix":
        print(json.dumps({"include": TARGETS}))
    elif args.command == "package":
        package(args.target, args.output.resolve())
    else:
        aggregate(args.output.resolve())
