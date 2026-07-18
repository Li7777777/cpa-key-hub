# CPA Key Hub

[![Docker](https://img.shields.io/github/actions/workflow/status/Li7777777/cpa-key-hub/docker-publish.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=Docker)](https://github.com/Li7777777/cpa-key-hub/actions/workflows/docker-publish.yml)
[![GHCR](https://img.shields.io/badge/GHCR-latest-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/Li7777777/cpa-key-hub/pkgs/container/cpa-key-hub)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=nodedotjs&logoColor=white)
[![Last commit](https://img.shields.io/github/last-commit/Li7777777/cpa-key-hub?branch=main&style=flat-square&logo=git&logoColor=white)](https://github.com/Li7777777/cpa-key-hub/commits/main)
[![GitHub stars](https://img.shields.io/github/stars/Li7777777/cpa-key-hub?style=flat-square&logo=github)](https://github.com/Li7777777/cpa-key-hub/stargazers)
[![LINUX DO - Where possible begins](.github/assets/linux-do-community-badge.svg)](https://linux.do)

[中文 README](README.zh-CN.md)

CPA Key Hub is a small Node.js web app for issuing CPA API keys through invite CDKs. Users claim a key from the public page, while admins manage invite CDKs and view claim records from the admin page.

Docker image: `ghcr.io/li7777777/cpa-key-hub:latest`

## Screenshots

### Claim page

![CPA Key Hub claim page](.github/assets/screenshots/claim-page.png)

### Admin dashboard

![CPA Key Hub admin dashboard](.github/assets/screenshots/admin-dashboard.png)

## Pages

- User claim page: `/`
- Success page: `/success.html`
- Admin page: `/admin.html`

## Run with Docker

Create an `.env` file on your server:

```bash
ADMIN_CDK=change-this-admin-cdk
CPA_MANAGEMENT_BASE_URL=http://host.docker.internal:10059/v0/management
CPA_MANAGEMENT_KEY=change-this-management-key
API_KEY_PREFIX=sk-cpa-
DRY_RUN=false
ADMIN_SESSION_HOURS=12
TRUST_PROXY=false
```

Replace `ADMIN_CDK` before starting. When `DRY_RUN=false`, also replace `CPA_MANAGEMENT_KEY`. The server refuses to start when a required secret is missing or still uses an example value.

For a quick local test without calling the CPA management API, set:

```bash
DRY_RUN=true
```

Brute-force protection is enabled in memory: 10 failed invite-CDK attempts within 10 minutes lock that client for 15 minutes, while 5 failed admin-CDK attempts lock it for 30 minutes. Set `TRUST_PROXY=true` only when requests always pass through a trusted reverse proxy that overwrites `X-Forwarded-For`.

No invite CDK is enabled by default. Sign in to the admin page and create a unique CDK before accepting claims. Existing `DEMO-CDK-001` entries are disabled automatically at startup.

Pull the image:

```bash
docker pull ghcr.io/li7777777/cpa-key-hub:latest
```

Run the container:

```bash
docker run -d \
  --name cpa-key-hub \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  --env-file .env \
  -e HOST=0.0.0.0 \
  -p 10057:10057 \
  -v cpa-key-hub-data:/app/data \
  ghcr.io/li7777777/cpa-key-hub:latest
```

Open:

```text
http://<your-server-ip>:10057
```

The volume `cpa-key-hub-data` stores CDKs and claim records. Keep it mounted when you recreate or upgrade the container.

## Docker Compose

You can also run it with Compose:

```yaml
services:
  cpa-key-hub:
    image: ghcr.io/li7777777/cpa-key-hub:latest
    container_name: cpa-key-hub
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
    env_file:
      - .env
    environment:
      HOST: 0.0.0.0
    ports:
      - "10057:10057"
    volumes:
      - cpa-key-hub-data:/app/data

volumes:
  cpa-key-hub-data:
```

Start it:

```bash
docker compose up -d
```

## Common commands

View logs:

```bash
docker logs -f cpa-key-hub
```

Stop the container:

```bash
docker stop cpa-key-hub
```

Start it again:

```bash
docker start cpa-key-hub
```

Upgrade to the latest image:

```bash
docker pull ghcr.io/li7777777/cpa-key-hub:latest
docker rm -f cpa-key-hub
docker run -d \
  --name cpa-key-hub \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  --env-file .env \
  -e HOST=0.0.0.0 \
  -p 10057:10057 \
  -v cpa-key-hub-data:/app/data \
  ghcr.io/li7777777/cpa-key-hub:latest
```

## Notes

- The container must listen on `0.0.0.0`; the examples above set this with `-e HOST=0.0.0.0`.
- If CPA management runs on the same Docker host but outside this container, use an address the container can reach. The examples map `host.docker.internal` to the Docker host with `--add-host=host.docker.internal:host-gateway`.
- Do not commit `.env` or `data/database.json`; they contain runtime data and secrets.
