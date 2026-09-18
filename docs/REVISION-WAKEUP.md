# 0.9.1：退回后直接进入执行，不只是改状态

[English](REVISION-WAKEUP.en.md)

## 已确认的问题

DSH 的 commands 接口直接调用命令处理器，命令返回不是模型输入。此前 `/playbook revise` 和面板的拒绝按钮只调用 requestRevision 并保存状态，因此可以出现 command/done 成功、state=active/stage=diagnose，却完全没有新的 turn/start 或工具调用。重复执行 revise 又因为已经 active 而报 No completed/candidate/failed run to revise。

本次修复的是上述调用链，不是视频生产或下载映射问题。

## 执行方式

1. 在原任务中保存返修意见和一条待投递记录。
2. 对命令携带的确切 live Agent 调用公开 `agent.steer(createUserMessage(...))`。
3. 空闲 Agent 由原生驱动唤醒；忙碌 Agent 在最近的步骤边界消费补充意见，不启动第二个并行驱动。
4. 保存 queued 回执；通过原生 agent/inbox/claimed 与 discarded 观察后续接收/取消。状态与报告返回 revisionDispatch。

不能用 inject 代替 steer：inject 不会唤醒空闲 Agent。也不等待 whenIdle 再返回命令结果，否则 UI 要等整段制作结束才知道是否接单。指令沿用原会话、模型、工作目录、工具权限与取消机制，不新增 API Key 或其它执行渠道。

排队不是完成：pending=已保存待投递；queued=已调用原生投递；claimed=宿主已接收该消息；failed=投递失败；discarded=该消息被宿主取消。queued/claimed 都不能证明成品已经生成、通过 QA 或被用户接受。

## 返修中继续补意见

已经 active/blocked 且确实处于现有修订时，新的明确 revise/reject 意见追加到同一 revision 的 supplements。原阶段、stageEpoch、已验收材料和自动预算不因为“补一句意见”被清零。现有真正的 blocker 也不会被解除。

同一原生命令 commandId 的重复投递不重复退回或启动。相同文本再次点击不重复保存同样的补充内容，但一次新的明确命令仍能唤醒当前未完成工作。面板携带的过期候选 target 继续拒绝，防止误操作后来的候选。

普通聊天本来就在一个正在执行的模型轮次中：聊天退回沿原 pre-step 路径登记，不再额外塞一次唤醒消息，避免两套重复执行。模型工具仍没有 revise/reject/dispatch 权限，不能自己伪造用户退回。

## 失败与重启边界

状态写入失败不投递未登记的反馈。原生 steer 缺失/拒绝时，返回具体“意见已保存，但执行消息未送达”的错误，不伪报已经开工。不会退回到 inject、私有 run API、取消或新 Run 来掩盖故障。

投递后若仅审计写盘失败，保留已投递身份；相同命令重试会检查本进程回执、原生 inbox 与公开 Session 插入记录，避免再次送达。任务和 Session 属于两个持久化面，本版不宣称所有断电时序下跨文件严格 exactly-once，也不会在升级时批量复活历史任务或已经取消的消息。原生宿主依赖、模型供应商错误或用户停止操作仍可能让任务不再推进，需要看实际运行错误。

## 原会话恢复

使用原服务账号/DSH_HOME 更新并重启原 Profile：

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

旧会话已经被退回但没有唤醒消息时，再发送原返修命令即可，例如：

```text
/playbook revise 没有字幕，视频没有内容，纯粹是图片堆砌；按这些意见重做。
```

这一次会作为当前返修的补充意见并直接投递，无需之后再发送“继续”，也不需要取消、清空、新建或重新批准 SOP。以后打回只需一次操作。runtimePluginVersion=0.9.1；固定 SOP 版本不用改变。旧任务不会仅因更新自动开始，避免在用户没有操作当前任务时突然恢复旧工作。

## 测试分层

离线测试验证登记先于发送、空闲唤醒、忙碌补充、重复命令、状态写入失败、原生拒绝、投递后写盘失败、取消、过期目标、非命令聊天不双发和模型不能调用用户评审。React/jsdom 测试检查真实面板回调调用 Host 后确实发出 steer，不再只断言阶段变了。

`npm run revisioncheck` 使用实际安装的 DSH commands、AgentLoop、Inbox、Session 和工具运行时，仅 LLM adapter 采用脚本回复。它检验命令→真实 turn/start→真实工具调用→进入原任务修改阶段，以及在真实模型请求等待期间补意见仍只使用同一个 turn。它不是 E5 实机验收，不调用真实模型，不制作用户视频。
