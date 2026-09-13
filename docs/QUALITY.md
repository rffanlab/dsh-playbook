# v0.3.0：执行证据与格式修复

[English](QUALITY.en.md)

本轮是对 v0.2.0 的代码审计修复。请求评估的外部实验正文未能读取；下面的回归场景由源码构造，不代表已复现某个模型的真实会话，也没有真实模型质量提升数据。

## 修复的漏洞

空格不再能凑够字符串长度，`[null]`、`[{}]` 等空证据不能通过；显式允许为空的发现列表仍可提交 `[]`。不支持的 gate 字段会报错，不再悄悄忽略所谓 validators。

`playbook(action="check", stage_id="...", evidence={...})` 预检不会推进阶段、消耗重试或写盘。真正提交时，纯格式错误会保留当前阶段和已观测工具记录，单独给三次格式修正机会；连续错误进入 blocked。明确的验收条件不满足、缺实际工具调用或错误的验证回执仍使用执行重试/回退规则。

失败的证据不再作为 accepted evidence 传给下一阶段。回退到实现阶段会失效该阶段及后续阶段的已接收证据，避免拿旧测试结论验收新代码。最终成功仍取决于重新通过当前规则；不是自动撤销文件或外部副作用。

## 真实命令回执

内置 `bug-fix/verify`、`feature-development/verify`、`plugin-development/verify`、`dsh-plugin-development/package-check`、`release/build` 新增命令回执要求：

1. 通过现有 DSH `bash` 工具运行实际验证，使用前台执行。
2. `status` 的当前阶段工具 observations 中取得 callId。
3. 提交 `verification_call_id` 与实际执行的完整 `verification_command`。
4. 插件核对 Host 最终 canonical result：必须前台、退出码 0、无取消/超时/信号/沙箱拒绝，命令指纹与 callId 对应。

后台任务接受回执、非零退出码、未知结果格式、旧阶段回执、模型自报“测试成功”、输出正文里的伪造 `[exit code: 0]` 都不能代替验证。不会为了验证而绕开已有工具/沙箱/授权；插件没有另开一个任意命令执行器。

自动收集器只保存 callId、工具名、命令 SHA-256、状态与退出码，不拷贝 stdout/stderr 或命令原文。模型提交的 evidence 仍会持久化，所以不要在 verification_command 里写密钥字面量，使用环境变量。

**边界：证明某条命令正常退出，不等于证明它是正确、充分、不可篡改的测试。** `echo` 可以正常退出但不是验证；测试选择仍需按实际需求审查，尚无独立 Reviewer/文件内容验证器。其他内容类 Gate 仍主要是结构化证据检查，不代表文章、音乐或视频质量已经被独立验收。

自定义规则格式：

```json
{
  "evidence": [
    {"key":"check_id","type":"string"},
    {"key":"check_command","type":"string"}
  ],
  "toolResults": [
    {"name":"bash","callIdKey":"check_id","commandKey":"check_command"}
  ]
}
```

当前只识别已核实的 DSH foreground canonical-result 结构；不识别时会拒绝验证，不能偷偷把未知当成功。当前阶段每个工具只保留最近 16 个回执，回执过旧时须重新取得实际检查结果。工具重复回调去重窗口为最近 128 个 callId，不声称无限历史去重。

## 缺少能力时先阻塞，不填假材料

模型可以 `action=block`，通过 `note` 说明缺失的资料、工具或权限。blocked 保存原 run/stage，不允许普通工作工具继续执行，自动接单也不会覆盖它。PTC 的 `run_code` 保留为控制工具的传输入口，内层工具仍受 Guard 检查；这不是 OS 级隔离。

处理完阻塞原因后，用户在 DSH 聊天框执行 `/playbook resume`，再发“继续”；或者在 Playbook 面板点击“恢复原阶段”，再发“继续”。要放弃用 `/playbook cancel`。这些操作不会自动终止已经发布的后台任务，也不会回滚已完成的副作用。

模型不再能自行 cancel 后 start 来绕开 Gate。已终止任务没有新的直接用户任务时，Agent 不能通过 start/route 重置预算；用户手动命令仍可创建新任务。

## 复盘与上下文

`/playbook report`（或模型 `action=report`）输出当前会话最近一次运行的 Gate 通过/失败、格式修正、回退失效、阻塞统计及事件历史。它不包含完整聊天记录，也不是所有历史任务的数据库；开始新 run 后旧 run 仍会被替换。

阶段 submit 返回 `gatePassed` 和 `nextAction`，避免混淆工具调用的 `ok=true` 与业务验收通过。进度结果不再反复附带全部已接受证据；完整状态仍通过 `status` 查询。系统上下文优先保留任务、失败原因和最近已接受的证据摘要。

## 更新与验证范围

更新 `main` 后重启原 DSH Profile。19 条模板的版本变为 0.3.0，已经启动的运行仍使用原固定 SOP 快照，因此不会自动获得新的命令回执 Gate；新实验请开新会话。

测试分为：源码构造的回归测试、模拟 Host 接入测试、真实已发布 DSH SDK 契约检查、打包导出检查。它们不替代用户实际安装版本、真实 Web 浏览器、MiniMax 或其他模型的端到端实验。

可选 `toolResults[].command` 可由 SOP 作者固定真实检查命令；设置后，即使模型如实提交一个无关的成功命令也不能过关。内置通用流程不知道具体项目的测试命令，未设置这一固定值，仍需要选择/审查正确的检查命令。
