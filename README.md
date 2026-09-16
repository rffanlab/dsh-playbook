# dsh-playbook

[English](README.en.md)

**给任务，先读资料并选择项目 SOP，再按阶段、证据和验收条件执行。**

## 0.7.3：直接说“拒绝候选”即可退回

修复该短句未登记的错误。聊天退回进入原 Run；可选设置面板统一“拒绝候选”名称，并绑定实际查看的会话与候选，防止误点旧状态。无需清空、取消或额外批准。[评审入口与验证边界](docs/CANDIDATE-REVIEW.md)。

## 0.7.2：修复“继续任务后恢复探针仍被拒绝”

失败任务不再被续做消息误判成新接单；固定恢复调用不被本插件另一道 intake Guard 自锁。真实宿主错误保留 callId/错误码，不再笼统要求重复授权。原任务、Gate、状态与权限边界保留。见[恢复调用链修复](docs/RECOVERY-DISPATCH.md)。`/playbook status json` 的 `runtimePluginVersion` 区分运行补丁与固定 SOP 版本。

## 0.7.1：不用为插件故障清空任务

修复清单路径被重复拼接导致的假“文件不存在”；有记录的这类失败可在原 Run 重新检查并恢复，不重置历史和预算。旧版已交付任务的同作品返修有明确兼容路径，不再默认要求取消重开。`intake` 支持实际 `source_paths`，无需模型猜调用 ID。已确认 SOP、质量与隔离规则保留。

[原任务恢复、兼容范围与使用说明](docs/RUNTIME-RECOVERY.md)

## 0.7.0：少填表、精确返修，不降低质量

识别长篇用户审核和“打回当前候选”；接受 repair 的 diagnosis/target_stage_id 别名；稿件过期直接回 script，不在 produce/qa 来回撞。默认精简状态输出、支持 ASS 口播样式和展示标点差异、等待验收时可只读诊断。未变成品按哈希复用已测 QA，不反复解码；通用封面不为凑哈希强制重画。样片只验证一个自然完整段，音频决定最终收尾而非每张卡片时长。

[本轮改动、参数、ASS 示例、边界与升级说明](docs/WORKFLOW-UX.md)

## 保留：视频产物按 Run 隔离

新视频生产任务由插件分配 `.dsh-runs/<UUID>`，不再把整个项目工作区里的旧 final.mp4 当成当前产物目录。检查实际路径、归属标记、链接、辅助时间信息及已知旧成品哈希；系统报告保留验证时的产物血缘。**这是产物验收隔离，不是进程级防读取沙箱，也不是“当前模型亲自创作”的证明。**

[运行隔离、已知旧哈希登记、迁移与边界](docs/RUN-ISOLATION.md)

## 更新与使用

先备份实际使用的 playbook-state.json；用原服务账号、相同 DSH_HOME 和 Web Profile 更新：

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

重启原服务并刷新网页。新任务可以开新会话直接给任务书；被本次路径/兼容错误卡住的任务应回到原会话继续，不要为了升级而取消重开。无需手工编写 SOP JSON，旧文件也不会被复制或补写作者标签来冒充新独立实验。

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
