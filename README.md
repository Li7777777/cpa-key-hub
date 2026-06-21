# CPA Key Hub

[中文 README](README.zh-CN.md)

CPA Key Hub is a small Node.js web app for issuing CPA API keys through invite CDKs. A user enters an invite code and nickname, receives an API key, and the admin page keeps the CDK list and claim records in one place.

The app is intentionally simple: one Node.js server, static pages under `public/`, and a local JSON database at `data/database.json`.

## Features

- User claim page at `/`
- Success page at `/success.html`
- Admin page at `/admin.html`
- Invite CDK creation, enable/disable, deletion, and usage limits
- Claim records with IP, time, CDK, nickname, and masked key preview
- Dry-run mode for local testing without writing to CPA
- Dockerfile and GitHub Actions workflow for publishing images to GHCR

## Requirements

- Node.js 18 or newer
- npm
- Docker, if you want to build or run the container image

## Run locally

Create a local environment file first:

```bash
cp .env.example .env
```

Edit `.env`, then start the app:

```bash
npm start
```

The default address is:

```text
http://127.0.0.1:10057
```

## Configuration

The app reads `.env` from the project root. Environment variables with the same names override values from `.env`.

| Variable                  | Default                                | Description                                                               |
| ------------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| `HOST`                    | `127.0.0.1`                            | Address the HTTP server binds to. Use `0.0.0.0` inside Docker.            |
| `PORT`                    | `10057`                                | HTTP server port.                                                         |
| `ADMIN_CDK`               | empty                                  | CDK used to sign in to the admin page.                                    |
| `CPA_MANAGEMENT_BASE_URL` | `http://localhost:10059/v0/management` | CPA management API base URL.                                              |
| `CPA_MANAGEMENT_KEY`      | empty                                  | Bearer token used when calling the CPA management API.                    |
| `API_KEY_PREFIX`          | `sk-cpa-`                              | Prefix used for generated demo keys in dry-run mode.                      |
| `DRY_RUN`                 | `true`                                 | When `true`, the app generates local demo keys instead of writing to CPA. |
| `ADMIN_SESSION_HOURS`     | `12`                                   | Admin session lifetime in hours.                                          |

Example `.env`:

```bash
HOST=127.0.0.1
PORT=10057
ADMIN_CDK=your-admin-cdk
CPA_MANAGEMENT_BASE_URL=http://localhost:10059/v0/management
CPA_MANAGEMENT_KEY=your-cpa-management-key
API_KEY_PREFIX=sk-cpa-
DRY_RUN=false
ADMIN_SESSION_HOURS=12
```

Do not commit your real `.env` file.

## Docker

Build the image locally:

```bash
docker build -t cpa-key-hub:local .
```

Run it:

```bash
docker run -d --name cpa-key-hub \
  --env-file .env \
  -e HOST=0.0.0.0 \
  -p 10057:10057 \
  -v cpa-key-hub-data:/app/data \
  cpa-key-hub:local
```

The `HOST=0.0.0.0` override matters. If the container listens on `127.0.0.1`, the mapped port will not be reachable from the host.

The app stores CDKs and claim records in `/app/data`, so mount a volume there if you want the data to survive container upgrades.

## GitHub image publishing

The repository includes `.github/workflows/docker-publish.yml`. On pushes to `main` or `master`, and on version tags such as `v1.0.0`, GitHub Actions builds the Docker image and publishes it to GitHub Container Registry.

Image tags look like this:

```text
ghcr.io/<github-user>/<repo>:latest
ghcr.io/<github-user>/<repo>:sha-<commit>
ghcr.io/<github-user>/<repo>:<version>
```

First push to GitHub:

```bash
git init
git branch -M main
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<github-user>/<repo>.git
git push -u origin main
```

Publish a version image:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Run the image published by GitHub Actions:

```bash
docker run -d --name cpa-key-hub \
  --env-file .env \
  -e HOST=0.0.0.0 \
  -p 10057:10057 \
  -v cpa-key-hub-data:/app/data \
  ghcr.io/<github-user>/<repo>:latest
```

If the workflow cannot push packages, open the GitHub repository settings and enable read/write workflow permissions under `Settings -> Actions -> General -> Workflow permissions`.

## Systemd

The `scripts/` directory contains helper scripts for running the app as a systemd service.

Install and start the service:

```bash
chmod +x scripts/*.sh
sh scripts/install-systemd.sh
```

Manage the service:

```bash
sh scripts/start-systemd.sh
sh scripts/stop-systemd.sh
sh scripts/restart-systemd.sh
```

View logs:

```bash
journalctl -u cpa-key-hub -f
```

## Data and secrets

The app ignores local runtime files by default:

- `.env`
- `.env.local`
- `data/database.json`
- `node_modules/`
- `*.log`

Keep production secrets outside Git. Use environment variables, an `.env` file on the server, or your deployment platform's secret manager.
