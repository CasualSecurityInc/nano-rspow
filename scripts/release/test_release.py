"""Release integrity tests; no network access or public publication."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import native
import publish_go


class ReleaseIntegrityTests(unittest.TestCase):
    def test_ci_color_sequences_never_reach_cgo_linker_flags(self):
        diagnostics = "\x1b[1mnote\x1b[0m: native-static-libs: -ldl -lpthread -lc\x1b[0m\n"
        with patch.object(native.subprocess, "run", return_value=subprocess.CompletedProcess(
                [], 0, stdout="", stderr=diagnostics)):
            self.assertEqual(native.static_link_flags("test-target"), "-ldl -lpthread -lc")

    def test_incomplete_matrix_cannot_be_released(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(FileNotFoundError):
                native.aggregate(Path(temporary))

    def test_archive_checksum_is_verified_before_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = native.run("git", "rev-parse", "HEAD", cwd=native.ROOT)
            for target in native.TARGETS:
                (directory / (target["target"] + ".json")).write_text(json.dumps({
                    **target, "version": native.version(), "ffi_abi": 1,
                    "source_commit": source, "rustc": "test compiler",
                }))
                for kind in ["nano-rspow", "nano-rspow-ffi"]:
                    suffix = ".zip" if target["goos"] == "windows" else ".tar.gz"
                    archive = directory / f'{kind}-v{native.version()}-{target["target"]}{suffix}'
                    archive.write_bytes(b"archive data")
                    archive.with_name(archive.name + ".sha256").write_text(
                        f"{native.checksum(archive)}  {archive.name}\n")
            native.aggregate(directory)
            archive.write_bytes(b"tampered")
            with self.assertRaisesRegex(SystemExit, "Checksum mismatch"):
                native.aggregate(directory)

    def test_generated_tag_is_immutable_and_leaves_source_index_untouched(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repository = root / "source"
            remote = root / "origin.git"
            repository.mkdir()
            subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
            subprocess.run(["git", "init", str(repository)], check=True, capture_output=True)
            def git(*args):
                return native.run("git", *args, cwd=repository)
            git("config", "user.name", "Release test")
            git("config", "user.email", "release-test@example.invalid")
            git("remote", "add", "origin", str(remote))
            (repository / "Cargo.toml").write_bytes((native.ROOT / "Cargo.toml").read_bytes())
            (repository / "nano-rspow-go").mkdir()
            (repository / "nano-rspow-go/source.txt").write_text("source only\n")
            git("add", ".")
            git("commit", "-m", "test fixture\n\nCo-Authored-By: Codex <codex@openai.com>")
            source = git("rev-parse", "HEAD")
            candidate = root / "candidate"
            module = candidate / "nano-rspow-go"
            (module / "native").mkdir(parents=True)
            records = [{**target, "source_commit": source, "version": native.version()} for target in native.TARGETS]
            (module / "native/release.json").write_text(json.dumps(records))
            (module / "native/library.a").write_bytes(b"native test fixture")
            (module / "source.txt").write_text("generated release\n")
            initial_index = git("write-tree")
            with patch.object(publish_go, "ROOT", repository), contextlib.redirect_stdout(io.StringIO()):
                publish_go.publish(candidate)
                publish_go.publish(candidate)  # identical reruns are safe
                self.assertEqual(git("rev-parse", "HEAD"), source)
                self.assertEqual(git("write-tree"), initial_index)
                self.assertEqual(git("status", "--porcelain"), "")
                (module / "source.txt").write_text("changed release\n")
                with self.assertRaisesRegex(SystemExit, "never move"):
                    publish_go.publish(candidate)


if __name__ == "__main__":
    unittest.main()
