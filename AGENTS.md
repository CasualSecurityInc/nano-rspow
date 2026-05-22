# Agent Instructions — nano-rspow

This file contains critical, unavoidable rules that all AI coding agents working on this repository **MUST** follow at all times.

## 1. Version Bumping Rules

*   **NEVER edit version numbers in `.json` or `.toml` files manually.**
*   All workspace version bumps must be performed exclusively using the version bumper script at the repository root:
    ```bash
    node scripts/bump-version.js <patch|minor|major|new-version>
    ```
    This ensures that versions across `Cargo.toml`, `nano-rspow-node/package.json`, and `nano-rspow-web/package.json` remain perfectly synchronized.
*   After running the script, always execute `cargo check --all-targets` to update internal lockfiles and verify consistency before committing.

## 2. Package Publishing Rules (Node.js)

*   **NEVER run `npm publish` or any equivalent command locally.** Publishing is handled exclusively by the GitHub Actions release workflow (`.github/workflows/node-publish.yml`) via OIDC Trusted Publishing.
*   **NEVER suggest adding an `NPM_TOKEN` secret** to GitHub or anywhere else. Authentication to npm is done via OIDC; no token is needed or wanted.
*   To trigger a release for a new version: run the version bumper script, create a tag from the **repo root**, and push it:
    ```bash
    git tag v<new-version>
    git push origin v<new-version>
    ```
