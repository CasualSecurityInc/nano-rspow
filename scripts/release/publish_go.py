#!/usr/bin/env python3
"""Publish the verified generated Go tree as an immutable submodule tag."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

from go_module import TARGETS
from native import ROOT, run, version


def publish(candidate):
    records = json.loads((candidate / "nano-rspow-go/native/release.json").read_text())
    if {record["target"] for record in records} != {item["target"] for item in TARGETS}:
        raise SystemExit("Refusing to publish an incomplete native module")
    source = run("git", "rev-parse", "HEAD", cwd=ROOT)
    if any(record["source_commit"] != source or record["version"] != version() for record in records):
        raise SystemExit("Candidate source/version differs from the checked-out release")
    tag = f"nano-rspow-go/v{version()}"
    with tempfile.TemporaryDirectory(prefix="nano-rspow-index-") as temporary:
        environment = os.environ.copy()
        date = run("git", "show", "-s", "--format=%cI", source, cwd=ROOT)
        environment.update({
            "GIT_INDEX_FILE": str(Path(temporary) / "index"),
            "GIT_WORK_TREE": str(candidate.resolve()),
            "GIT_DIR": run("git", "rev-parse", "--absolute-git-dir", cwd=ROOT),
            "GIT_AUTHOR_NAME": "github-actions[bot]", "GIT_COMMITTER_NAME": "github-actions[bot]",
            "GIT_AUTHOR_EMAIL": "41898282+github-actions[bot]@users.noreply.github.com",
            "GIT_COMMITTER_EMAIL": "41898282+github-actions[bot]@users.noreply.github.com",
            "GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date,
        })
        def git(*args):
            return run("git", *args, cwd=ROOT, env=environment)
        git("read-tree", source)
        git("add", "--force", "--all", "--", "nano-rspow-go")
        tree = git("write-tree")
        module_tree = git("rev-parse", f"{tree}:nano-rspow-go")
        remote = subprocess.run(["git", "ls-remote", "--exit-code", "origin", f"refs/tags/{tag}"],
                                cwd=ROOT, text=True, capture_output=True)
        if remote.returncode == 0:
            git("fetch", "--no-tags", "origin", f"refs/tags/{tag}")
            if git("rev-parse", "FETCH_HEAD:nano-rspow-go") != module_tree:
                raise SystemExit(f"Existing {tag} has different contents; never move a published Go tag")
            print(f"{tag} already published with identical contents")
            return
        if remote.returncode != 2:
            raise SystemExit(remote.stderr)
        commit = git("commit-tree", tree, "-p", source, "-m",
                     f"release(go): package native libraries for v{version()}\n\n"
                     f"Source: {source}\n\nCo-Authored-By: Codex <codex@openai.com>")
        git("push", "origin", f"{commit}:refs/tags/{tag}")
        print(f"Published {tag}: {commit}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True)
    args = parser.parse_args()
    publish(args.candidate)
