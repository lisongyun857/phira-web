# Phira 多人服务器 · 静态 Web 面板

纯 HTML / CSS / 原生 JavaScript 的静态前端，无构建步骤、无框架、无 CDN 依赖，可以直接部署到任意静态服务器或 Nginx。包含两个页面：

- `index.html`：玩家面板，使用 Phira 邮箱与密码登录，用于查看并操作自己所在的房间。
- `admin.html`：管理员面板，使用管理员密码登录，用于查看状态、管理房间、玩家与封禁、绑定、实时日志、公告与系统设置。

所有 API 请求都直接发往后端 HTTP API（后端已支持 CORS），前端不保存管理员密码。

## 文件结构

```text
前端/
├─ config.js            # 默认 API 地址与站点名
├─ index.html           # 玩家面板
├─ admin.html           # 管理员面板
├─ assets/
│  ├─ styles.css        # 深色主题样式（响应式）
│  ├─ app.js            # 玩家面板逻辑 + 公共工具
│  └─ admin.js          # 管理员面板逻辑（IIFE）
└─ README.md
```

## 快速开始

### 1. 配置 API 地址

`config.js` 默认指向：

```js
window.PHIRA_CONFIG = {
  apiBase: "https://login-phira.lisongyun.top", // 后端 HTTP API 根地址，末尾不要带斜杠
  siteName: "Phira 管理面板",                    // 页面顶部显示的站点名
};
```

API 地址默认由 `config.js` 决定，普通玩家面板不提供修改入口，只能由管理员在管理面板登录后设置（保存在当前浏览器的 `phira_api_base`，同一域名下玩家面板会沿用）。

> 玩家登录令牌保存在 `phira_web_token`，管理员令牌保存在 `phira_admin_token`，都只存在当前浏览器。

### 2. 本地预览

直接双击 `index.html` 即可运行，也可以启动一个本地静态服务器：

```bash
# 任选一种
python -m http.server 8080
npx serve .
```

然后访问 `http://localhost:8080/` 和 `http://localhost:8080/admin.html`。

注意：通过 `file://` 直接打开时浏览器发送的 `Origin` 为 `null`。若后端 `api.allowed_origins` 保持默认的 `"*"`，可以正常访问；如果配置了固定域名白名单，请改用本地 HTTP 服务器，并把 `http://localhost:8080` 加入白名单。

### 3. 部署到 Nginx

把 `前端/` 目录内的全部文件复制到静态目录，例如 `/var/www/phira-web/`：

```nginx
server {
    listen 80;
    server_name phira-web.example.com;
    root /var/www/phira-web;
    index index.html;

    # 访问 /admin 时返回 admin.html
    location = /admin {
        try_files /admin.html =404;
    }

    # 静态文件
    location / {
        try_files $uri $uri/ =404;
    }
}
```

如果部署在子路径（例如 `https://example.com/phira/`），把整个目录放到 `/var/www/html/phira/`，然后：

```nginx
location /phira/ {
    alias /var/www/html/phira/;
    try_files $uri $uri/ =404;
}

location = /phira/admin {
    try_files /phira/admin.html =404;
}
```

页面中的资源均使用相对路径（`assets/styles.css` 等），放在子路径下无需修改代码。

建议为管理页增加一层保护，例如只允许内网访问或加 Basic Auth：

```nginx
location = /admin {
    allow 10.0.0.0/8;
    deny all;
    try_files /admin.html =404;
}
```

## 管理员登录

1. 服务端配置 `api.admin_password`（至少 6 位）。如果没有设置，也可以暂时使用旧的 `api.access_token` 作为登录密码。
2. 打开 `admin.html`，确认 API 地址后输入管理员密码。
3. 前端调用 `POST /api/admin/login`，请求体 `{password}`：
   - 成功返回 `{ok:true,data:{token,expiresAt}}`，令牌保存在 `localStorage` 的 `phira_admin_token`。
   - 密码错误返回 HTTP 401 与 `{ok:false,error:"密码错误"}`。
   - 尝试过于频繁返回 HTTP 429；服务端未设置密码返回 HTTP 503。
4. 之后的请求都带 `Authorization: Bearer <token>`。任意接口返回 401 时，前端会清除令牌并回到登录页，提示“管理员登录已过期”。
5. 顶部“退出登录”会调用 `POST /api/admin/logout`；即使请求失败也会清除本地令牌。

页面加载时如果已有令牌，会先用 `GET /api/admin/config` 验证；验证失败会回到登录页。

## 页面说明

### 玩家面板（index.html）

- 使用 Phira 邮箱与密码登录，会话有效期约 7 天。
- 普通玩家不能修改 API 地址；地址由管理员在管理面板设置，顶部只显示当前用户和退出登录。
- 我的房间：显示房间号、阶段、房主、谱面、锁定与轮换状态、成员列表（身份与在线状态）。
  - 房主可锁定/解锁、开关轮换、选择谱面、开始游戏、踢人、转让房主、解散房间。
  - 选谱支持“搜索选谱”：直连 Phira 官方接口，按名称/曲师/谱师搜索，卡片展示封面、等级、评级，可试听；手动输入谱面 ID 仍然保留。
  - 所有成员可在准备阶段准备/取消准备，在游戏进行中中止。
  - 不满足阶段条件的按钮会被禁用，并显示原因。
- 在线房间：查看房间列表与成员详情（隐藏房间不显示）。
- 账号：Phira ID、昵称、在线状态、QQ 绑定信息与解绑入口。
- 每 8 秒自动刷新；页面不可见时暂停；登录过期会清空令牌并回到登录页。

### 管理员面板（admin.html）

- **概览**：运行时长、在线用户、连接会话、房间数、内存占用；客户端建房开关（关闭时二次确认）；在线用户只读概览。
- **房间**：查看全部房间（含隐藏）、创建房间、解散房间、向全部房间发送管理消息；详情中可锁定/解锁、开关轮换、踢人、转让房主、向该房间发送消息；未开始阶段可直接输入谱面 ID 或搜索官方谱面库选谱。
- **玩家与封禁**：
  - 在线用户表支持昵称 / ID 前端过滤；“踢下线”调用 `POST /api/admin/kick`，二次确认。
  - 封禁表单支持 IP 或 Phira ID、时长（分钟，0 表示永久）与原因，调用 `POST /api/admin/ban`。
  - 封禁列表调用 `GET /api/admin/bans`，逐条“解除”调用 `DELETE /api/admin/ban`，二次确认。
  - 封禁保存在服务端内存中，服务器重启后失效。IP 封禁同时拦截 HTTP 与游戏连接；Phira ID 封禁在登录时拒绝。
- **绑定**：
  - 搜索 QQ 号 / Phira ID / 昵称，分页调用 `GET /api/bindings?search=&page=&pageSize=20`。
  - 表格多选后“批量解绑”调用 `POST /api/admin/bindings/unbind`，请求体 `{keys:[{platform,userId}]}`，二次确认并显示解绑数量。
  - “导出 JSON”调用无分页参数的 `GET /api/bindings` 获取全部记录，通过 Blob 下载 `phira-bindings-YYYYMMDD.json`。
  - “生成绑定链接”调用 `POST /api/login/link`，链接可点击并复制。
- **实时日志**：
  - 通过 `GET /api/logs/stream?token=<管理员令牌>` 建立 SSE 连接。`EventSource` 不能携带 `Authorization` 请求头，所以令牌放在查询参数 `token` 中。
  - 监听 `event: log`，逐行追加到等宽日志区，最多保留 1000 行并自动滚底。
  - 支持开始/停止实时、清空显示、连接状态标签；异常断开后 3 秒自动重连，手动停止后不重连；页面卸载时关闭连接。
  - 保留“最近日志快照”作为备用，调用 `GET /api/logs?lines=`。
- **公告**：向所有在线玩家发送公告。
- **系统设置**：
  - `GET /api/admin/config` 只读展示运行配置，敏感项显示“已配置 / 未配置”。
  - 修改管理员密码（两次输入校验，6~64 位），调用 `POST /api/admin/config`，请求体 `{adminPassword}`；当前会话保持有效。
  - 修改 `access_token`，请求体 `{accessToken}`，留空表示不设置。
  - 修改 `allowed_origins`，每行一个来源，请求体 `{allowedOrigins:[...]}`，至少保留一个来源（可用 `*`）。
  - 所有修改写入服务端 `runtime-config.json`，重启后仍然生效；保存后会重新拉取配置刷新展示。
- 每 8 秒自动刷新概览、房间、玩家与封禁；绑定、日志和设置页按需刷新。所有结果通过右上角 toast 提示，破坏性操作会二次确认。

## 新管理接口约定

管理接口除登录外都要求 `Authorization: Bearer <管理员令牌>`。成功返回 `{ok:true,data:...}`；失败返回 `{ok:false,error}` 与 HTTP 401 / 400 / 404 / 429 / 503。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/admin/login` | 管理员密码登录，body `{password}` |
| POST | `/api/admin/logout` | 注销当前管理员会话 |
| GET | `/api/admin/config` | 读取运行配置 |
| POST | `/api/admin/config` | 修改 `adminPassword` / `accessToken` / `allowedOrigins` |
| GET | `/api/admin/bans` | 封禁列表 `{bans:[{type,value,reason,createdAt,expiresAt}]}` |
| POST | `/api/admin/ban` | 添加封禁，body `{type:"ip"\|"user", value, minutes, reason}` |
| DELETE | `/api/admin/ban` | 解除封禁，body `{type,value}` |
| POST | `/api/admin/kick` | 踢下线，body `{id}`，返回 `{kicked,id,name}` |
| POST | `/api/admin/bindings/unbind` | 批量解绑，body `{keys:[{platform,userId}]}` |
| GET | `/api/bindings` | 绑定列表；带 `search/page/pageSize` 时分页，不带时返回全部 |
| GET | `/api/logs/stream` | SSE 实时日志，查询参数 `token` |
| GET | `/api/logs` | 最近日志快照，查询参数 `lines` |

## 后端配置

### 管理员密码与运行配置

在 `server_config.yml` 中配置：

```yaml
api:
  enabled: true
  host: "0.0.0.0"
  port: 3052
  admin_password: "请替换为至少 6 位的密码"
  access_token: "可选，QQ 插件使用的令牌"
  allowed_origins:
    - "https://phira-web.example.com"
```

管理面板“系统设置”中的修改会写入服务端 `runtime-config.json`，覆盖上述 `api` 配置，重启后仍然生效。写入后无需重启即可生效。

### 允许前端域名跨域

`allowed_origins` 为 `"*"` 时允许任意来源（默认）。如果配置固定域名，请把前端地址加入白名单：

```yaml
api:
  allowed_origins:
    - "https://phira-web.example.com"
```

服务端已处理 `OPTIONS` 预检，并允许 `Authorization` 与 `Content-Type` 请求头。实时日志的 SSE 连接同样受 CORS 白名单限制。

### access_token 与 QQ 插件

配置 `access_token` 后，QQ 插件必须在其配置里填写同样的 `api_token`，否则管理类指令会返回 401。管理面板本身使用管理员密码登录，不依赖 `access_token`。

### protected_paths 与管理员会话

服务端已对管理类接口单独调用 `requireAdmin`（管理员会话或 `access_token` 均可），通常无需再配置 `protected_paths`。通用 `protected_paths` 校验只认识 `access_token`；如果配置了 `access_token` 又把管理接口加入其中，管理员会话会被判为 401，管理面板将无法操作。

因此建议保持 `protected_paths` 为空（默认值），由 `requireAdmin` 负责鉴权；QQ 插件配置同样的 `access_token` 即可正常调用管理指令。

**不要**把 `POST /api/room/action` 加入 `protected_paths`：玩家面板依赖该接口通过请求体里的 `sessionToken` 操作房间，普通玩家没有管理员令牌，加入保护后玩家将无法锁定房间、准备、开始游戏等。若确实需要保护，请仅保留给管理员并接受玩家面板无法操作房间。

### QQ 绑定需要 `/login/` 反向代理

管理面板生成的绑定链接指向 `login.public_url`。需要把 `/login/` 转发到 API 服务，否则用户打开链接会 404：

```nginx
location /login/ {
    proxy_pass http://127.0.0.1:3052;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

同时确认后端配置：

```yaml
login:
  enabled: true
  public_url: "https://phira-web.example.com"
```

### 实时日志的 SSE 代理

如果前端通过 Nginx 反向代理访问 API，需要为 SSE 关闭缓冲，避免日志延迟：

```nginx
location /api/logs/stream {
    proxy_pass http://127.0.0.1:3052;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

## 常见问题

- **管理员登录提示“密码错误”**：确认服务端 `api.admin_password` 与输入一致；若只配置了 `access_token`，可以暂时使用该令牌作为密码。
- **登录提示“管理员登录已过期”**：管理员令牌存在服务端内存中，服务重启后失效；重新登录即可。
- **无法连接服务器**：检查管理员设置的 API 地址是否正确、后端是否启动、`api.allowed_origins` 是否包含当前前端域名。
- **修改 access_token 后 QQ 指令返回 401**：需要把同样的值填入 QQ 插件的 `api_token` 配置。
- **实时日志不显示**：确认服务端支持 `GET /api/logs/stream`、反向代理未缓冲 SSE，并且令牌仍有效。EventSource 的令牌通过查询参数 `token` 传递，不能使用 Authorization 请求头。
- **页面显示“你当前不在房间中”**：需要先在 Phira 游戏客户端登录本服务器并进入房间，然后在网页点击刷新。
- **踢人或解散后客户端仍在房间界面**：受 Phira 协议限制，被移出的客户端可能需要自行离开房间或重连。
- **不要将管理员密码或令牌写入公开仓库或截图**：管理员令牌等同于管理员权限。建议使用 HTTPS，并限制 `admin.html` 的访问范围。
