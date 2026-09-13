# 0.4.0：从 MiniMax 实验失败到受控视频交付

[English](MEDIA-REVISION.en.md)

## 更新和入口

使用运行原 DSH 服务的账号、相同 DSH_HOME 和 Web Profile 更新，不需要新建模型或 API Key：

```bash
dsh plugin --profile web add github:rffanlab/dsh-playbook#main --force
```

重启该 Profile，刷新网页，开新会话直接给任务。自动接单与 19 条内置 SOP 保留。只有新启动的 `bilibili-video-production` 和 `short-video-production` 采用本轮完整的口播视频契约；其它 SOP 得到通用返修、格式纠错和报告改进，不冒充已经全部有独立媒体检查。原来已启动任务保留固定快照，不自动升级规则。

## 新生产链

明确交付 → 核实公共工具/模板 → 完整口播与逐段文本冻结 → 第一自然段样片 → 全量制作 → 独立技术 QA → 内容审核 → 待用户验收候选。

正常成功路径有 **8 个阶段**，定义中另有一个仅返修使用的 `diagnose` 节点，共 9 个节点。数量来自实际图，不手写成“五阶段”。不保证弱模型效果、播放量或成本已经改善。

## 同一份制作清单贯穿全程

Agent 在当前会话工作目录内创建一个 `production.json`；用户不需要自己填表。清单内相对路径均相对于清单目录，而 `production_manifest` 参数相对于 DSH 当前会话工作目录。

脚本阶段只需要：

```json
{
  "schemaVersion": 1,
  "script": "narration.txt",
  "segments": [
    {"id": "S01", "text": "第一段完整口播，不是摘要。"},
    {"id": "S02", "text": "第二段完整口播，不是省略号占位。"}
  ]
}
```

`narration.txt` 是只包含实际要说的完整文稿。检查器对 Unicode 和空白规范化后，验证按顺序拼接的段文本与全文相等；不禁止文学性省略号，禁止用省略摘要代替原文。段 ID 不得重复。首次通过后，脚本与逐段文本摘要被绑定；后续修改必须退回 `script`，不能偷偷换稿。

试做阶段补上第一段 `audio` 与 `pilotVideo`，先检查一个自然完整段再批量制作。全量制作后补全（下列时长/hash 只是结构示例，必须用实测值）：

```json
{
  "schemaVersion": 1,
  "script": "narration.txt",
  "segments": [
    {"id":"S01","text":"第一段完整口播，不是摘要。","audio":"voice/S01.wav","start":0,"end":4.2},
    {"id":"S02","text":"第二段完整口播，不是省略号占位。","audio":"voice/S02.wav","start":4.2,"end":8.5}
  ],
  "pilotVideo":"pilot.mp4",
  "video":"final.mp4",
  "cover":"cover.png",
  "title":"title.md",
  "subtitles":"captions.srt",
  "durationSeconds":8.5,
  "coverForVideoSha256":"填写实际 final.mp4 的 SHA-256，不是这段占位文字"
}
```

所有字段由 Agent 随制作补全。SRT 时间需有效、不重叠、不超出视频；字幕正文也需覆盖规范稿。源音频可以引用真实已生成的 WAV/MP3/FLAC 等本地文件；不同台词不得指向完全相同的音频字节。

## 什么是独立检查，什么不是

在带 validator 的 `submit` 中，插件通过 **同一 Agent 的 DSH bash 工具**执行插件自带只读 Python 检查器；继承 parent/rootCallId、取消信号、权限、沙箱和其它 Guard。没有宿主裸 shell/文件读取回退，也不调用新增在线模型。模型传来的 `passed`、`release_ready` 或自造验证 JSON 不参与机器判定。

依赖：Python 3.9+（仅标准库）、ffmpeg、ffprobe。缺可执行文件或权限就报告 unverified/blocked，不自动下载安装。缺少刚制作的文件属于可返修检查失败，不强迫用户点恢复。检查范围是当前会话工作目录（含真实路径和 symlink 检查）；不支持远程 URL、播放列表或跨目录资源伪装成单一媒体文件。单文件上限 512 MiB、文本清单 1 MiB、视频时长上限 15 分钟；超限不假称已全量检查。

机器检查包括完整文本覆盖、源音频可解码/非全零、完整视频和音轨解码、音量样本、低电平区间、A/V 时长、段落时间表、字幕文本与时间、封面可解码及视频哈希/时长绑定。以读取时文件哈希为准，读取前后变化拒绝；交付时再次检查哈希与 QA 快照一致。

当前讲解视频的测试策略是：100ms PCM 窗口 RMS 低于 -40dB 算低电平，至少连续 0.3 秒记区间；最长超过 3 秒或累计比例超过 50% 不放行。它是公开的模板策略，**不是 B 站规则，不是通用音频质量标准**。有意的长静默、音乐视频、超长/超大文件等需要单独的 SOP 规则，不能谎填通过。

**没有 ASR 或声纹/音素对齐。** 文本覆盖证明规范稿与声明的 TTS 输入一致，不证明声音逐字念对；背景音乐也可能掩盖缺失口播。没有 OCR 去读取封面文字，更没有把帧差/进度条当成叙事质量。结果显式携带 `speechRecognition=false`、`semanticVerification=false`。真实听觉、视觉与事实审核仍要由有相应能力的 Agent 或用户完成，缺能力要标未验证。

封面防过期：重做视频后若封面字节仍与被否决版本完全相同，检查会要求重新生成/审核，避免沿用旧时长文字。这个保守规则可能也拦住可复用的通用封面；它不是“已读懂封面文字”，也挡不住恶意只改一个无意义像素。交付文件的哈希绑定是时点证据，不是对之后外部进程改文件的永久保证。

## 不再在 SOP 外“精神上返修”

视频交付状态为 `awaiting_review`，不是用户已经接受。你直接说：

> 最终成片验收不通过，请按照 SOP 自行检查并返修。

pre-step 会先识别明确的直接用户退回，给**原 run**增加 revision，再进入 `diagnose`，不新开一个独立 video-review 丢掉原关系。Agent 用 `repair` 选择同级或更早的 `script/pilot/produce/qa/content-review`，保留任务 ID、旧候选哈希、否决事件、重试历史和预算。技术返修后影响到的证据/检查自动失效。

新命令（在 DSH 聊天框，不是 Linux 终端）：

```text
/playbook report
/playbook report markdown
/playbook revise 请自行定位原成片问题并返修
/playbook accept
```

也可直接回复“验收通过”记录接受。代码块、引用、假设性问题不会自动作为接受/否决授权；不明确的自然语言可能需要上述显式命令。自动接单关闭时使用显式命令。

默认每次运行全局 64 次执行 Gate 提交；视频最多 2 次用户修订、3 次自主技术 repair。repair 不重置历史/全局预算，不允许跳过前置步骤。达到上限需要用户做明确新决策，不能伪装成功。没有 `delivery` 契约的其它 SOP 默认最多 2 次自主技术 repair。

真正 failed 之后普通工作工具仍受限，但 `playbook repair/report/check` 可以使用；缺权限/依赖的 blocked 仍需用户处理后 `/playbook resume`，不能用 repair 放大权限。用户取消始终可用，并不回滚已有文件或后台作业。

## 格式修正不再强迫重做工作

本次日志里的唯一 `{ "item": [ ... ] }` 包装，在 Gate 要求数组时，会被无损解包并记录 `evidence_shape_corrected`。有额外字段、非数组或歧义对象不会随便强转。其它错误给出路径、期望类型、收到类型和正确形状提示。`check` 只是可选的格式/回执预检，媒体 `machineChecksPending=true` 时不能冒充实际验收通过。正式提交才独立读取媒体。

## 由事件生成报告

Agent 在候选交付后调用 `playbook(action="export_report")`，插件在已验证视频旁通过 DSH 的 `write` 工具生成唯一命名的 `execution-report.system.rN.<id>.md`。路径与正文由插件生成，不由模型填入计数。写入仍经过其它 Guard/权限；失败没有裸文件写入回退。使用 `report` 也可直接返回 JSON/Markdown。

系统事实包括声明/正常路径阶段数、实际 Gate 次数、格式修正、技术返修、用户否决/接受、版本号、候选哈希与引擎时间。引擎起点不是用户消息入队时间；耗时包含等待，不是 LLM 计算时间。报告不签名，也不防止有写权限的人之后改文件；不得声称“不可篡改”。模型分析可另写，但不要替代这份事实区。

同会话明确启动新任务会保存最近 20 个旧 run 的完整快照；当前报告列出旧 run 索引，完整历史保存在状态文件 `archives`。不是无限数据库，也不是完整 session 日志。状态格式 v2，兼容读取 v1；旧版本不能可靠处理新状态，所以回退前先备份状态。

## 验证口径

回归覆盖真实失败模式：全文与摘要不一致、全静音、单声响加长静默、旧封面/时长、字幕漏段、失败后继续干活、退回误开新任务、数组包装错误、旧 run 覆盖和虚构系统统计。公共仓库仅保存匿名/合成夹具，**不上传用户原始 session、成片或私人素材**。

Node 测试验证状态和接口；Python 测试用真正 FFmpeg 生成技术夹具并解码。纯音夹具通过只证明技术规则能运行，不证明配音语义。真实 MiniMax 复测尚未执行；CI/本地通过不等于 E5 Web Profile、浏览器、实际工具与模型已经端到端通过。
