# 0.10.0：小模型高效视频流程

[English](VIDEO-EFFICIENCY.en.md)

## 目标

优化目标是减少模型回合，而不是降低成片 Gate。一次成熟视频任务的正常路径从多阶段串行流程收敛为：

```text
preflight → pilot → produce → qa → awaiting_review
```

用户退回后才进入 `diagnose`。运行隔离、原文/口播完整性、真实音频解码、时间线、字幕、封面、最终视频哈希、生产命令 witness 和固定副本交付继续保留。

## preflight 一次完成

`preflight` 合并任务合同、来源/解释边界、能力探测、完整口播与 `production.json` 冻结。对道家文化任务仍要求区分原文、解释与现代应用；对实验/教程仍要求区分方法、观测与结论。区别只是这些事实不再拆成多个必须重新请求模型的 Gate。

项目若已有上一期 accepted preflight 的能力提示，状态会提供 `project.capabilities`。它只保存非敏感的 selectedPipeline、reusableCapabilities、limits 和 verifiedAt。下一期应对实际使用的外部服务做最小健康检查，失败才重新发现替代能力。令牌、Cookie、密码不得写入缓存。

## pilot 与 produce

`pilot` 只验证一个自然完整段。通过后 `produce` 批量生成独立素材，支持并发时先启动再统一收结果；不鼓励一个图片/音频一次模型思考。只因字幕、布局或 mux 改动时复用同 Run 未变素材。

## QA 一次收敛

媒体验证器先做便宜的结构 lint：缺 script/segment audio/timing/video/cover/title/subtitles/duration/hash 时，尽量一次返回全部 `diagnostics[]`，避免“一次 submit 才发现一个字段”。只有结构满足后才进行真实文件读取、FFmpeg 解码和时间线/字幕/哈希检查。

内容审查并入 QA。视觉默认从最终视频生成 8–16 帧 contact sheet，一次查看；只有 sheet 暴露具体问题才逐帧追查。ASR 默认最多一次全片＋一次问题段重试，超时/缺能力就如实标为 unverified，不连续换参数撞服务。

QA 是终态 Gate；通过后候选进入 `awaiting_review`，现有固定快照交付自动运行，不再新增 handoff 思考回合。用户接受仍必须是直接用户决定。

## 无进展与软预算

阶段有软工具目标：preflight 12、pilot 10、produce 36、qa 14、diagnose 8。超过目标只提示收敛，不自动降低质量或取消任务。

同一 stage/epoch 中，对完全相同参数的 read/grep/glob 连续执行三次后，第四次会得到 `NO_PROGRESS_REPEAT`。一次 write/edit/不同诊断会打断序列。该规则避免把“重复读取同一输入”当成思考，不限制正常不同范围读取。

## 兼容

旧活动 Run 继续使用固定的旧 SOP 快照，不会在升级时突然换阶段。新任务使用 0.10.0 短链。旧项目已批准 SOP 也仍保留原定义；如需改成短链，应按正常项目 SOP 版本机制重新评审。
