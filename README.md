# mail2qq

`mail2qq` 是一个本地运行的校园邮箱转发工具：定期从校园邮箱读取新邮件，并通过 QQ 邮箱 SMTP 转发到指定 QQ 邮箱。

当前版本面向 Node.js v20.20.2，只使用 Node 内置模块，不依赖 Telegram、Cloudflare Worker、数据库或第三方 npm 包。

## 致谢与来源

本项目基于原 Git 项目 [yangyioryy/mail2tg](https://github.com/yangyioryy/mail2tg) 改造而来。感谢原作者提供邮件聚合、IMAP 拉取与消息转发方向的工程基础。

当前版本已经重构为本地 Node.js 工具，聚焦“校园邮箱 -> QQ 邮箱”这一单一场景，并移除了 Telegram、Cloudflare Worker、D1 等原有部署链路。

## 程序原理

整体流程如下：

```text
Node.js 进程
  │
  ├─ 读取 config.json
  │
  ├─ 通过 IMAPS 连接校园邮箱
  │    ├─ SELECT INBOX 获取邮箱总数
  │    ├─ UID SEARCH UNSEEN 获取未读数量
  │    └─ UID SEARCH 获取上次游标之后的新邮件
  │
  ├─ 解析新邮件正文
  │    ├─ 支持 text/plain
  │    ├─ 支持 text/html 降级为纯文本
  │    └─ 支持 Base64 / Quoted-Printable 解码
  │
  ├─ 通过 QQ SMTP 发送转发邮件
  │
  └─ 写入 data/state.json
       └─ 保存最新 IMAP UID，避免重复转发
```

它不是邮件服务器，也不是云服务。程序只在你运行它的电脑、服务器或 NAS 上工作；进程停止后就不会继续检查邮件。

## 功能

- 定期检查校园邮箱 `INBOX`
- 将新增邮件转发到 QQ 邮箱
- 每次检查显示总数、未读、已读、新邮件和本次发送情况
- 使用本地状态文件避免重复转发
- 首次运行默认只建立检查点，不转发历史邮件
- 空闲轮次不写状态文件，减少高频检查时的磁盘写入
- 只转发正文，不处理附件

## 安装说明

### 1. 准备 Node.js

确认当前 Node 版本：

```bash
node --version
```

建议输出为：

```text
v20.20.2
```

更高的 Node 20 小版本通常也可以。

### 2. 准备邮箱权限

校园邮箱需要支持 IMAP SSL 登录。常见端口是 `993`。

QQ 邮箱需要在网页版设置里开启 `IMAP/SMTP` 服务，并生成授权码。注意：`target.password` 填 QQ 邮箱授权码，不是 QQ 登录密码。

### 3. 准备配置文件

复制模板：

```bash
cp config.example.json config.json
```

真实账号、密码和授权码只写入 `config.json`。该文件已被 `.gitignore` 忽略，不应提交。

## 配置说明

示例配置：

```json
{
  "pollIntervalSeconds": 300,
  "stateFile": "data/state.json",
  "networkTimeoutMs": 30000,
  "source": {
    "host": "mail.csu.edu.cn",
    "port": 993,
    "username": "your-campus-email@example.edu.cn",
    "password": "your-campus-email-password-or-app-password",
    "mailbox": "INBOX",
    "maxFetchPerRun": 10,
    "maxBodyChars": 20000,
    "tlsRejectUnauthorized": true
  },
  "target": {
    "smtpHost": "smtp.qq.com",
    "smtpPort": 465,
    "username": "your-qq-email@qq.com",
    "password": "your-qq-mail-authorization-code",
    "to": "your-qq-email@qq.com",
    "fromName": "Campus Mail Forwarder",
    "tlsRejectUnauthorized": true
  },
  "forward": {
    "subjectPrefix": "[校园邮箱转发]",
    "firstRunMode": "checkpoint",
    "heloName": "mail2qq.local"
  }
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `pollIntervalSeconds` | 检查间隔，单位秒。设为 `1` 表示每秒检查一次 |
| `stateFile` | 状态文件路径，用于保存已处理到的 IMAP UID |
| `networkTimeoutMs` | IMAP/SMTP 网络超时时间，单位毫秒 |
| `source.host` | 校园邮箱 IMAP 主机名，只写主机，不要写 `https://` |
| `source.port` | IMAP SSL 端口，通常为 `993` |
| `source.username` | 校园邮箱完整账号 |
| `source.password` | 校园邮箱密码或客户端专用密码 |
| `source.mailbox` | 要检查的邮箱文件夹，默认 `INBOX` |
| `source.maxFetchPerRun` | 单轮最多读取并转发的新邮件数 |
| `source.maxBodyChars` | 单封邮件正文最大保留字符数 |
| `target.smtpHost` | QQ SMTP 主机名，通常为 `smtp.qq.com` |
| `target.smtpPort` | QQ SMTP SSL 端口，通常为 `465` |
| `target.username` | QQ 邮箱账号 |
| `target.password` | QQ 邮箱授权码 |
| `target.to` | 转发目标邮箱，可以和 `target.username` 相同 |
| `target.fromName` | 转发邮件显示的发件人名称 |
| `forward.subjectPrefix` | 转发邮件主题前缀 |
| `forward.firstRunMode` | `checkpoint` 表示首次只建检查点；`forward` 表示首次也转发最近邮件 |
| `forward.heloName` | SMTP `EHLO` 使用的名称，默认即可 |

## 使用方法

### 单次检查

```bash
npm run once
```

适合初始化、调试或手动检查。

首次运行默认会显示：

```text
【2026-06-05 19:15:05｜上海时间】首次初始化完成
  邮箱统计：总数 624 封｜未读 3 封｜已读 621 封
  新邮件：624 封｜本轮读取 7 封｜剩余待处理 617 封
  本次发送：成功 0 封｜失败 0 封
  当前游标：UID 1273
  处理方式：本次不转发历史邮件，只转发之后的新邮件
```

这是正常行为。默认 `firstRunMode` 是 `checkpoint`，避免第一次启动时把历史邮件全部发到 QQ。

### 常驻定期运行

```bash
npm start
```

程序会按 `pollIntervalSeconds` 周期检查。终端关闭或进程退出后，检查会停止。

### 指定配置文件

```bash
node src/index.js --config config.json --once
```

可以用这个方式测试不同配置。

## 输出说明

无新邮件时：

```text
【2026-06-05 19:15:05｜上海时间】检查完成，暂无新邮件
  邮箱统计：总数 625 封｜未读 3 封｜已读 622 封
  新邮件：0 封｜本轮读取 0 封｜剩余待处理 0 封
  本次发送：成功 0 封｜失败 0 封
  当前游标：UID 1273
```

有新邮件并转发成功时：

```text
【2026-06-05 19:16:02｜上海时间】检查完成，已转发新邮件
  邮箱统计：总数 626 封｜未读 4 封｜已读 622 封
  新邮件：1 封｜本轮读取 1 封｜剩余待处理 0 封
  本次发送：成功 1 封｜失败 0 封
  当前游标：UID 1274
  已发送邮件：
    - UID 1274：测试邮件
```

转发失败时会额外显示失败 UID 和错误原因。失败邮件不会推进游标，下次检查会继续重试。

## 状态文件

默认状态文件是：

```text
data/state.json
```

它记录：

- 是否已经初始化
- 当前处理到的最大 IMAP UID
- 已经发送成功但尚未推进游标的 UID

不要随意删除该文件。删除后程序会认为自己是首次运行，可能重新建立检查点或重新处理历史邮件。

## 高频检查建议

你可以把检查间隔设为 1 秒：

```json
"pollIntervalSeconds": 1
```

程序已经避免重叠运行：上一轮没结束时不会启动下一轮。空闲时也不会重复写状态文件。

不过，1 秒检查一次仍然会频繁连接校园邮箱，对网络和邮箱服务器更敏感。长期运行更建议使用 `5` 到 `60` 秒之间的间隔。

## 验证

语法检查：

```bash
node --check src/index.js
```

查看 Node 版本：

```bash
node --version
```

单次真实检查：

```bash
npm run once
```

## 注意事项

- `source.host` 和 `target.smtpHost` 只写主机名，例如 `mail.bit.edu.cn`，不要写 `https://mail.bit.edu.cn/`。
- QQ 邮箱必须使用授权码，不能使用 QQ 登录密码。
- `config.json` 含有真实账号和密码，不要提交、截图或分享。
- 默认不转发历史邮件；如果确实要转发历史邮件，把 `forward.firstRunMode` 改为 `forward`。
- 本项目只转发邮件正文，不转发附件。
- 如果校园邮箱要求客户端专用密码，需要先在学校邮箱系统中生成。
- 如果长期运行，建议放在稳定在线的电脑、NAS 或服务器上。

## 常见问题

### `getaddrinfo ENOTFOUND`

通常是 `source.host` 写错了。主机名不要带协议和路径：

```json
"host": "mail.bit.edu.cn"
```

不要写：

```json
"host": "https://mail.bit.edu.cn/"
```

### `IMAP 命令失败 LOGIN`

通常是校园邮箱账号、密码、客户端授权码或 IMAP 权限问题。

### QQ SMTP 登录失败

确认 `target.password` 是 QQ 邮箱授权码，并且 QQ 邮箱已开启 IMAP/SMTP 服务。

### 没有收到转发邮件

先看终端输出里的 `本次发送` 和 `失败详情`。如果显示成功但 QQ 收件箱没有邮件，检查垃圾箱、拦截规则或 QQ 邮箱自发自收策略。
