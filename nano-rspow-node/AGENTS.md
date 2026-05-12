# nano-rspow-node — Agent Instructions

## Publishing

- **NEVER run `npm publish` or any equivalent command locally.** Publishing is handled exclusively by the GitHub Actions release workflow (`.github/workflows/node-publish.yml`) via OIDC Trusted Publishing.
- To release a new version: run `npm version <patch|minor|major>` from inside `nano-rspow-node/`, then tag from the **repo root** and push:
  ```bash
  # from repo root
  git tag v<new-version> && git push origin v<new-version>
  ```
  `npm version` only creates a git tag when run from the git root, so the tag must be created manually when running from a subdirectory.
- **NEVER suggest adding an `NPM_TOKEN` secret** to GitHub or anywhere else. Authentication to npm is done via OIDC; no token is needed or wanted.
