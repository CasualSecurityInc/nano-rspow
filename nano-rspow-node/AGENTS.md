# nano-rspow-node — Agent Instructions

## Publishing

- **NEVER run `npm publish` or any equivalent command locally.** Publishing is handled exclusively by the GitHub Actions release workflow (`.github/workflows/node-publish.yml`) via OIDC Trusted Publishing.
- To release a new version, use `npm version <patch|minor|major>` inside `nano-rspow-node/`, then `git push --follow-tags`. That is the complete local workflow — nothing else.
- **NEVER suggest adding an `NPM_TOKEN` secret** to GitHub or anywhere else. Authentication to npm is done via OIDC; no token is needed or wanted.
