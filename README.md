# dsh-playbook

[English](README.en.md)

**给任务，先读资料并选择项目 SOP，再按阶段、证据和验收条件执行。**

## 0.6.0：视频产物按 Run 隔离

新视频生产任务由插件分配 `.dsh-runs/<UUID>`，不再把整个项目工作区里的旧 final.mp4 当成当前产物目录。检查实际路径、归属标记、链接、辅助时间信息及已知旧成品哈希；系统报告保留验证时的产物血缘。**这是产物验收隔离，不是进程级防读取沙箱，也不是“当前模型亲自创作”的证明。**

[运行隔离、已知旧哈希登记、迁移与边界](docs/RUN-ISOLATION.md)

## 更新与使用

先备份实际使用的 playbook-state.json；用原服务账号、相同 DSH_HOME 和 Web Profile 更新：

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

重启原服务并刷新网页，开新会话直接给任务书，不需要手工编写 SOP JSON。已启动的旧视频任务不会被复制或补写作者标签来冒充新独立实验。

```text
读取任务资料 → 识别项目 → 复用或起草项目 SOP → 固定版本 → 执行
→ Gate 检查 → 有界返修 → 候选交付 → 用户接受或退回
```

视频 route/start 自动准备独立产物目录；准备失败不会采用旧目录或绕过 Host 权限。Agent 可用 `playbook(action="workspace")` 查询/准备本轮目录，之后使用返回的绝对路径与显式 bash workdir。

## 保留的能力

20 个基础 SOP，覆盖开发、审查、发布准备、恢复、部署、内容、音乐、研究和分析。B 站实验、道家文化、通用短视频采用不同业务方法，共用必要的技术检查。只要求文案的任务不应强行制作 MP4。

项目方法库按 Host 工作目录＋project_id 隔离。新增方法可保存为 trial，改写保护规则进入 draft；用户批准精确版本后成为 approved。不能靠换名或 reload 删除 Gate 来绕过失败。任务参数、当期主题、发布平台与长期方法分开。

阶段、重试、修订与快照存储在模型上下文之外。视频技术检查实际读取规范稿、逐段文本、样片、音频、字幕、封面和最终文件。模型自报 passed 不等于机器检查通过；机器检查也不等于内容与审美合格。

## 查看和控制

在 **DSH 聊天框**输入，不是系统 Shell：

```text
/playbook project
/playbook sops
/playbook status json
/playbook report
/playbook revise 请自行定位原成片问题并返修
/playbook accept
/playbook auto off
/playbook cancel
```

项目 SOP 查看与批准、运行状态和恢复也可使用 Web Playbook 面板。`auto off` 不取消活动任务。旧结果未被状态追踪时，可由用户登记 `/playbook exclude-hash <SHA256> <原因>`，不是让模型自行删改对照基线。

## 文档

- [项目方法库与先读后选](docs/PROJECT-SOPS.md)
- [媒体检查与同任务返修](docs/MEDIA-REVISION.md)
- [SOP 目录](docs/SOP-CATALOG.md)
- [命令回执与格式纠错](docs/QUALITY.md)
- [架构](docs/ARCHITECTURE.md)

## 依赖与验证边界

Node.js 20+。媒体检查还需要 Python 3.9+、ffmpeg、ffprobe，仅用 Python 标准库；缺失时报告未验证，不自动安装或添加模型/API Key。所有运行目录准备和媒体检查走原 DSH 工具链与权限。

源码检查：`npm test`、`npm run check`、`npm run packcheck`。实际媒体夹具：`npm run mediatest`。已装 DSH peer dependencies 时：`npm run sdkcheck`。`node scripts/isolation-smoke.mjs` 用模拟 Host 调度执行真实 Python，不能冒充真实 Web Profile/模型端到端验收。

保留状态格式 v3，新增可选隔离字段；单 Host 写入，不支持多进程共享一个状态文件。项目审批和归属检查不是同用户恶意进程的隔离系统。哈希不能识别重新编码后的复制，时间戳不能证明来源，宿主模型标签不能证明作者。无 ASR、独立语义 Reviewer 或已验证的模型质量提升结论。

MIT License.
