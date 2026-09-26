# 0.9.4：让小模型从 Gate 失败中直接恢复

[English](SMALL-MODEL-RECOVERY.en.md)

## 真实故障

一轮 27B 视频任务在 QA 收到 `video: A non-empty local path is required` 后无法判断缺的是哪个路径。`production.json` 顶层 `video` 实际存在；真正不符合验证器旧契约的是后续 `segments[]` 没有内联 `audio/start/end`，而这些值放在顶层 `segmentTiming`。

由于错误只来自通用 `Reader.path()`，字段上下文丢失。27B 随后对同一个 `production.json` 发出 170 次完全相同的 read。切换更大模型后，它通过读取 `media_worker.py` 源码才反推出验证器结构要求，然后继续处理。

这说明瓶颈不是“27B 不会做视频”，而是插件把内部接口契约藏在源码里。SOP 的职责应当是把下一步缩小到小模型可以可靠完成的动作。

## 新诊断契约

媒体验证器对可修复的清单问题返回：

```json
{
  "failures": [
    "MANIFEST_PATH_REQUIRED: segments[1].audio: expected a non-empty local file path"
  ],
  "diagnostic": {
    "code": "MANIFEST_PATH_REQUIRED",
    "path": "segments[1].audio",
    "hint": "...最小修复方式...",
    "doNotRepeatUnchangedRead": true
  }
}
```

时间线错误会包含 segment id、声明 span、实际源音频时长、差值和阈值。例如 `MANIFEST_SEGMENT_DURATION` 直接告诉 Agent 修改 `segments[4].start/end` 或对应源音频，而不是让它重新猜 `video` 路径。

compact tool result 会保留 `diagnostic` 和 `manifestNormalization`，因此小模型无需 `detail=full` 或读取插件源码。Gate 的 recovery 也明确要求按该字段修复，并禁止用反复读同一清单代替状态变化。

## segmentTiming 兼容

规范形式仍是：

```json
{
  "segments": [
    {"id":"s1","text":"...","audio":"work/s1.wav","start":0.0,"end":3.2}
  ]
}
```

但小模型常自然生成：

```json
{
  "segments": [{"id":"s1","text":"..."}],
  "segmentTiming": {
    "s1": {"audio":"work/s1.wav","start":0.0,"end":3.2}
  }
}
```

0.9.4 在**只读验证视图**中把缺失的 `audio/start/end` 从同 id 的 `segmentTiming` 补入。源文件不会被插件改写；已有 inline 字段优先。所有音频解码、真实时长、重复音频、字幕、最终视频与哈希检查仍照常执行，因此兼容数据形状不等于放松质量 Gate。

## 无进展读取保护

每次非 Playbook 工具结果记录确定性的 arguments hash，并绑定当前 stage/epoch。若：

1. 最近一个 Gate 仍失败；
2. 当前是 read/grep/glob；
3. 同一 stage/epoch 已连续完成三次同工具、同参数调用；

第四次相同调用会返回 `NO_PROGRESS_REPEAT`，并附上最后 Gate 的具体失败。读取不同文件、修改清单、运行真正的修复/诊断都会打断该序列，不会被此规则阻止。

这是“相同输入、相同工具、无状态变化”的保护，不是限制模型只能读三次，也不是用户返修预算。

## Stage 提示

高工具调用量提示改为按阶段表达：pilot 才提示“完成一个自然段样片”；QA 等阶段提示使用结构化 Gate 诊断并做最小状态变化，不再给所有阶段复制视频样片建议。

## 边界

- 错误提示能降低推理负担，但不能保证任何 27B 都一定修对内容。
- `segmentTiming` 兼容只解决已观察到的数据形状，不自动容忍任意未知字段。
- 无进展保护只覆盖 Playbook Run 内失败 Gate 后的连续相同 read/grep/glob，不是 Harness 全局死循环检测器。
- 验证器版本协议仍为 0.4.0；实际实现变化由 worker SHA256 和运行插件版本区分，避免破坏旧 Run 的版本检查。
- 自动化测试使用合成媒体；没有在用户 E5 上重新跑 27B/128B，因此不声称模型能力实测已经提升。
