---
name: image-generator
description: Generate or edit images from text and local files, image URLs, or data URLs through image API. Use when the user asks to create an image, generate from one or more reference images, combine styles or elements across references, or edit a marked region while blending the result into the original scene.
---

# Image Generator

通过 `scripts/image_generator.py` 试算积分并生成无水印 PNG。支持纯文本生图、多参考图融合，以及依据图片中标记区域进行局部编辑。

## Language / 语言

Always respond in the user's language, not the language of this document.

- If the user's latest message or the ongoing conversation is in English (for example `Generate a picture of a baby panda`), use English for ALL user-facing text: assistant explanations, `AskUserQuestion` questions, option labels and descriptions, confirmation prompts, and final result reports.
- If the user writes in Chinese, use Chinese for all of the above.
- When presenting ratio or resolution options, translate the direction labels into the user's language (for example `1:1 Square`, `3:4 Portrait`, `4:3 Landscape` in English; `1:1 正方形`, `3:4 竖屏`, `4:3 横屏` in Chinese). Do not mix both languages in a single option label.

## 执行流程

严格按以下顺序执行。不得在用户明确确认积分消耗前调用图片生成接口。

### 1. 收集真实需求

- 将用户真正想得到的画面整理成完整提示词，保留主体、动作、环境、构图、风格、光线、色彩、文字和限制条件。
- 收集用户提到的全部本地图片路径、HTTP(S) 图片 URL 或 data URL。最多使用 10 张图片，不要把普通网页 URL 当作图片 URL。
- 对多参考图，在提示词中说明每张图承担的角色，例如“参考图 1 的构图、参考图 2 的人物服装、参考图 3 的配色”，避免只写“融合这些图片”。
- 对标记区域编辑，将含标记的图片作为参考图，并在提示词中清楚说明标记的外观、要替换或补充的内容、必须保留的未标记区域，以及最终结果中移除标记并自然融合边缘、透视、光照和纹理。
- 如果需求本身仍有会显著改变结果的歧义，先用 `AskUserQuestion` 补齐，不要擅自添加关键视觉设定。

### 2. 确认比例和分辨率

如果用户已经明确指定支持的比例或分辨率，直接采用，不要重复询问。如果任一项缺失，必须使用 `AskUserQuestion` 让用户选择；两项都缺失时，在同一次工具调用中提出两个问题。

比例选项的标签必须带方向符号，不能只显示数字。支持的比例为：

- `□ 1:1（正方形）`
- `▯ 3:4（竖屏）`
- `▭ 4:3（横屏）`
- `▭ 16:9（横屏）`
- `▯ 9:16（竖屏）`
- `▯ 2:3（竖屏）`
- `▭ 3:2（横屏）`
- `▭ 21:9（超宽横屏）`

如果 `AskUserQuestion` 限制选项数量，优先展示最符合需求的若干比例，并在问题中列出其余受支持比例供用户通过“其他”填写。分辨率选项为 `1k`、`1.5k`、`2k`、`4k`；不要替用户默认选择。

### 3. 试算积分

从 Skill 目录运行脚本。每张参考图分别传一个 `--image`：

```bash
python3 scripts/image_generator.py cost \
  --prompt "<最终提示词>" \
  --ratio "<比例>" \
  --resolution "<分辨率>" \
  --image "<参考图 1>" \
  --image "<参考图 2>"
```

没有参考图时省略全部 `--image`。脚本会把本地图片编码为 data URL，并直接传递 HTTP(S) URL 或已有 data URL。保存本次调用使用的最终提示词、图片顺序、比例和分辨率，生成时必须原样复用。

### 4. 请求生成确认

成功取得 `credits` 后，必须使用 `AskUserQuestion` 明确询问是否生成。问题中同时写明：

- 本次将消耗的准确积分数；
- 图片生成可能需要 30 秒到数分钟；
- 确认选项和取消选项。

只有用户选择确认后才能继续。用户取消、工具未返回明确确认或试算失败时，停止流程，不得调用 `generate`。

### 5. 生成并保存

确认后，用与试算完全相同的请求参数调用 `generate`，并将已确认的积分传给 `--confirmed-credits`：

```bash
python3 scripts/image_generator.py generate \
  --prompt "<与试算相同的最终提示词>" \
  --ratio "<与试算相同的比例>" \
  --resolution "<与试算相同的分辨率>" \
  --image "<与试算相同的参考图 1>" \
  --confirmed-credits "<用户确认的积分>" \
  --output "<目标 PNG 路径>"
```

脚本会在提交生成前再次试算。如果积分已变化，它会拒绝生成；此时返回步骤 4，让用户按新积分重新确认。生成成功后，向用户报告本地文件路径和临时图片 URL。若未传 `--output`，只报告临时 URL，并提醒用户及时下载。

## 凭据配置

积分试算允许匿名调用，不需要配置 Key。生成图片时，脚本从 `~/.deepcode-plus/settings.json` 读取 `env.PLUS_API_KEY`：

```json
{
  "env": {
    "PLUS_API_KEY": "sk-..."
  }
}
```

让用户从 [Deep Code Plus 平台](https://deepcode.vegamo.cn/plus/api-keys) 获取 Key 并在本地写入该文件。不要要求用户在聊天中发送 Key，也不要在输出中显示 Key。

## 错误处理

- 生成时配置缺失，给出上述配置路径和字段，不要尝试生成；积分试算不受影响。
- 本地参考图不存在、不是图片、超过 10 张或接口试算失败时，修正问题后重新试算。
- 接口返回 `success=false` 时，原样转述安全的 `reason`，不要声称已经生成。
- 不要通过直接请求接口、修改脚本或伪造 `--confirmed-credits` 绕过试算与用户确认。
