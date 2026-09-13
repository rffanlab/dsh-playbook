# dsh-playbook

[English](README.en.md)

**给任务，自动选择 SOP，再按阶段和验收条件执行。**

v0.4.0 内置 **19 条工作流程**，覆盖开发、审查、发布准备、故障恢复、服务/模型部署、视频、公众号、音乐、调研、数据分析和 SOP 编写。它是 DeepSeek Harness 插件，不是另一个聊天 Agent。


## 0.4.0：真实媒体检查与原任务返修

新增完整稿/配音段/字幕覆盖检查、首段样片、真实 PCM 和媒体解码、文件哈希与旧封面失效、awaiting_review、同 run 修订、受控 repair 和事件生成报告。只对新启动的两条口播视频生产 SOP 开启全套媒体契约；其余 SOP 得到通用状态改进。

完整说明与 Agent 制作清单格式：[媒体与返修](docs/MEDIA-REVISION.md)。需要现有 Python 3.9+、ffmpeg/ffprobe；不自动安装、不新增模型、不绕过 Host 工具权限。不是 ASR、视觉语义审核或 MiniMax 实测效果保证。

## 0.3.0 执行质量修复

新增真实命令回执 Gate、无副作用 `check`、格式修正与执行重试分离、持久化阻塞/人工恢复、旧证据失效和运行报告。自动接单与 19 条 SOP 保留。模型不能用 cancel/start 绕开 Gate；用户仍可取消/恢复。详见 [执行证据与格式修复](docs/QUALITY.md)。已有 run 保留旧 SOP 快照，新规则请开新会话测试。

## 直接开始

在运行原 DSH 服务的相同账号、相同 `DSH_HOME` 和 Web Profile 中更新：

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

重启 DSH，刷新 Web 页面，打开新会话，直接说：

> 给 DSH 开发一个图片管理插件。

> 帮我写一篇公众号文章介绍这个插件。

> 在 Ubuntu 部署 Qwen 模型。

**不需要 `/playbook start`，不需要手写 JSON，也不需要你逐步提交 evidence。**

明确匹配时插件直接启动；匹配有歧义时当前 Agent 先查询候选、读取流程并选择。只在目标、范围或输入确实不清楚时询问你，而不是问你“想用哪个 SOP”。闲聊与普通用法解释不会强制启动工作流。

## 如何执行

```text
用户任务 → 规则匹配 / Agent 语义选流 → 当前阶段
                                       ↓
                                提交真实 evidence
                                       ↓
                          Gate 通过 → 下一阶段 / 完成
                          Gate 失败 → 重试 / 回退 / 失败
```

系统默认开启自动接单。规则使用中英文词组，不会新增分类模型或要求另配 API Key。
活动流程不会被一条补充说明自动替换；独立新任务建议开新会话。当前不做自动多 SOP 并行编排。

完整用法：[自动接单说明](docs/AUTO-ROUTING.md)。完整目录：[19 条 SOP 与验收要求](docs/SOP-CATALOG.md)。

## 内置范围

| 类别 | SOP ID |
|---|---|
| 开发与审查 | `bug-fix`、`feature-development`、`plugin-development`、`dsh-plugin-development`、`code-review` |
| 发布、恢复与部署 | `release`、`incident-response`、`linux-service-deploy`、`model-deployment` |
| 内容与音乐 | `short-video-production`、`bilibili-video-production`、`video-review`、`wechat-article`、`music-production`、`music-release` |
| 调研与通用接单 | `research-report`、`data-analysis`、`sop-authoring`、`task-intake` |

每条都有具体步骤、指令、产物证据和失败策略。`task-intake` 是明确标注的未知任务接单兜底，不冒充领域专家方法。
这些是可测试的**起始模板**，尚不意味着已在真实业务中证明“最优”或“弱模型等于强模型”。

## 保留人工控制

在 **DSH 聊天输入框**输入，不是终端：

```text
/playbook list
/playbook inspect dsh-plugin-development
/playbook recommend 帮我写公众号文章
/playbook status
/playbook status json
/playbook report
/playbook revise
/playbook accept
/playbook resume
/playbook auto off
/playbook auto on
/playbook start bug-fix
/playbook cancel
/playbook reload
```

`recommend` 不启动；`auto off` 关闭当前会话的后续自动接单，不取消已有流程，Host 重启后恢复默认。整个部署默认关闭可设置 `DSH_PLAYBOOK_AUTO_ROUTE=0`。

Web 设置 → 插件 → **Playbook** 原有面板继续用于查看目录、当前会话 Stage、Gate 和工具观测，以及手动启动/取消。自动接单不需要先打开这个面板。

## 自定义 SOP

默认加载 `${DSH_HOME:-~/.dsh}/playbooks/*.json`；可用 `DSH_PLAYBOOK_DIR` 覆盖目录，用 `DSH_PLAYBOOK_STATE` 覆盖状态文件路径。
执行 `/playbook reload` 加载新定义。相同 ID 覆盖内置目录项，但不会修改已启动任务的固定快照。

路由支持 `routing.groups`、`keywords`、`exclude`、`priority`、`autoStart` 和 `examples`；详见自动接单说明。没有路由规则的自定义 SOP 仍可由 Agent 或用户显式选择。

模型工具提供 `list/inspect/recommend/route/start/status/check/submit/block/repair/report/export_report/reload`。`check` 和 `submit` 要求明确提供 `stage_id`。模型侧 `cancel` 仅保留为返回明确错误的兼容入口；取消与恢复由用户命令或面板操作。

## 执行保障与边界

- 保留 Stage/Gate、重试分支、固定版本快照和持久运行状态；加载状态完成后才接受自动启动。
- 当前阶段提示包含完整 evidence 类型、长度、条数和固定值要求，并带有有界的上游证据摘要。
- 默认每次运行最多 64 次执行 Gate 提交；纯格式修正单独最多 3 次后阻塞。两者都不是总 token/时间预算。
- 保留 `strict/guided/free` 模式。工具名约束由 DSH guard 执行，**不是 OS 沙箱**；禁止 `write/edit` 不等于禁止所有 shell 写盘。
- 模型提交的语义证据目前仍只是结构检查。真实工具观测也不等于语义验证：`bash` 调用成功不代表退出码为 0，更不代表测试已经通过。
- 视频/音乐/模型 SOP 不会替你安装推理或生成引擎；缺能力时必须报告，不能伪造成品。
- 自动选流不授权发布、上传、删除、购买、签约或账号操作。现有用户授权和 Host 权限策略继续生效。
- 状态面向单 Host 进程；不要让多个 DSH 进程同时写同一个状态文件。

独立 Test/Reviewer 与自动子代理模型分配、完整可视化编辑器仍未实现；媒体文件检查已在 0.4.0 两条视频 SOP 中落地，详见媒体说明。

## 验证与开发

在源码仓库运行，无模型调用：

```bash
npm test
npm run check
npm run packcheck
npm run mediatest
```

装有实际 DSH peer dependencies 时可运行 `npm run sdkcheck`，验证真实 SDK 的导入、工具定义、返回值和消息构造。
CI 在 Node 20/22/24 跑离线测试，并单独跑当前已发布 SDK 的契约冒烟。它不替代目标安装版本的真实 Web Profile、浏览器和模型端到端验收。

同任务做 A/B 时，固定初始代码/素材、模型和工具；A 新会话关闭自动接单且无活动流程，B 新会话默认开启。对比实际验收、轮次、调用、返工和人工介入，不要用不同初始仓库证明提升。

## License

MIT
