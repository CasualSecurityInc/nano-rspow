#!/usr/bin/env python3
"""Verify go get and native execution from a staged module, outside the checkout."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from go_module import MODULE
from native import ROOT, version


def verify(proxy):
    with tempfile.TemporaryDirectory(prefix="nano-rspow-consumer-") as temporary:
        directory = Path(temporary)
        environment = os.environ.copy()
        for name in ["CGO_CFLAGS", "CGO_CPPFLAGS", "CGO_CXXFLAGS", "CGO_LDFLAGS", "GOFLAGS", "GONOPROXY", "GONOSUMDB", "GOPRIVATE"]:
            environment.pop(name, None)
        environment.update({
            "GOPROXY": proxy.resolve().as_uri(), "GOSUMDB": "off", "GOWORK": "off",
            "GOMODCACHE": str(directory / "modules"), "GOPATH": str(directory / "gopath"),
            "CGO_ENABLED": "1",
        })
        # There is no replace directive, no native library environment override,
        # and no sibling Rust checkout in this consumer directory.
        def go(*args):
            subprocess.run(["go", *args], cwd=directory, env=environment, check=True)
        shutil.copy2(ROOT / "scripts/release/consumer/native_test.go", directory)
        go("mod", "init", "release-consumer")
        go("get", f"{MODULE}@v{version()}")
        go("test", "-race", "-shuffle=on", "-v", "./...")
        go("test", "-race", MODULE)
        go("build", "-o", str(directory / "nano-rspow-go.exe"), MODULE + "/cmd/nano-rspow-go")
        result = subprocess.run(
            [str(directory / "nano-rspow-go.exe")], env=environment, cwd=directory,
            input="718cc2121c3e641059bc1c2cfc45666c99e8ae922f7a807b7d07b62c995d79e2:0xfe00000000000000\n",
            text=True, capture_output=True, check=True,
        )
        if len(result.stdout.strip().split(":")) != 3:
            raise SystemExit(f"Streaming CLI did not return work: {result.stdout} {result.stderr}")
        print("go get, known-vector validation, generation, race tests and streaming CLI passed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proxy", type=Path, required=True)
    args = parser.parse_args()
    verify(args.proxy)
