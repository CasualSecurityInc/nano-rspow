#!/usr/bin/env python3
"""Stage a self-contained Go module and a local Go proxy for release tests."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import tarfile
import tempfile
import zipfile

from native import ROOT, TARGETS, checksum, run, version

MODULE = "github.com/CasualSecurityInc/nano-rspow/nano-rspow-go"
MAX_MODULE = 500 * 1024 * 1024
MAX_GIT_FILE = 100 * 1024 * 1024


def escape(path):
    return "".join("!" + char.lower() if char.isupper() else char for char in path)


def prepare(artifacts, output, target=None):
    if output.exists():
        raise SystemExit(f"Refusing to overwrite {output}")
    module = output / "nano-rspow-go"
    shutil.copytree(ROOT / "nano-rspow-go", module,
                    ignore=shutil.ignore_patterns("native", "bin", "*.test", "go.sum"))
    shutil.copy2(ROOT / "LICENSE", module)
    for path in module.glob("cgo_*.go"):
        path.unlink()
    wrapper = module / "nano_rspow.go"
    wrapper.write_text(wrapper.read_text().replace(
        "${SRCDIR}/../nano-rspow-ffi/include", "${SRCDIR}/native/include"))
    records = []
    selected = [item for item in TARGETS if not target or item["target"] == target]
    if not selected:
        raise SystemExit(f"Unknown target: {target}")
    for item in selected:
        native_target = item["target"]
        metadata = json.loads((artifacts / f"{native_target}.json").read_text())
        if metadata["version"] != version() or metadata["ffi_abi"] != 1:
            raise SystemExit("Native version/ABI mismatch")
        suffix = ".zip" if item["goos"] == "windows" else ".tar.gz"
        name = f"nano-rspow-ffi-v{version()}-{native_target}"
        archive = artifacts / (name + suffix)
        if archive.with_name(archive.name + ".sha256").read_text() != f"{checksum(archive)}  {archive.name}\n":
            raise SystemExit(f"Checksum mismatch: {archive}")
        with tempfile.TemporaryDirectory() as temporary:
            extracted = Path(temporary)
            if suffix == ".zip":
                with zipfile.ZipFile(archive) as source:
                    for entry in source.namelist():
                        path = Path(entry)
                        if path.is_absolute() or ".." in path.parts or "\\" in entry:
                            raise SystemExit("Unsafe archive path")
                    source.extractall(extracted)
            else:
                with tarfile.open(archive) as source:
                    source.extractall(extracted, filter="data")
            directory = extracted / name
            if json.loads((directory / "release.json").read_text()) != metadata:
                raise SystemExit("Archive metadata differs from matrix metadata")
            native = module / "native" / f'{item["goos"]}_{item["goarch"]}'
            native.mkdir(parents=True)
            shutil.copy2(directory / "libnano_rspow_ffi.a", native)
            include = module / "native/include"
            include.mkdir(exist_ok=True)
            header = (directory / "nano_rspow_ffi.h").read_bytes()
            if (include / "nano_rspow_ffi.h").exists() and (include / "nano_rspow_ffi.h").read_bytes() != header:
                raise SystemExit("Header mismatch between targets")
            (include / "nano_rspow_ffi.h").write_bytes(header)
        flags = metadata["static_link_flags"]
        (module / f'cgo_{item["goos"]}_{item["goarch"]}.go').write_text(
            f'//go:build {item["goos"]} && {item["goarch"]}\n\npackage nanorspow\n\n/*\n'
            f'#cgo LDFLAGS: ${{SRCDIR}}/native/{item["goos"]}_{item["goarch"]}/libnano_rspow_ffi.a {flags}\n'
            '*/\nimport "C"\n')
        records.append(metadata)
    if len({r["source_commit"] for r in records}) != 1:
        raise SystemExit("Artifacts came from different commits")
    (module / "native/release.json").write_text(json.dumps(records, indent=2) + "\n")
    files = [path for path in module.rglob("*") if path.is_file()]
    if sum(path.stat().st_size for path in files) > MAX_MODULE:
        raise SystemExit("Generated module exceeds Go's 500 MiB uncompressed limit")
    if any(path.stat().st_size > MAX_GIT_FILE for path in files):
        raise SystemExit("Native file exceeds GitHub's 100 MiB file limit")
    tag = "v" + version()
    proxy = output / "proxy" / escape(MODULE) / "@v"
    proxy.mkdir(parents=True)
    (proxy / f"{tag}.mod").write_bytes((module / "go.mod").read_bytes())
    timestamp = run("git", "show", "-s", "--format=%ct", records[0]["source_commit"], cwd=ROOT)
    date = datetime.fromtimestamp(int(timestamp), timezone.utc).isoformat().replace("+00:00", "Z")
    (proxy / f"{tag}.info").write_text(json.dumps({"Version": tag, "Time": date}) + "\n")
    (proxy / "list").write_text(tag + "\n")
    destination = proxy / f"{tag}.zip"
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(files):
            archive.write(path, f"{MODULE}@{tag}/{path.relative_to(module).as_posix()}")
    if destination.stat().st_size > MAX_MODULE:
        raise SystemExit("Generated module exceeds Go's 500 MiB zip limit")
    print(output.resolve())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, default=ROOT / "dist/native")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--target", help="Stage only this target for matrix testing")
    args = parser.parse_args()
    prepare(args.artifacts.resolve(), args.output.resolve(), args.target)
