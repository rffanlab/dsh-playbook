# dsh-playbook

[English](README.en.md)

**把工作方法保存成项目 SOP：先读任务，再选择或创建流程，用阶段、证据与检查器执行。**

## 0.5.0：项目方法库

视频和引用任务书的任务不再仅凭关键词开工。Agent 先读取任务资料、识别项目，再复用项目 SOP；没有合适的方法时，可以派生并保存试用定义。

道家文化讲解与 B 站实验/教程保留不同业务阶段，即使道家视频也发到 B 站，平台也不取代内容项目。稿件覆盖、音频/媒体技术检查、版本绑定和受控返修继续共用。现有基础库为 20 个 SOP，项目方法库独立持久化。

**试用不等于已确认。** 新版本不可覆盖旧定义；删改保护规则的提案不能直接执行。只有用户确认精确版本，才成为该项目的已确认方法；活动任务仍固定启动快照。

## 安装与更新

使用原服务账号、相同 DSH_HOME 和 Web Profile；更新前备份状态文件：

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

重启原 Profile、刷新页面、新建会话，直接交任务书。无需每天指定 SOP、编写 JSON 或手工提交证据。

完整用户说明：[项目 SOP 与迁移](docs/PROJECT-SOPS.md)。已有功能：[自动选流](docs/AUTO-ROUTING.md)、[媒体契约与返修](docs/MEDIA-REVISION.md)、[执行回执与格式修复](docs/QUALITY.md)。旧版本文档记录对应版本，不代表所有新功能已经在真实模型上验证。

## 查看与管理

在 DSH 聊天框输入，不是 Linux 终端：

```text
/playbook status
/playbook report
/playbook project
/playbook sops
/playbook sop <sop-id> <revision>
/playbook approve <sop-id> <完整revision>
/playbook auto off
/playbook cancel
```

Web 设置 → Playbook → 当前项目 SOP，可以查看完整提案和规则差异，再确认精确版本为项目默认。批准不是每次执行的审批。模型侧没有 approve action。

Agent 工具新增 `intake_status/intake/sop_list/sop_inspect/sop_validate/sop_save`；保留路由、执行、检查、返修和报告。试用新增可以自动完成，已确认的规则修改需审阅。首次提取的方法质量仍需实验，而不是一次结构通过即称为专家经验。

## 范围与边界

项目按 Host session cwd + project_id 隔离，状态在原 playbook-state.json 的 sopLibrary 中；格式 v3，读取兼容 v1/v2。旧运行继续固定旧快照，回退前恢复对应状态备份。单进程写入，每项目最多 100 个不可变版本。

同名旧全局 JSON 不再覆盖内置基线（警告并忽略）；其它旧自定义 ID 仍按原全局方式加载，不自动成为已确认项目方法。请迁移至管理接口，而不是让模型直接改全局文件。

本版强读取回执支持 UTF-8 read；完整粘贴的任务正文也可作为输入。来源相关性、规则提取是否完整、新增文字是否语义冲突仍需 Agent/人工判断。保护是管理接口上的保守静态检查，不是恶意 shell/同进程插件的 OS 沙箱或签名防篡改。

媒体检查继续需要 Python 3.9+、FFmpeg 和 ffprobe，不新增模型/API Key；没有 ASR 或独立语义 Reviewer。技术通过不能自动证明内容优质或用户已接受。

## 开发验证

```bash
npm test
npm run check
npm run packcheck
npm run mediatest
```

装有实际 DSH peers 时执行 `npm run sdkcheck`。CI 覆盖 Node 20/22/24、真实 SDK 契约和合成媒体解码；不替代用户 E5 上真实 Web Profile、浏览器和 MiniMax 端到端测试。

MIT
