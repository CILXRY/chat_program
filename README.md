# Nebula

一个自托管的 Discord 风格聊天空间：账号登录、多频道文字聊天、实时消息、语音通话和一键屏幕共享。

技术栈：**Astro + React island + TypeScript + Tailwind CSS** · **FastAPI + SQLAlchemy + PostgreSQL** · **WebSocket + WebRTC** · **Tauri 2 + Rust（Windows 客户端）** · **Docker Compose + Caddy**。

| 文字频道 | 语音频道 |
| --- | --- |
| ![频道聊天](docs/chat.png) | ![语音频道](docs/voice.png) |

---

## 功能

- 账号注册 / 登录（JWT + httpOnly Cookie）；记住上次登录账号并支持 30 天「记住我」
- 单工作区、多文字频道 / 语音频道；管理员可修改所有频道，成员可修改自己创建的频道
- 管理员可以在设置里管理成员：提升 / 取消管理员、移除、恢复
- 个人设置：显示名称、头像颜色、修改密码；通知与消息密度偏好保存在本地
- WebSocket 实时消息、在线状态、输入中提示、断线重连补消息
- 语音频道：麦克风通话、静音、参与者状态
- 音频管线：耳机感知 AEC（检测到耳机自动减弱）、VAD 静音门 + Opus DTX、RNNoise / DeepFilterNet3 / Hush 预设降噪、AGC 自适应音量
- 屏幕共享：P2P mesh，支持同时共享画面与系统声音；桌面端使用原生 WGC 采集与 WASAPI loopback，HDR FP16 画面经 ACES tone mapping 转为 SDR
- 响应式深色 UI，桌面端三栏布局，小屏抽屉式侧栏
- Windows 桌面客户端（Tauri 2）：托盘、开机启动、全局快捷键、WGC/DXGI 原生采集、自定义音频处理、自动更新；账号设置与网页端共用
- 一条命令启动 PostgreSQL + API；开发环境由 Vite 代理 `/api` 与 `/ws`，生产环境由 Caddy 统一入口

> 语音与屏幕共享基于 P2P mesh，建议 **2–5 人**使用。需要跨公网稳定通话时请配置 TURN（见下文）。

---

## 快速开始（开发模式）

### 前置条件

- Node.js ≥ 22 与 pnpm
- Docker Desktop（含 Docker Compose）
- 可选：`uv`（本地跑测试 / Lint 时需要）

### 启动

```powershell
# 1. 可选：复制环境变量（不复制也能用默认开发配置）
Copy-Item .env.example .env

# 2. 起 PostgreSQL + FastAPI（首次会构建镜像并自动执行数据库迁移）
docker compose up -d --build

# 3. 装前端依赖
pnpm install

# 4. 起 Astro 开发服务器
pnpm dev
```

打开 <http://localhost:4321>。

首次启动会自动创建默认频道（#general、#random、语音频道 voice-lounge），并（`SEED_DEMO=true` 时）创建演示账号：

| 账号 | 密码 | 说明 |
| --- | --- | --- |
| `alice` | `nebula123` | 演示用户 A（管理员） |
| `bob` | `nebula123` | 演示用户 B，适合双窗口测试 |

API 文档：<http://localhost:8000/docs>

### 服务端口

| 服务 | 端口 |
| --- | --- |
| Astro Web | 4321 |
| FastAPI | 8000 |
| PostgreSQL | 5432 |
| 生产 Caddy HTTP | 8080 |
| 生产 Caddy HTTPS | 8443（启用 HTTPS 时） |
| 开发 Caddy HTTPS（可选） | 9443 |

### 体验屏幕共享

1. 用普通窗口登录 `alice`，进入 **voice-lounge**，点击「加入语音频道」。
2. 用无痕窗口（或另一个浏览器）登录 `bob`，进入同一个语音频道。
3. 任一方点击「共享屏幕」，选择窗口或屏幕；另一方即可看到画面。
4. 浏览器必须允许麦克风 / 屏幕录制权限；`localhost` 属于安全来源，无需 HTTPS。
5. 如果共享 HDR 屏幕时颜色发灰或明显不对：停止共享，在语音控制栏打开 **「SDR 兼容」**，然后重新共享。检测到 HDR 显示器时应用会自动转换，这个开关用于兜底。

> 只用同一浏览器的两个标签页会共享登录 Cookie，两个标签都会是同一个账号。测试双向通话请使用普通窗口 + 无痕窗口，或两个浏览器。

### 账号、权限与设置

- **首个注册账号自动成为管理员**；管理员可以提升或取消其他成员的管理员身份，但不能修改自己的角色。
- **频道权限**：管理员可修改 / 删除所有频道；普通成员只能修改 / 删除自己创建的频道。至少需要保留一个频道。
- **移除成员**：管理员可在「设置 → 成员」或成员列表里移除成员。被移除的账号会立即下线、无法登录、从成员列表隐藏，历史消息保留；可在设置里恢复。用户名会保留，不能被重新注册。
- **设置**：Web 与 Windows 客户端共用，包含账号资料（显示名称、头像颜色）、修改密码、桌面通知开关和消息密度；桌面端另有「桌面客户端」入口，可打开原生设置窗口（托盘、开机启动、快捷键、更新）。
- **快速登录**：登录页会在浏览器本地记住上次登录的用户名和头像（不保存密码），点击即可填入；勾选「记住我」后登录有效期为 30 天，否则为 1 天。

### 开发环境局域网 HTTPS（可选）

`localhost` 本身就是安全来源，不需要这一步。如果想让手机 / 另一台电脑访问开发服务器并测试麦克风和屏幕共享：

1. 在 `.env` 中填入你电脑当前的局域网 IP（不要填 `localhost`）：

   ```env
   DEV_SITE_ADDRESS=https://192.168.1.23
   DEV_DEFAULT_SNI=192.168.1.23
   DEV_HTTPS_PORT=9443
   ```

2. 保持 `pnpm dev` 运行，启动 Caddy（只用一次即可）：

   ```powershell
   docker compose --profile https up -d
   ```

3. 信任 Caddy 的开发根证书：

   ```powershell
   docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt |
     Set-Content -Encoding ascii caddy-root.crt
   ```

   把 `caddy-root.crt` 安装到客户端系统的受信任根证书。

4. 访问 <https://192.168.1.23:9443>。

Caddy 会通过 `host.docker.internal:4321` 代理到宿主机的 Astro 开发服务器，HMR、`/api` 和 `/ws` 都可正常使用。普通开发模式仍然是 <http://localhost:4321>。不要把开发服务器暴露到公网。

---

## 架构

```text
浏览器
  ├─ HTTP  ──► Astro SSR (:4321) ──服务端 fetch──► FastAPI (:8000) ──► PostgreSQL
  └─ WS    ──► /ws（Vite / Caddy 代理）──► FastAPI：聊天广播、在线状态、WebRTC 信令
       └─ WebRTC P2P：麦克风音频 + 屏幕视频/系统音频，不经过服务器转发
```

- 消息发送走 REST，写入数据库后通过 WebSocket 广播；历史消息用游标分页加载。
- 语音/屏幕共享采用 **P2P mesh**：每个参与者与其他参与者建立一条 `RTCPeerConnection`。
- 提前协商好 3 条媒体线（麦克风、屏幕视频、屏幕音频），共享开始时用 `replaceTrack()` 切换，避免反复 SDP 重协商。
- 公网环境需要 TURN 才能穿透对称 NAT；本机与局域网通常直连即可。

### 目录

```text
.
├─ apps/
│  ├─ api/                    FastAPI 服务
│  │  ├─ app/
│  │  │  ├─ api/              auth / channels / messages / users / ws
│  │  │  ├─ realtime/hub.py   WS 连接、在线状态、语音房间、信令中转
│  │  │  ├─ models.py  schemas.py  security.py  seed.py
│  │  │  └─ main.py
│  │  ├─ alembic/             数据库迁移
│  │  └─ tests/               pytest（SQLite 内存库）
│  ├─ web/                    Astro 前端
│  │  └─ src/
│  │     ├─ components/app/   App / ChatView / VoiceStage / Sidebar / settings ...
│  │     ├─ lib/              api / ws / store / rtc / screenCapture / prefs / desktop
│  │     ├─ pages/            login / register / channels/[channelId]
│  │     └─ middleware.ts     服务端鉴权与跳转
│  └─ desktop/                Tauri 2 Windows 客户端
│     ├─ src-tauri/           Rust：窗口 / 托盘 / 自启 / 快捷键 / WGC 采集 / 更新
│     │  └─ src/capture/      WGC/DXGI 视频 + WASAPI loopback + HDR tone mapping
│     ├─ ui/                  本地设置页（Vite）
│     └─ src-tauri/tauri.conf.json  NSIS 打包配置
├─ deploy/Caddyfile           生产反向代理（HTTP/HTTPS + WebSocket）
├─ deploy/Caddyfile.dev       开发环境可选 HTTPS 入口
├─ .github/workflows/         Windows 安装包发布工作流
├─ docker-compose.yml         开发：db + api（+ 可选 caddy profile）
├─ docker-compose.prod.yml    生产：db + api + web + caddy
└─ pnpm-workspace.yaml
```

---

## 配置

### 根目录 `.env`（后端 / 部署）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `POSTGRES_DB` | `nebula` | 数据库名 |
| `POSTGRES_USER` | `nebula` | 数据库用户 |
| `POSTGRES_PASSWORD` | `nebula_dev_password` | 数据库密码，生产务必修改 |
| `JWT_SECRET` | 开发占位值 | JWT 签名密钥，生产必须设置为随机长字符串 |
| `JWT_REMEMBER_DAYS` | `30` | 勾选「记住我」时的登录有效期（天） |
| `JWT_SESSION_DAYS` | `1` | 未勾选「记住我」时的登录有效期（天） |
| `SEED_DEMO` | `true`（开发）/ `false`（生产） | 是否创建 alice / bob 演示账号 |
| `COOKIE_SECURE` | `false` | 生产启用 HTTPS 后设为 `true` |
| `SITE_ADDRESS` | `:80` | Caddy 站点地址；`:80` 为纯 HTTP，填 `https://<IP>` 或域名则启用 HTTPS |
| `DEFAULT_SNI` | `localhost` | 用裸 IP 访问 HTTPS 时设为该 IP（IP 字面量不会发送 SNI） |
| `CADDY_HTTP_PORT` | `8080` | 宿主机 HTTP 端口 → Caddy 容器 80 |
| `CADDY_HTTPS_PORT` | `8443` | 宿主机 HTTPS 端口 → Caddy 容器 443 |
| `DEV_SITE_ADDRESS` | `https://localhost` | 开发环境可选 Caddy 的站点地址 |
| `DEV_DEFAULT_SNI` | `localhost` | 开发环境用裸 IP 访问 HTTPS 时设为该 IP |
| `DEV_HTTPS_PORT` | `9443` | 开发环境 Caddy HTTPS 端口 |

生成随机密钥：

```powershell
# PowerShell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

### WebRTC / TURN

客户端 ICE 配置在构建时写入前端 bundle：

- 开发：复制 `apps/web/.env.example` 为 `apps/web/.env` 后修改。
- 生产：在根目录 `.env` 设置 `PUBLIC_STUN_URL`、`PUBLIC_TURN_URL`、`PUBLIC_TURN_USERNAME`、`PUBLIC_TURN_CREDENTIAL`，然后重新构建 web 镜像。

```env
PUBLIC_STUN_URL=stun:stun.l.google.com:19302
PUBLIC_TURN_URL=turn:turn.example.com:3478
PUBLIC_TURN_USERNAME=nebula
PUBLIC_TURN_CREDENTIAL=change-me
```

TURN 推荐使用 [coturn](https://github.com/coturn/coturn) 自托管；静态凭证会出现在前端代码中，仅适合个人/小团队使用。

---

## 生产部署

```powershell
Copy-Item .env.example .env
# 编辑 .env：设置强 JWT_SECRET、数据库密码、COOKIE_SECURE / TURN（如需要）

docker compose -f docker-compose.prod.yml up -d --build
```

访问 <http://localhost:8080>。

生产栈包含：

- `caddy`：唯一入口（替代 nginx），转发 `/api`、`/ws` 与页面请求，负责 TLS
- `web`：Astro Node standalone 服务
- `api`：Uvicorn（启动前自动跑 Alembic 迁移）
- `db`：PostgreSQL，数据保存在 `db_data` volume
- `caddy_data` / `caddy_config`：Caddy 证书与配置持久化

默认访问 <http://localhost:8080>（纯 HTTP）。

### 启用 HTTPS

Caddy 会根据 `SITE_ADDRESS` 自动处理证书，WebSocket 会自动使用 `wss://`。

**局域网 / 本机（Caddy 内部 CA）**

```env
SITE_ADDRESS=https://192.168.1.23
DEFAULT_SNI=192.168.1.23
CADDY_HTTPS_PORT=8443
COOKIE_SECURE=true
```

> 浏览器访问纯 IP 时通常不发送 TLS SNI，因此用 IP 访问 HTTPS 时必须让 `DEFAULT_SNI` 等于这个 IP，否则 TLS 握手会失败。用域名访问则不需要关心它。

重新启动生产栈后访问 <https://192.168.1.23:8443>。Caddy 会使用内部 CA 签发证书，手机/其他电脑需要先信任它的根证书：

```powershell
docker compose -f docker-compose.prod.yml exec -T caddy cat /data/caddy/pki/authorities/local/root.crt |
  Set-Content -Encoding ascii caddy-root.crt
```

把 `caddy-root.crt` 安装到客户端系统的「受信任的根证书颁发机构」，然后重启浏览器。浏览器把 HTTPS 视为安全来源后，麦克风和屏幕共享才能跨设备使用。

**公网域名（Let's Encrypt 自动签证书）**

```env
SITE_ADDRESS=chat.example.com
DEFAULT_SNI=chat.example.com
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443
COOKIE_SECURE=true
```

把域名的 A/AAAA 记录指向服务器，并放行 80 / 443 端口。Caddy 会自动申请并续期证书，访问 <https://chat.example.com>。

> 修改 `.env` 后执行 `docker compose -f docker-compose.prod.yml up -d` 使配置生效。如果使用非标准 HTTPS 端口（例如局域网示例的 8443），直接访问带端口的地址即可；HTTP → HTTPS 的自动跳转使用的是标准 443，不适用于该场景。

### 常用命令

```powershell
docker compose logs -f api          # 查看 API 日志
docker compose exec api alembic upgrade head
docker compose down                 # 停止开发栈（保留数据）
docker compose down -v              # 停止并删除数据库数据（慎用）

# 生产
docker compose -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.prod.yml down
```

---

## Windows 客户端（Tauri 2）

`apps/desktop` 是一个**薄客户端**：Rust 侧负责窗口、托盘、快捷键、自动更新和原生媒体采集，WebView2 加载你已经部署的 Web 应用。它不包含 FastAPI / PostgreSQL，也不会自动启动 Docker。每个服务器地址使用独立的 WebView2 数据目录，登录态互不串联。

### 功能

- 远程服务器 / 本机地址两种模式，首次启动可测试连接
- **WGC/DXGI 原生屏幕采集**：直接打开 Windows 系统选择器，不再使用浏览器的 `getDisplayMedia` 窗口录制
- **WASAPI loopback 系统声音**：48 kHz 立体声 PCM 走本机 loopback WebSocket，随屏幕画面一起发布
- **HDR FP16 → SDR**：WGC 以 scRGB FP16 采集，Rust 侧做 ACES tone mapping、sRGB 编码、按设置画质等比缩放（默认 900p），再转换成 BT.709 I420 帧交给 WebCodecs
- **音频管线**：耳机感知 AEC、VAD 静音门 + Opus DTX、RNNoise / DeepFilterNet3 / Hush 预设、AGC
- 托盘菜单、关闭到托盘、开机启动、启动最小化
- 全局快捷键（窗口隐藏时也可用），实际生效组合显示在设置里
- 语音连接 / 他人开始共享屏幕的 Windows 通知（不做新消息通知）
- GitHub Releases 自动更新

### 开发运行

前置条件：Node.js ≥ 22、pnpm、Rust stable（MSVC 工具链）以及 Visual Studio Build Tools 的「使用 C++ 的桌面开发」。

```powershell
pnpm install
pnpm desktop:dev
```

首次打开会进入服务器设置：

- 使用本地开发服务器：`http://localhost:4321`
- 使用生产 Docker 栈：`http://localhost:8080`
- 远程部署：填写 `https://...`

客户端不负责启动 Docker；本机模式只检查 `/api/health`。Tauri 开发模式会先构建本地设置页，再启动 Vite；主窗口仍然从服务器加载 Web 应用。

### 构建安装包

```powershell
pnpm --filter @nebula/desktop typecheck
pnpm desktop:build
```

输出：

```text
apps/desktop/src-tauri/target/release/bundle/nsis/Nebula_<version>_x64-setup.exe
apps/desktop/src-tauri/target/release/nebula-desktop.exe   # 免安装快速验证
```

安装包未签名，Windows SmartScreen 会提示“未知发布者”；选择“仍要运行”即可。

### 全局快捷键

优先组合不可用时，客户端会自动尝试备选组合，设置页显示实际生效的组合：

| 操作 | 优先 | 备选 |
| --- | --- | --- |
| 静音 / 取消静音 | `Ctrl+Shift+M` | `Ctrl+Alt+M`、`Ctrl+Shift+U` |
| 显示 / 隐藏窗口 | `Ctrl+Shift+H` | `Ctrl+Alt+H` |
| 离开语音 | `Ctrl+Shift+E` | `Ctrl+Alt+E` |

如果三组静音快捷键都已被占用，设置里的状态点会变红。

### 屏幕共享、系统音频与 HDR

- 点击「共享屏幕」后由 Rust 调用 `Windows.Graphics.Capture` 的系统选择器；窗口被关闭时采集自动结束。
- 画面通过 `127.0.0.1` 上的一次性 WebSocket 送到 WebView：首帧是元数据，之后是带时间戳的 I420 帧；Web 侧优先使用 `MediaStreamTrackGenerator`，不可用时退回 canvas 轨道。屏幕内容由 WebRTC 自己的编码器负责压缩，避免在 Rust 侧做软件 JPEG。
- 系统声音使用 WASAPI 默认输出设备的 loopback 采集，事件驱动失败时自动退回轮询；没有可用输出设备时仍可共享画面。
- 当前 WebRTC 编码链路按 SDR 发送。HDR 屏幕会走 FP16 + ACES；普通 SDR 屏幕直接采集 BGRA8。
- 屏幕共享画质在「设置 → 偏好 → 屏幕共享画质」里选择 `720p / 900p / 1080p`；默认 900p，兼顾文字清晰度和 30fps。本地预览左上角会显示实测 fps，方便确认当前机器是否有余量。
- 「SDR 兼容」开关在桌面端表示强制走 FP16 tone mapping（例如自动检测不准时），下次共享生效。

### 自动更新（GitHub Releases）

- 更新源：`CILXRY/chat_program` 的 **Releases**（公开仓库）。
- GitHub Actions 工作流：`.github/workflows/desktop-release.yml`，使用 `tauri-apps/tauri-action` 构建 NSIS 安装包。
- 发布步骤：

  ```powershell
  # 1. 修改 apps/desktop/package.json 与 src-tauri/tauri.conf.json 的 version
  # 2. 提交并推送
  git push origin elegant
  # 3. 打 tag 并推送（版本号保持一致）
  git tag v0.3.0
  git push origin v0.3.0
  ```

  Actions 会构建 `Nebula_0.3.0_x64-setup.exe` 并发布到 Releases；客户端启动 25 秒后检查一次，之后每 6 小时检查。发现新版本时下载到临时目录，设置页点「重启安装」后以 `/S` 静默运行 NSIS 安装包。

- 未签名安装包仍可自动更新，但每次可能触发 SmartScreen。

### 证书与本机 HTTPS

- 自签名证书不会绕过：请把 Caddy / 服务器根证书安装到 Windows 受信任根证书。
- 局域网用 HTTPS 时，把 `https://<IP>:9443` 这类地址填进远程模式；`localhost` 的本机开发地址可直接用 HTTP。
- 非 `localhost` 的 `http://` 地址在 WebView 中可能被视为不安全来源，麦克风可能无法启用，设置页会警告。

---

## 开发与测试

```powershell
pnpm check                          # Astro + TypeScript 检查
pnpm build                          # 生产构建前端
pnpm desktop:typecheck              # Tauri 设置页类型检查
pnpm desktop:ui                     # 只构建本地设置页
pnpm desktop:build                  # Tauri 构建（含 NSIS 安装包）
cd apps/desktop/src-tauri; cargo check

cd apps/api
uv sync --all-groups
uv run pytest -q                    # API 测试（SQLite 内存库，不需要 Docker）
uv run ruff check .
uv run ruff format --check .
```

已覆盖的验证：

- 后端单测：注册/登录/登录态、频道创建与重名校验、消息发送/分页/删除权限、鉴权拦截、演示数据与欢迎消息、健康检查
- 权限与成员：首个账号成为管理员、频道改删权限、管理员提升/取消角色、成员移除后立即失效与恢复、资料与密码修改
- 双浏览器端到端：进入语音频道 → 双向音轨建立 → 静音状态同步 → Alice 共享屏幕（含系统声音）→ Bob 看到远端视频 → 停止后再次共享 → 离开语音 → 实时消息与输入中提示
- 可靠性：停掉 API → 客户端显示重连中 → 离线期间写入消息 → API 恢复后 WebSocket 自动重连，并恰好补回一次消息
- Caddy：生产 HTTP、HTTPS（内部 CA，支持局域网 IP + `default_sni`）、`wss://` 与开发环境 HMR 均实测通过
- SDR 兼容管线：强制开启后远端收到转换后的视频，停止共享与再次共享均正常
- Tauri 2：`cargo check` / debug / release 构建通过；远程 WebView 的 IPC（设置、音频设备、WGC 采集）实测可用
- 原生采集：WGC 屏幕与窗口采集、FP16 → ACES → I420、本机 WebSocket 视频/音频分流、WASAPI loopback 音频包均实测通过；900p SDR 实测 30fps，1080p HDR FP16 在测试机约 21fps（设置里可切到 900p/720p）
- 音频面板：耳机/扬声器手动覆盖会即时重启麦克风并切换 AEC；RNNoise → DeepFilterNet3 热切换实测通过
- 自动更新：已切换为 GitHub Releases 资产 + NSIS 静默安装；需发布首个 tag 后验证真实升级链路

---

## HDR 屏幕共享

WebRTC 编码链路按 SDR 发送，因此屏幕共享在采集端做一次 **HDR → SDR tone mapping**。

### 桌面端（推荐）

- WGC 请求 `Rgba16F`（scRGB 线性光），在 Rust 侧用 ACES filmic 曲线压高光，再编码为 sRGB。
- 按设置画质等比例缩放（默认 900p，最高 1080p），转换为 BT.709 limited-range I420，目标 30 fps；帧时间戳随帧发送，Web 侧直接构造 `VideoFrame`，交给 WebRTC 编码器压缩。
- 系统声音独立走 WASAPI loopback，不受画面 tone mapping 影响。
- 自动检测到 HDR 显示器（`(dynamic-range: high)`）时请求 FP16；「SDR 兼容」可强制所有共享走 FP16 tone mapping。
- 屏幕出现 `WGC 原生采集` / `HDR → SDR` 标记时，说明当前共享走了原生管线。

### 浏览器端（回退）

- 在没有 Tauri 桥接的普通浏览器中，仍使用 `getDisplayMedia`，并用 sRGB 2D canvas + `captureStream(30)` 生成 SDR 轨道。
- 浏览器端的质量取决于 Chromium 对 HDR 采集的 tone mapping；桌面端原生管线是更可控的路径。

> HDR 转换会增加一次画面拷贝，目标帧率为 30fps；只影响开启了转换的共享。

## 音频处理管线

音频在 Web Audio `AudioWorklet` 中运行，桌面端与网页端共用：

| 阶段 | 实现 | 说明 |
| --- | --- | --- |
| AEC | 浏览器原生 AEC + 输出设备策略 | 检测到耳机自动关闭/减弱；扬声器保守开启；未知设备保守开启 |
| 回声重合检测 | 麦克风/播放包络归一化互相关 | 在控制栏显示重合度；手动关闭 AEC 时可提示回声风险 |
| VAD | 自适应噪声底 + 迟滞 + hangover | 阈值可调；空闲时门限衰减 |
| ANS | RNNoise / DeepFilterNet3 WASM | RNNoise 适合持续噪声；DFN3 适合键盘、鼠标等瞬态噪声 |
| Hush 预设 | DeepFilterNet3 强隔离参数 | 针对多人背景声；原始 Hush 权重需要额外的模型适配器 |
| AGC | 目标 -20 dBFS + 平滑增益 + 软限幅 | 避免音量忽大忽小 |
| DTX | Opus `usedtx=1` | 静音时停止发送 RTP 载荷，进一步节省带宽 |

模型来源：[RNNoise](https://github.com/xiph/rnnoise)（BSD-3-Clause）与 [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet)（Apache-2.0 / MIT），WebAssembly 打包使用 [`@cc-livekit/audio-pipeline-plugin`](https://github.com/difftim/denoise-plugin)（Apache-2.0）。首次加入语音会加载约 18 MB 的降噪 WASM，之后由浏览器缓存。

## 已知限制 / 下一步

- P2P mesh 超过 ~5 人时上行带宽和 CPU 会明显上升；后续可切换 LiveKit / mediasoup SFU。
- 不支持 HDR 端到端透传；HDR 屏幕会转成 SDR 发送。
- 桌面端原生屏幕采集仅支持 Windows；普通浏览器仍回退到 `getDisplayMedia`。
- HDR 原生采集目前是 8-bit SDR 输出 + 目标 30fps；1080p HDR/FP16 在测试机上约 20fps，建议用默认 900p。如果要 4K60/HDR 透传，需要 WebRTC HDR 编码链路或原生编码器。
- 原生画面通过本机 WebSocket 传输 I420（1080p30 约 90 MB/s）；这是本机回环，不占用公网带宽。
- Hush 预设当前复用 DeepFilterNet3 的强语音隔离参数，并未打包原始 Hush 8MB 权重；接入点在 `apps/web/src/lib/audio/ans.ts`。
- 系统声音 loopback 依赖默认输出设备；没有可用输出设备时共享自动退化为纯画面。
- 暂无附件上传、消息编辑、表情回应、未读角标、私信、多工作区。
- 语音房间状态保存在单个 API 进程内存中；多实例部署需要 Redis pub/sub。
- 公网通话需要 TURN；没有 TURN 时部分网络环境下只能单向或无法建立连接。
- 同一账号多标签页共享登录态；语音按用户维度加入，建议一个账号只在一个标签页里开麦。
- 目前没有登录频率限制、审计日志或端到端加密聊天；更适合个人 / 小团队自托管，不建议直接暴露在公网大规模使用。
- Windows 客户端仅支持 x64、不带代码签名；自动更新下载的是未签名 NSIS 安装包，可能触发 SmartScreen。

---

## License

MIT
