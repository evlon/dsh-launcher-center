# Harness 中心管理（dsh-launcher-center）

DeepSeek Harness 企业**中心管理服务端**（从 `deepseek-harness-launcher` 仓库拆出的独立项目）。
内网服务器部署一个实例，向各同事办公电脑上的 DeepSeek Harness Launcher（客户端托盘）
下发「插件策略 + 托盘菜单策略 + 客户端默认配置」，并收集每台客户端的插件详情、菜单、配置状态；
管理员在 Web 管理控制台统一配置，客户端自动执行（管理员配好、小白即用）。

> **仓库定位**：本仓库只含中心服务端 + 管理页，与客户端（`deepseek-harness-launcher` 托盘）解耦。
> 两仓通过 HTTP API 通信（客户端配置 `serverUrl` 指向本服务），各自独立发版部署。

## 快速开始

```bash
cd dsh-launcher-center
node server.js --port 8080 --token 你的管理口令
```

- **零依赖**：纯 Node.js（`node:http`/`node:fs`/`node:path`），Linux / Windows / macOS 均可运行，
  无任何 npm 依赖，只要 Node.js ≥ 18。
- 默认数据目录 `./data`（可用 `--data <dir>` 指定）；`config.json` 与 `clients/` 自动创建。
- 建议部署在 Linux 服务器：`nohup node server.js --port 8080 --token xxx &` 或配 systemd 常驻；
  Windows 可用 pm2 管理。
- 浏览器打开 `http://<服务器IP>:8080/admin` 即可管理（首次输入 token，存于 localStorage）。

## 端点

| 端点 | 方法 | 用途 | 鉴权 |
|---|---|---|---|
| `/api/config` | GET | 客户端拉取插件策略 + 菜单策略 + 默认配置 | 无 |
| `/api/config` | POST | 管理员保存策略（plugins + managedMenu + clientDefaults + mirrorSettings） | `X-Admin-Token` |
| `/api/plugins/meta` | GET | 查询插件元信息（描述/最新版/主页，registry 拉取带缓存，`force=1` 绕过） | 无 |
| `/api/sync` | POST | 客户端上报插件详情/菜单/配置状态 | 无 |
| `/api/status` | GET | 查看所有客户端完整状态 | `X-Admin-Token` |
| `/api/mirror/packages` | GET/POST | 「npm 包同步」清单（非插件通用包镜像，独立文件存储） | `X-Admin-Token` |
| `/api/registry/sync-status` | GET | 服务端转发查内网 registry 同步状态（支持 `pkg@spec`） | 无 |
| `/admin` | GET | 管理控制台（策略编辑 + 客户端状态 + 健康概览 + 镜像同步） | `X-Admin-Token` |

插件元信息：`/api/plugins/meta?names=a,b,c` 从 npm registry（npmjs 优先 → npmmirror → 内网
`REGISTRY_OVERRIDE` 环境变量指定）拉取每个插件的描述、最新版本、主页，10 分钟缓存；
管理页「插件策略」据此展示详情卡片，方便管理员判断每个插件用途。

## 客户端如何接入

客户端（`deepseek-harness-launcher` 托盘）在 `launcher-config.json` 配置：

```json
{ "serverUrl": "http://<服务器IP>:8080" }
```

即自动启用：定期拉取插件策略 / 菜单策略 → 缺插件弹通知可一键装；上报本机状态。
协议契约由两仓共同演进：服务端 `server.js` 与客户端 `src-tauri/src/sync.rs` 各持一份
`ServerConfig` 结构（字段 `plugins` / `managedMenu` / `clientDefaults` / `mirrorSettings`），
演进时保持兼容（服务端字段缺失时客户端用默认值）。

## 策略字段（`data/config.json`）

```json
{
  "version": 2,
  "plugins": ["dsh-nested-followups", "@noob-stupid/dsh-plugin-console"],
  "managedMenu": {
    "enabled": true,
    "quickLinks": [
      { "label": "公司OA", "url": "http://oa.internal" },
      { "label": "Wiki", "url": "https://wiki.internal" }
    ]
  },
  "clientDefaults": { "npmRegistry": [], "ghMirrorPrefix": [], "port": 3180, "syncIntervalSecs": 300, "profile": "matrix", "useSystemNode": false },
  "mirrorSettings": { "registry": "http://registry.ict.cmcc", "tokenValue": "" },
  "updatedAt": "2026-08-28T00:00:00.000Z",
  "baseUrl": ""
}
```

- `plugins`：**应装插件清单**（不带版本号，客户端装最新版）。客户端任一 profile 装了即满足；
  未装的客户端弹通知 + 托盘「安装」菜单，点击自动安装。
- `managedMenu`：**托盘菜单策略**。`enabled=true` 时客户端托盘「常用网址」菜单**完全展示策略项**
  （用户本地菜单不被覆盖，仅展示层切换）；`enabled=false` 回退用户自己的菜单。
- `clientDefaults`：客户端默认配置覆盖（数组类逗号分隔多源，字段与 launcher-config.json 对齐；
  用户本地显式配置过的不被覆盖）。
- 菜单项校验：label 非空、url 仅 `http://` / `https://`（拒绝 `javascript:`/`file:` 等注入面）。

## 管理页能力

- **插件策略**：应装插件清单（增删、保存下发）+ 每插件卡片展示 npmjs 最新版 / 描述 / 来源；
  卡片徽章显示**内网 registry 同步状态**（✓ 已同步 vX / ⚠ 未同步 / ⬆ npmjs 有新版），
  「⟳ 刷新同步状态」强制重查 npmjs 与内网版本（绕过缓存），有新版时整卡橙色高亮 + 「同步到 vX」按钮。
- **npm 包同步**：把**任意 npm 包（含全量依赖树）**镜像进内网 registry 的独立清单——用于非插件的
  通用依赖加速（典型场景：把 dsh 核心 `@deepseek-ai/dsh@0.1.2-rc.1` 及上百依赖同步进内网，同事装
  dsh / 依赖时经 `mirrorSettings.registry` 走内网提速）。每项支持 `包名`（= latest）或 `包名@版本/tag`；
  卡片展示 npmjs 上游版本 + 内网同步状态（指定版本时按「该版本是否已存在」判定）+ 单包同步与实时进度。
  > 依赖本机 launcher「管理能力」≥ 0.3.0 才支持指定版本/tag 同步（旧版仅能同步 latest）；
  > 同步经管理员本机 launcher 的 mirror 引擎执行（外网拉包 → publish 内网），服务端不出网。
- **客户端健康概览**：每台客户端插件明细 / 待装 / 托盘菜单 / profile，健康状态（正常 / 缺插件 / 菜单未应用 / 离线）。
- **内网 registry 镜像**：把「应装插件 + 全部依赖」上传到内网 registry，供无外网的同事客户端安装。

### 服务端不直连外网时的中转（推荐）

服务端若**不能访问外网**（内网隔离），管理页查 npmjs 包信息改由**管理员本机 launcher 中转**：

1. 管理员在 launcher 托盘「管理能力」开启外网代理 → 本机 `127.0.0.1:3410` 起本地 API
2. 管理页自动探测（客户端上报的 `bridgeStatus`）或手动输入端口连接
3. 管理页 `fetch http://127.0.0.1:3410/api/registry/meta?name=...` → launcher 查外网 registry 返回

这样服务端全程不出网，只靠管理员电脑中转。本地 API 仅绑 127.0.0.1，可选 token 防护。

## 客户端上报（`data/clients/<clientId>.json`）

每台客户端每次成功上报覆盖写入：

```json
{
  "clientId": "uuid",
  "hostname": "PC-NAME",
  "dshVersion": "0.1.1-rc.2",
  "launcherVersion": "0.2.1",
  "installed": ["dsh-nested-followups"],
  "pending": ["@noob-stupid/dsh-plugin-console"],
  "plugins": [
    { "name": "dsh-nested-followups", "version": "0.2.2", "description": "...", "profile": "web", "client": true }
  ],
  "menu": [{ "label": "公司OA", "url": "http://oa.internal" }],
  "menuApplied": true,
  "profiles": ["web", "matrix"],
  "configState": { "profile": "web", "port": 3180 },
  "offline": false,
  "lastSyncAt": "2026-08-28T10:00:00.000Z"
}
```

## 安全提示

- 面向**内网**部署：拉取 `/api/config` 免鉴权；管理写操作靠 `--token`（请求头 `X-Admin-Token`）。
- 建议服务器防火墙仅放行内网；如需公网请置于反向代理后并启用 TLS。
- 客户端 ID 是随机 UUID，仅用于区分机器，不含主机名等敏感信息（hostname 可选上报）。
- `baseUrl`：预留（如未来指向内网 npm 私服）。

## 部署数据保护（本机生产）

> ⚠️ 本机生产部署数据在 `E:\ai-works\caddy\launcher-data`（config + 客户端数据），
> 由 pm2 的 `launcher-server`（wrapper `E:\ai-works\caddy\launcher-server.cjs`）指向本仓库运行。
> **测试/调试时严禁 `POST /api/config` 重置 plugins 为空、删除或移动该目录**——数据不可再生。

## 开发 / 发布

- 本仓库**零依赖**：改 `server.js`（服务逻辑）后需重启进程；改 `admin.js`（管理页 JS）每次请求读盘即生效。
- 版本号：`package.json` 的 `version`（当前 0.2.1，与 launcher 客户端发布节奏解耦后可独立 bump）。
- 打 tag（如 `v0.2.1`）触发 GitHub Actions 发布服务端包（如后续配置）。
