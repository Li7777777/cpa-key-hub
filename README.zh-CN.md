# CPA Key Hub

[English README](README.md)

CPA Key Hub 是一个轻量 Node.js 分发页面，用邀请码 CDK 为用户创建 CPA API Key。用户输入邀请码和昵称后领取密钥，管理员可以在后台维护 CDK，并查看领取记录。

项目结构很简单：一个 Node.js 服务、`public/` 下的静态页面，以及保存在 `data/database.json` 的本地 JSON 数据库。

## 功能

- 用户领取页：`/`
- 创建成功页：`/success.html`
- 管理端：`/admin.html`
- 新增、启停、删除 CDK，并设置使用次数
- 查看领取记录，包括 IP、时间、使用的 CDK、用户昵称和密钥预览
- 支持 dry-run 模式，方便本地测试，不会写入 CPA
- 已配置 Dockerfile 和 GitHub Actions，可自动发布镜像到 GHCR

## 环境要求

- Node.js 18 或更新版本
- npm
- Docker，如果需要构建或运行容器镜像

## 本地启动

先创建本地配置文件：

```bash
cp .env.example .env
```

编辑 `.env` 后启动服务：

```bash
npm start
```

默认访问地址：

```text
http://127.0.0.1:10057
```

## 配置

服务会读取项目根目录下的 `.env`。同名环境变量会覆盖 `.env` 中的配置。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP 服务监听地址。Docker 内请使用 `0.0.0.0`。 |
| `PORT` | `10057` | HTTP 服务端口。 |
| `ADMIN_CDK` | 空 | 管理端登录 CDK。 |
| `CPA_MANAGEMENT_BASE_URL` | `http://localhost:10059/v0/management` | CPA 管理 API 地址。 |
| `CPA_MANAGEMENT_KEY` | 空 | 调用 CPA 管理 API 时使用的 Bearer token。 |
| `API_KEY_PREFIX` | `sk-cpa-` | dry-run 模式下生成演示密钥时使用的前缀。 |
| `DRY_RUN` | `true` | 为 `true` 时只生成本地演示密钥，不写入 CPA。 |
| `ADMIN_SESSION_HOURS` | `12` | 管理端登录会话有效时长，单位为小时。 |

示例 `.env`：

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

不要把真实 `.env` 提交到 Git。

## Docker

本地构建镜像：

```bash
docker build -t cpa-key-hub:local .
```

运行容器：

```bash
docker run -d --name cpa-key-hub \
  --env-file .env \
  -e HOST=0.0.0.0 \
  -p 10057:10057 \
  -v cpa-key-hub-data:/app/data \
  cpa-key-hub:local
```

这里的 `HOST=0.0.0.0` 很重要。如果容器内仍监听 `127.0.0.1`，宿主机无法通过端口映射访问服务。

CDK 和领取记录保存在 `/app/data`。生产环境建议挂载 volume，避免容器更新后数据丢失。

## GitHub 自动发布镜像

仓库内已配置 `.github/workflows/docker-publish.yml`。推送到 `main` 或 `master`，或者推送 `v1.0.0` 这类版本 tag 时，GitHub Actions 会自动构建 Docker 镜像并发布到 GitHub Container Registry。

镜像 tag 示例：

```text
ghcr.io/<github用户名>/<仓库名>:latest
ghcr.io/<github用户名>/<仓库名>:sha-<commit>
ghcr.io/<github用户名>/<仓库名>:<version>
```

首次上传到 GitHub：

```bash
git init
git branch -M main
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<github用户名>/<仓库名>.git
git push -u origin main
```

发布版本镜像：

```bash
git tag v1.0.0
git push origin v1.0.0
```

在服务器上运行 GitHub Actions 发布的镜像：

```bash
docker run -d --name cpa-key-hub \
  --env-file .env \
  -e HOST=0.0.0.0 \
  -p 10057:10057 \
  -v cpa-key-hub-data:/app/data \
  ghcr.io/<github用户名>/<仓库名>:latest
```

如果 workflow 推送镜像时报权限错误，到 GitHub 仓库的 `Settings -> Actions -> General -> Workflow permissions` 中开启读写权限。

## Systemd

`scripts/` 目录里提供了 systemd 辅助脚本。

安装并启动服务：

```bash
chmod +x scripts/*.sh
sh scripts/install-systemd.sh
```

启动、停止、重启：

```bash
sh scripts/start-systemd.sh
sh scripts/stop-systemd.sh
sh scripts/restart-systemd.sh
```

查看日志：

```bash
journalctl -u cpa-key-hub -f
```

## 数据和密钥

项目默认忽略这些本地运行文件：

- `.env`
- `.env.local`
- `data/database.json`
- `node_modules/`
- `*.log`

生产密钥不要放进 Git。可以使用服务器上的 `.env`、环境变量，或部署平台提供的密钥管理功能。
