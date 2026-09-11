# 自动接单与选择流程

[English](AUTO-ROUTING.en.md)

## 用户入口

更新插件、重启同一个 DSH Web Profile 后，打开新会话直接给任务，例如：

> 给 DSH 开发一个图片管理插件。

不用先执行 `/playbook start`。默认启用自动匹配：

1. `agent/pre-step` 只查看当前被接纳的**直接用户文本**，不把工具结果、插件通知、历史回放或子代理任务当成新接单。
2. 对中文/英文关键词组做保守匹配。高置信规则匹配会在模型开展工作前启动对应 SOP，并在**同一轮**加入当前阶段契约。
3. 规则无法唯一匹配时，插件给 Agent 候选列表。Agent 用 `playbook(action="route", playbook_id="...", note="选择理由")` 进行语义选择并启动。这里用的是当前 Agent，不新增独立分类模型、API Key 或额外在线服务。
4. 信息确实不足时，Agent 询问交付目标、范围或缺失输入；不是让用户记住和选择内部 SOP 名称。
5. 运行中的补充说明不会自动切换流程；新的独立任务建议使用新会话。复合任务当前不会自动拆成多个并行 SOP。

这是**保守规则 + 当前 Agent 语义判断**，不是已经验证准确率的意图分类器。`high/low` 是启发式分级，不是概率。

## 用户不需要做的事

不用写 JSON，不用记命令，不用逐步提交 evidence，不用给每个 SOP 单独配置模型。
高置信启动只选定工作方法，不授予发布、删除、签约、账号操作等额外权限。

## 查看与控制

以下输入 DSH 聊天窗口，不是 Linux Shell：

```text
/playbook list
/playbook inspect dsh-plugin-development
/playbook status
/playbook status json
/playbook recommend 帮我写一篇公众号文章介绍这个插件
/playbook auto off
/playbook auto on
/playbook cancel
```

`recommend` 只推荐、不启动。`route` 会在明确匹配或 Agent 显式选择时启动。
`auto off` 只关闭当前会话的后续自动接单，不取消活动流程；设置在 Host 重启后恢复默认。部署级默认关闭可设置 `DSH_PLAYBOOK_AUTO_ROUTE=0`。
取消流程不能撤销已经执行的文件或外部操作。不要将取消当成回滚。

## Agent 的接口

```json
{"action":"recommend","task":"给 DSH 开发一个图片管理插件"}
```

```json
{"action":"route","task":"给 DSH 开发一个图片管理插件"}
```

歧义时先 `inspect`，再由 Agent 选择：

```json
{"action":"route","playbook_id":"wechat-article","note":"用户的最终交付物是公众号文章，插件开发只是文章主题"}
```

启动后的 `submit` 必须提供 `stage_id` 和完整 evidence。阶段提示现在会列出类型、最短长度、最少条数和固定值要求。

## 自定义 SOP

默认目录是 `${DSH_HOME:-~/.dsh}/playbooks/*.json`，支持 `DSH_PLAYBOOK_DIR` 覆盖。使用运行 DSH 服务的账号和环境，不要把文件写到另一个用户的 `~/.dsh`。
自定义定义以相同 ID 覆盖内置目录项，但已经运行的任务继续使用启动时固定的快照。

在已有 Playbook JSON 的顶层增加：

```json
{
  "routing": {
    "groups": [["核对", "检查"], ["发票", "invoice"]],
    "keywords": ["报销"],
    "exclude": ["解释发票"],
    "priority": 20,
    "autoStart": true,
    "examples": ["请核对这批发票"]
  }
}
```

`groups` 组间是 AND，组内是 OR；全是文字匹配，不执行正则/脚本。`priority` 范围 -50 到 50，用于区分专用流程与通用流程。`autoStart=false` 阻止规则自动选择，但仍可由用户或 Agent 显式选择。修改后 `/playbook reload`。

## 失败与边界

- 读取持久状态完成前不自动启动，避免和恢复中的运行冲突；状态读取错误时报告自动流程未启动。
- 串行选择防止重复创建；当前活动流程不被另一条自动请求覆盖。
- Gate 总提交预算默认 64 次，防止失败回退形成无限循环；这不是模型总 token 或墙钟时间预算。
- 匹配阶段的工作工具需先完成选流；PTC `run_code` 仅作为传输入口放行，内部工具仍经过原 Guard。此约束不是操作系统级沙箱，无法约束恶意 Host 插件或逃离 Harness 工具层的代码。
- 审查/复现阶段只限制列出的工具名；阻止 `write/edit` 不等于阻止所有 shell 写盘途径。
- 模型自报事实目前是**结构验收**，不是独立语义验证。`bash` 工具成功不能证明 shell 退出码为 0，也不能证明测试通过。
- SOP 不自带视频、音乐、模型推理引擎；必须使用已安装且可访问的工具。没有能力时不能声称产物完成。
- 19 条都是待真实案例校准的起始模板，不是所有行业 SOP，更不保证弱模型已经达到强模型的效果。

## 对照实验

准备两个初始代码/素材状态完全相同的新会话，固定模型、参数、工具与任务输入。
A 会话 `/playbook auto off`，确认没有活动流程；B 保持默认开启。
比较实际验收结果、模型轮次、工具次数、失败分支、人工介入和耗时。不能让 B 在 A 已修改过的仓库上重跑，否则不是公平对照。
