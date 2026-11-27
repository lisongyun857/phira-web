# Phira 多人服务器 · 静态 Web 面板

纯 HTML / CSS / 原生 JavaScript 的静态前端，无构建步骤、无框架、无 CDN 依赖，可以直接部署到任意静态服务器或 Nginx。包含两个页面：

- `index.html`：玩家面板，使用 Phira 邮箱与密码登录，用于查看并操作自己所在的房间。
- `admin.html`：管理员面板，使用后端 `api.access_token` 认证，用于查看状态、管理房间、绑定、公告与日志。

所有 API 请求都直接发往后端 HTTP API（后端已支持 CORS），前端不保存密码。

## 文件结构

```text
前端/
├─ config.js            # 默认 API 地址与站点名
├─ index.html           # 玩家面板
├─ admin.html           # 管理员面板
├─ assets/
│  ├─ styles.css        # 深色主题样式（响应式）
│  ├─ app.js            # 玩家面板逻辑 + 公共工具
│  └─ admin.js          # 管理员面板逻辑
└─ README.md
```

## 快速开始

### 1. 配置 API 地址

编辑 `config.js`：

```js
window.PHIRA_CONFIG = {
  apiBase: "https://phira.lisongyun.top", // 后端 HTTP API 根地址，末尾不要带斜杠
  siteName: "Phira 管理面板",             // 页面顶部显示的站点名
};
```

也可以保持 `apiBase` 为空，部署后首次打开页面会弹出“API 地址设置”，填写的地址会保存在浏览器 `localStorage` 的 `phira_api_base` 键中。`localStorage` 中的地址优先于 `config.js`。

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

## 后端配置

### 允许前端域名跨域

后端 `server_config.yml` 中把前端地址加入 `api.allowed_origins`：

```yaml
api:
  enabled: true
  host: "0.0.0.0"
  port: 3052
  access_token: "请替换为足够随机的令牌"
  allowed_origins:
    - "https://phira-web.example.com"
```

`allowed_origins` 为 `"*"` 时允许任意来源（默认）。服务端已处理 `OPTIONS` 预检，并允许 `Authorization` 与 `Content-Type` 请求头。

### 保护管理接口

管理面板通过 `Authorization: Bearer <access_token>` 调用接口。把管理员专用接口加入 `protected_paths`，例如：

```yaml
api:
  protected_paths:
    - POST /api/announce
    - POST /api/rooms/*
    - POST /api/room-creation
    - POST /api/say
    - POST /api/login/link
    - DELETE /api/login/binding
  public_paths:
    - GET /api/status
```

**不要**把 `POST /api/room/action` 加入 `protected_paths`：玩家面板依赖该接口通过请求体里的 `sessionToken` 操作房间，普通玩家没有 `access_token`，加入保护后玩家将无法锁定房间、准备、开始游戏等。若确实需要保护，请仅保留给管理员并接受玩家面板无法操作房间。

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

## 页面说明

### 玩家面板（index.html）

- 使用 Phira 邮箱与密码登录，会话有效期约 7 天。
- 顶部可设置 API 地址、查看当前用户、退出登录。
- 我的房间：显示房间号、阶段、房主、谱面、锁定与轮换状态、成员列表（身份与在线状态）。
  - 房主可锁定/解锁、开关轮换、选择谱面、开始游戏、踢人、转让房主、解散房间。
  - 所有成员可在准备阶段准备/取消准备，在游戏进行中中止。
  - 不满足阶段条件的按钮会被禁用，并显示原因。
- 在线房间：查看房间列表与成员详情（隐藏房间不显示）。
- 账号：Phira ID、昵称、在线状态、QQ 绑定信息与解绑入口。
- 每 8 秒自动刷新；页面不可见时暂停；登录过期会清空令牌并回到登录页。

### 管理员面板（admin.html）

- 使用 API 地址与访问令牌登录；服务端未设置令牌时令牌留空即可。
- 概览：运行时长、在线用户、连接会话、房间数、内存占用、客户端建房开关、在线用户列表。
- 房间：查看全部房间（含隐藏）、创建房间、解散房间、向全部房间发送管理消息；详情中可锁定/解锁、开关轮换、踢人、转让房主、向该房间发送消息。不提供选谱与开始游戏（需要房间内的玩家操作）。
- 绑定：查看 QQ 绑定列表、解绑、为指定 QQ 生成一次性绑定链接并复制。
- 公告：向所有在线玩家发送公告。
- 日志：查看 100 / 200 / 500 / 1000 行日志，自动滚动到末尾。
- 每 8 秒自动刷新概览与当前标签页；页面不可见时暂停。所有结果通过右上角 toast 提示，破坏性操作会二次确认。

## 常见问题

- **登录提示“登录已过期”**：会话令牌存在服务端内存中，服务重启后失效；重新登录即可。
- **无法连接服务器**：检查页面中的 API 地址是否正确、后端是否启动、`api.allowed_origins` 是否包含当前前端域名。
- **管理员登录成功但操作返回 401**：说明 `api.access_token` 与填写的令牌不一致，或该接口在 `protected_paths` 中但请求未带令牌。
- **页面显示“你当前不在房间中”**：需要先在 Phira 游戏客户端登录本服务器并进入房间，然后在网页点击刷新。
- **踢人或解散后客户端仍在房间界面**：受 Phira 协议限制，被移出的客户端可能需要自行离开房间或重连。
- **不要将管理面板令牌写入公开仓库或截图**：令牌等同于管理员权限。建议使用 HTTPS，并限制 `admin.html` 的访问范围。
