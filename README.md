# CPA Key Hub

[Chinese README](README.zh-CN.md)

CPA Key Hub is a small Node.js web app for issuing CPA API keys through invite CDKs. Users claim a key from the public page, while admins manage invite CDKs and view claim records from the admin page.

Repository: [Li7777777/cpa-key-hub](https://github.com/Li7777777/cpa-key-hub)  
Docker image: `ghcr.io/li7777777/cpa-key-hub:latest`

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
```

For a quick local test without calling the CPA management API, set:

```bash
DRY_RUN=true
```

Pull the image:

```bash
docker pull ghcr.io/li7777777/cpa-key-hub:latest
```

Run the container:

```bash
docker run -d \
  --name cpa-key-hub \
  --restart unless-stopped \
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
  --env-file .env \
  -e HOST=0.0.0.0 \
  -p 10057:10057 \
  -v cpa-key-hub-data:/app/data \
  ghcr.io/li7777777/cpa-key-hub:latest
```

## Notes

- The container must listen on `0.0.0.0`; the examples above set this with `-e HOST=0.0.0.0`.
- If CPA management runs on the same Docker host but outside this container, use an address the container can reach, such as `host.docker.internal` on Docker Desktop.
- Do not commit `.env` or `data/database.json`; they contain runtime data and secrets.
