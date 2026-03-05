# Contributing to Tandem

Thank you for your interest in contributing! This document covers how to set up the project locally and our workflow conventions.

## Development Setup

1. **Fork** the repo and clone your fork
2. Follow the setup steps in [`tandem-app/README.md`](tandem-app/README.md)
3. Create a `.env` file from `.env.example` and fill in your credentials
4. Ensure the ASL model (`tandem-app/asl/model.p`) is in place

### Running locally
```bash
cd tandem-app
npm run start:all   # starts Node.js (port 3000) + Python ASL API (port 5003)
```

## Branch Naming

| Type | Pattern | Example |
|---|---|---|
| Feature | `feat/<short-description>` | `feat/avatar-queue` |
| Bug fix | `fix/<short-description>` | `fix/duplicate-disconnect-handler` |
| Docs | `docs/<short-description>` | `docs/update-readme` |
| Chore | `chore/<short-description>` | `chore/update-gitignore` |
| Refactor | `refactor/<short-description>` | `refactor/move-server-modules` |

## Commit Style

We follow **[Conventional Commits](https://www.conventionalcommits.org/)**:

```
<type>(<optional scope>): <short summary>

[optional body — wrap at 72 chars]
[optional footer — BREAKING CHANGE, Fixes #xx, etc.]
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

### Examples
```
feat(avatar): add signing queue to prevent mid-sign interruptions
fix(server): merge duplicate disconnect event handlers
docs(readme): add troubleshooting table for common errors
chore(gitignore): add node_modules and model binary patterns
```

## Pull Requests

- Open PRs against `main`
- Keep PRs focused — one feature or fix per PR
- Describe *what* you changed and *why* in the PR description
- Smoke test locally before opening the PR:
  ```bash
  node -e "const s = require('./tandem-app/server.js')" 2>&1 || true
  ```

## Secrets Policy

- **Never commit** `.env`, service account JSON files, or API keys
- Only `.env.example` (with placeholder values) belongs in git
- The `.gitignore` already blocks `.env*` files — do not override it

## Code Style

- **JavaScript**: 2-space indentation, single quotes, semicolons
- **Python**: PEP 8, `snake_case` for functions/variables
- Add JSDoc comments for any new public functions in `server.js` or `server/`
- Add docstrings for new Python functions in `server/asl_api.py`
