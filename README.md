# dsh-balance · 模型余额悬浮窗

模型账户余额悬浮窗插件 for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) Web GUI（dsh-web-ui 插件生态）。

右下角悬浮展示模型账户余额（每 60 秒自动刷新），可拖动、收起、关闭；设置页位于「设置 → 插件 → 模型余额悬浮窗」，带「显示余额悬浮窗」总开关。支持 DeepSeek / 硅基流动 / Moonshot / OpenRouter 余额接口（按 baseURL 域名自动识别）。

A floating model-account balance monitor for the DeepSeek Harness Web GUI: a draggable bottom-right card auto-refreshing every 60s, with a master show/hide switch on its Plugins-settings page. Supports DeepSeek / SiliconFlow / Moonshot / OpenRouter balance endpoints (auto-detected from the configured base URL).

## 功能 · Features

- 💰 **余额悬浮窗 · Floating balance card**（右下角，可拖动）：总余额大字 + 充值/赠送明细 + 更新时间；⟳ 手动刷新、– 收起成小胶囊、× 关闭（留一枚 ¥ 胶囊随时唤回）。Draggable card with total balance, breakdown lines, refresh / collapse / close buttons.
- 🔄 **实时刷新 · Auto refresh**：每 60 秒自动查询，结果 host 侧缓存 30 秒，不频繁打接口。Polls every 60s; results cached 30s host-side.
- 🔌 **总开关 · Master switch**：「设置 → 插件 → 模型余额悬浮窗」里可一键关闭/开启悬浮窗，设置持久化到 `~/.dsh/balance/settings.json`。One-click show/hide on the Plugins-settings page, persisted locally.
- 🔐 **密钥安全 · Credential safety**：余额查询全部走 host 端 fetch；API key 可在设置页直接填写（存于 `~/.dsh/balance/settings.json`，接口只回传脱敏预览），或经 credentials 服务解析（环境变量 → `~/.dsh/.credentials.yaml` → `.env`），永不下发到浏览器。Balance fetch runs on the host; the key can be entered in the settings page (stored locally, masked in responses) or resolved through the credentials seam — it never reaches the browser.
- 🌐 **多服务商 · Multi-provider**：DeepSeek `/user/balance`、硅基流动 `/v1/user/info`、Moonshot `/v1/users/me/balance`、OpenRouter `/api/v1/credits`；其他域名明确提示不支持。Unsupported hosts fail with a clear message.
- 💾 **零运行时依赖 · Zero runtime dependencies**：host 半体纯 Node，浏览器半体纯 React，无需构建（`lib/` 即发布产物）。No build toolchain.

## 安装 · Install

```bash
# 安装到 web profile（dsh 插件市场 / dsh CLI）
# Install into the web profile (dsh plugin market / dsh CLI)
dsh plugin --profile web add github:Mystery-God/dsh-balance
# 或直接改 profile 的 package.json / bundles 后 pnpm install
# Or edit the profile's package.json deps + bundles, then pnpm install
```

安装后重启 dsh web，即可在「设置 → 插件 → 模型余额悬浮窗」中配置。
Restart dsh web, then configure it at **Settings → Plugins → 模型余额悬浮窗**.

## 工作原理 · How it works

```
lib/index.js   — host 半体：~/.dsh/balance/settings.json（浮窗总开关）+ /api/dsh-balance/* 路由（设置读写、余额查询）+ agent 公告
lib/client.js  — 浏览器半体：设置页（settings.plugins.tab，总开关+余额预览）+ 悬浮卡片（shell.overlay）+ 60s 轮询
cordis.patch.yml — bundle patch：把插件行注入 profile 组合
```

- 路由带 loopback + same-origin 围栏（与 dsh-ssh 一致），LAN 暴露的部署不会对外提供这些接口。Routes carry a loopback + same-origin fence; LAN-exposed deployments never serve them.
- 设置页与悬浮窗共享一份内存 store，开关切换即时生效。Both surfaces share one in-memory store — the switch takes effect immediately.

## 开发 · Development

```bash
node scripts/build.mjs   # 把 src/ 复制为 lib/（无编译步骤）· copies src/ → lib/
node scripts/test.mjs    # host 路由冒烟测试（mock 余额接口，临时 DSH_HOME）· host route smoke test
```

本仓库无 TypeScript / 无打包器：`src/` 是手写源码，`lib/` 是发布产物（需提交，dsh 插件市场校验安装包时要求入口文件存在）。No TypeScript, no bundler: `src/` is the hand-written source, `lib/` is the shipped artifact (committed).

## License

[MIT](./LICENSE)

---

纯中文版：[README.zh.md](./README.zh.md)
