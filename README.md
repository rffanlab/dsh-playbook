# dsh-playbook

[English](README.en.md)

**把专家已经验证过的工作方法，变成 DeepSeek Harness 可以强制执行、验收、失败回退和持续复用的 Playbook。**

> 不要求每一个 AI 都先摸索成大师；先把大师的方法留下，再让普通 AI 按这个方法稳定工作。

## 为什么不是另一个 Skill 管理器

Skill 可以告诉模型“应该怎么做”，但模型仍可能认为自己已经完成。`dsh-playbook` 把流程提升为运行时约束：

- **Stage**：任务被拆成明确阶段。
- **Gate**：只有满足结构化验收条件才能进入下一阶段。
- **Observed Tool Evidence**：Gate 可以要求 DSH 实际观测到工具调用/成功/失败次数，减少“模型自己说测试通过”的情况。
- **Tool Policy**：STRICT 阶段可以使用 DSH 的单调 Tool Guard 硬限制工具；deny 规则始终硬执行。
- **Retry / Branch**：Gate 失败后按专家预先设计的策略重试、失败或退回上一阶段。
- **Durable Run State**：运行状态默认保存在 `~/.dsh/playbook-state.json`，不会只存在于模型上下文里。
- **Version Pinning**：启动时把 Playbook 快照固化进 run；中途 reload 新版本不会偷偷改变正在执行的流程。
- **Dynamic Stage Context**：当前 Stage 契约会按 Session 动态进入系统提示词，人工从 Web/命令启动后模型也会自动看到当前规则。

探索不是默认工作方式；只有 Playbook 明确设计了 fallback 时才进入探索。

## MVP 能做什么

安装后注册一个模型工具：`playbook`。

模型可执行：

- `list`：查看 Playbook
- `start`：在当前 Session 启动 Playbook
- `status`：读取当前 Stage / Gate
- `submit`：提交结构化 evidence，由插件判 Gate
- `reload`：重新加载用户 Playbook
- `cancel`：取消当前运行

同时提供 `/playbook` 命令用于人工查看和控制，并在 Web 设置页增加 **Playbook** 面板：可查看当前会话运行状态、Gate、工具观测，并直接启动/取消 Playbook。

### 三种 Stage 模式

- `strict`：如果配置 `tools.allow`，其他工具会被硬拒绝；`tools.deny` 也会硬拒绝。
- `guided`：流程和 Gate 强制执行，工具 allowlist 仅作为说明；deny 仍硬拒绝。
- `free`：允许创造性解决问题，但仍必须通过 Gate；deny 仍硬拒绝。

## 安装

当前开发版直接从 GitHub 加到 Web profile：

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook
```

开发分支测试可指定：

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#feat/playbook-mvp
```

插件的 `cordis.patch.yml` 会自动加入 DSH profile，无需手工改 `cordis.yml`。

## 用户 Playbook

默认目录：

```text
~/.dsh/playbooks/*.json
```

可通过环境变量修改：

```text
DSH_PLAYBOOK_DIR=/path/to/playbooks
DSH_PLAYBOOK_STATE=/path/to/playbook-state.json
```

复制 `examples/bug-fix.playbook.json` 到该目录，然后执行：

```text
/playbook reload
/playbook list
```

当前 MVP 首先支持 JSON；YAML、可视化编辑器和 Playbook Marketplace 放在后续版本，避免第一版把精力耗在格式而不是执行闭环上。

## Playbook 示例

```json
{
  "id": "verify-change",
  "version": "1.0.0",
  "stages": [
    {
      "id": "inspect",
      "mode": "strict",
      "objective": "先检查，再修改",
      "tools": { "allow": ["read", "grep"] },
      "gate": {
        "evidence": [
          { "key": "root_cause", "type": "string", "minLength": 20 }
        ]
      }
    },
    {
      "id": "verify",
      "mode": "guided",
      "objective": "运行测试并证明修改有效",
      "gate": {
        "evidence": [
          { "key": "fixed", "type": "boolean", "equals": true }
        ],
        "observedTools": [
          { "name": "bash", "minCalls": 1, "minSuccesses": 1 }
        ]
      },
      "retry": { "maxAttempts": 2, "onExhausted": "branch:inspect" },
      "next": null
    }
  ]
}
```

这里 `fixed=true` 是模型提交的声明，而 `bash minSuccesses=1` 来自 Harness 对真实工具结果的观测。两类证据同时存在时，Gate 才能通过。

## 内置 `bug-fix` Playbook

MVP 自带一条可以立刻做实验的软件修 Bug 流程：

```text
reproduce → root-cause → implement → verify → review
                              ↑          │
                              └──────────┘ verification failed
```

关键限制：

- reproduce/root-cause 阶段禁止 `write` / `edit`。
- verify 阶段要求至少一次 `bash` 成功记录。
- verify Gate 两次不过会返回 implement。
- review 不通过也返回 implement。

## Gate 的信任边界

MVP 已经比纯 Prompt/Skill 强，但要明确边界：

1. **插件能强验证**：Stage、重试次数、分支、工具 allow/deny、某工具是否真实被调用及结果成功/失败。
2. **插件只能做结构验证**：模型提交的 `root_cause`、`review_summary` 等语义内容，目前能检查类型、长度、数量、精确值，但不能证明内容本身是真的。
3. 后续版本会加入 **validator gate**：Shell/Test validator、文件 validator、schema validator、reviewer subagent validator，让更多 Gate 从“模型声明”升级成“外部验证”。

这个边界是刻意保留的：第一轮实验先验证“预定义 Stage + 硬 Gate + 工具事实”是否已经明显减少探索和返工，再决定哪些 validator 最值得做。

## A/B 实验

我们建议同一个任务分别运行：

**A：普通 DSH**

```text
直接给任务，让 Agent 自由规划和执行。
```

**B：DSH + Playbook**

```text
先 playbook.start("bug-fix")，再执行同一任务。
```

记录：

- 是否一次完成
- 总模型轮次
- 工具调用数
- 无效/重复工具调用数
- 返工次数
- 是否跳过关键步骤
- 最终人工验收结果
- 所用模型大小/能力

真正要验证的不是“Playbook 会不会让最强模型更强”，而是：

> **成熟流程能不能把较弱模型的稳定交付能力，拉近到更强模型。**

## 开发

```bash
npm test
npm run check
npm run packcheck
```

## Roadmap

- 0.1：Stage / Gate / retry / branch / hard tool policy / durable state / built-in bug-fix / 基础 Web 面板
- 0.2：Shell/Test/File/Schema validator gates
- 0.3：与 `dsh-subagent-mgr` 联动，Stage 可指定 worker / 模型档位
- 0.4：可视化 Playbook 编辑器、完整执行时间线、Gate 证据面板
- 0.5：Playbook 版本化、运行指标、A/B benchmark
- 0.6：未知情况 Explore fallback → improvement proposal → 人工审核 → Playbook 新版本

## License

MIT
