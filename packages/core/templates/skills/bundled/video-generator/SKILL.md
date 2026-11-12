---
name: video-generator
description: 使用AI大模型根据文字、首尾帧图片或图片/视频/音频参考素材生成带对白和环境音的视频。适用于文生视频、图生视频、首尾帧过渡和多模态参考视频生成，通过 Deep Code Plus 试算积分、确认后上传素材并生成视频。
---

# Video Generator

由 MiniMax H3 驱动，同步生成画面、对白与环境音。使用本技能目录中的 `scripts/video_generator.py`；需要 Python 3.10+，依赖安装命令为 `python3 -m pip install -r scripts/requirements.txt`。

所有用户可见说明、问题和选项使用用户的语言。

## 收集需求

- 整理用户的真实需求时，读取 [视频提示词编写指南](references/video-prompt-writing-guide.md) 并按指南扩写提示词，组织为 `integrated_multimodal_description`、`overall_soundscape`、`non_diegetic_music` 三个核心字段。沿时间线描述主体、动作、镜头、风格、对白与声音，保留用户原始对白、画面文字、语言及限制条件，不要擅自添加会改变意图的设定。
- 根据输入类型采用指南中的纯文本、首帧或首尾帧写法，首尾帧需添加对齐说明并描述连续变化路径；参考素材不能自动视为首尾帧。指南中的仅尾帧（L2VA）写法不适用于本脚本。
- 收集用户提到的本地文件路径或 HTTP(S) 素材直链，并确定每份素材的用途。网页链接不等于素材直链；含义不清时询问。
- 支持纯文本、首尾帧、参考素材三种输入。首帧可附加尾帧；不接受只有尾帧。首尾帧仅支持 JPG/JPEG、PNG、WEBP，每张不超过 10MB，宽和高均至少 300 像素。
- 参考素材最多为 **4 张图片 + 1 个视频 + 2 个音频**，每个文件不超过上传接口的 50 MiB 限制。首尾帧与任何参考素材互斥；冲突时让用户选择用途，不能静默丢弃素材。
- 平台积分有换算，**最终费用只能引用试算接口的 `credits`**。

## 确认比例、分辨率、时长和模式

用户已明确指定支持的比例、分辨率、时长或模式（tier）时直接采用。任何缺失项都必须用 `AskUserQuestion` 让用户选择并确认，合并询问缺失项，不得默默采用默认值。四项参数全部明确后才能试算。

比例选项必须同时包含方向符号和文字：`▭ 21:9（超宽横屏）`、`▭ 16:9（横屏）`、`▭ 4:3（横屏）`、`□ 1:1（正方形）`、`▯ 3:4（竖屏）`、`▯ 9:16（竖屏）`。还支持 `auto（自动比例，方向由模型决定）`，仅在用户明确选择自动时使用。若工具限制选项数量，展示最相关的几个，在题目中列出其余比例及方向供用户填写。分辨率选项为 `720p`、`1080p`。

时长支持 5–20 整数秒。模式选项为 `turbo`（10步推理，缩短渲染时间）或 `base`（20步推理，提升画质）。确认时长后，按实际时长完善提示词时间线，确保切镜时间在视频时长内，尾帧对齐时间与时长一致。

如果宿主agent没有名为 `AskUserQuestion` 的工具，使用宿主agent等价的交互提问工具；没有等价工具时直接提问并等待明确回复。缺失的选择和生成授权不能通过默认选项或等待超时代替。

## 试算与提交确认

在技能目录运行（将占位符替换为真实参数，使用正确的 shell 引号）：

```bash
python3 scripts/video_generator.py cost \
  --prompt '<最终视频提示词>' --ratio '16:9' --resolution 720p \
  --duration 5 --tier turbo
```

素材参数同样传给 `cost` 和 `generate`：

- 首尾帧：`--first-frame '<路径或URL>'`，可附加 `--last-frame '<路径或URL>'`。
- 参考素材：重复 `--image '<路径或URL>'`（最多 4 次），`--video '<路径或URL>'`（最多 1 次），重复 `--audio '<路径或URL>'`（最多 2 次）。

`cost` 校验本地素材的大小和扩展名、线上 URL 格式并调用 `GET /plugin/calc-video-gen-cost`，只输出 `credits` 和 `minMinutes` 等公开信息，不上传或提交任务。保存本次提示词、素材顺序和所有参数。

取得试算结果后，**必须用 `AskUserQuestion` 询问是否提交并生成视频**。问题中展示最终需求、素材用途、比例、分辨率、时长、模式、准确积分及“至少需要 `minMinutes` 分钟，实际可能更久”，提供“确认生成”和“取消”选项。只有用户明确确认才执行：

```bash
python3 scripts/video_generator.py generate \
  --prompt '<与试算相同的提示词>' --ratio '16:9' --resolution 720p \
  --duration 5 --tier turbo \
  --confirmed-credits '<用户确认的credits>' \
  --output "<目标 MP4 路径>"
```

原样复用试算参数及素材。**不要直接调用上游API接口，也不要绕过脚本的确认参数。** 核价变化时不会上传或提交，应重新试算并再次让用户确认。需求或素材发生变化也需重新试算、确认。

## 结果与恢复

- `generate` 和 `status` 必须传入 `--output` 指定本地 MP4 路径，任务完成后自动下载。保存成功后向用户给出本地文件路径；不要向用户报告临时 URL，因为临时 URL 很快会过期。下载失败时，通过原任务 ID 使用 `status` 重试保存。
- 脚本的标准输出为 JSON：创建成功时立即输出 `task_created` 事件和 `taskId`，完成时输出包含 `videoUrl` 的结果；进度写入标准错误。
- 已取得任务 ID 时，遇到接口限流、脚本超时或中断不会取消远端任务，用 `python3 scripts/video_generator.py status --task-id '<taskId>' --output '<目标 MP4 路径>' --wait` 恢复轮询并保存；省略 `--wait` 则只查询一次，若已完成则下载保存。不得重新调用 `generate` 来恢复任务。
- 提交超时或响应异常时不自动重试 POST，因为服务端可能已经受理，避免重复生成。
- 首次查询到完成时扣费。若余额不足导致链接被扣留，提示充值后查询原任务，不重新创建。失败或取消如实报告；只有视频成功保存到本地后才能报告交付完成。

## PLUS-API-KEY 配置

试算允许匿名调用。提交和查询从 `~/.deepcode-plus/settings.json` 读取：

```json
{
  "env": {
    "PLUS_API_KEY": "sk-..."
  }
}
```

用户可从 [Deep Code Plus 平台](https://deepcode.vegamo.cn/plus/api-keys) 获取 Key 并在本地配置。不要让用户在聊天中发送 Key，也不要打印 Key 或七牛上传凭证。配置缺失时给出上述配置方法。
