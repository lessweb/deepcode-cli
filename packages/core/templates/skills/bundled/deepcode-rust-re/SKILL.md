---
name: deepcode-rust-re
description: >
  DeepCode Rust RE — Rust 二进制逆向分析引擎。
  自动扫描 Rust 二进制、提取功能特征、生成 Ghidra 脚本、
  用 LLM 重建 Rust 风格伪代码。支持 codex.exe 等 Rust 编译的 AI 编码助手。
version: 1.0.0
author: DeepCode
date: 2026-07-26
tags: [rust, reverse-engineering, ghidra, decompilation]
---

# DeepCode Rust RE

Rust 二进制逆向分析引擎 — 专为 Release 模式 + strip 的 Rust 二进制设计。

## 工作流

```
二进制 (codex.exe)
    │
    ├── 1. scan ───→ 特征检测 + crate 识别 + 功能扫描
    │
    ├── 2. ghidra-script ───→ 生成 Ghidra Python 脚本
    │                          提取附近函数反编译结果
    │
    └── 3. analyze/rebuild ───→ LLM 重建 Rust 风格伪代码
                                架构文档生成
```

## 用法

### 扫描二进制

```bash
# 快速扫描
python rust_re_analyzer.py scan codex.exe

# 指定功能
python rust_re_analyzer.py scan codex.exe --features mcp,tools,hooks

# 保存结果
python rust_re_analyzer.py scan codex.exe --output codex_scan.json
```

### 完整分析 (扫描 + LLM 架构分析)

```bash
# 需要设置 DEEPSEEK_API_KEY
python rust_re_analyzer.py analyze codex.exe --output report.json
```

### 生成 Ghidra 脚本

```bash
python rust_re_analyzer.py ghidra-script --output rust_re_ghidra.py
```

然后在 Ghidra 中: `Window → Script Manager → Run Script`

### LLM 重建 Rust 代码

```bash
python rust_re_analyzer.py rebuild codex_scan.json
```

## 识别能力

| 特征 | 可检测 |
|:----|:------|
| Rust 二进制 | ✅ 通过 panic/RT 签名 |
| Crate 依赖 | ✅ tokio/reqwest/hyper/serde/axum/tracing |
| MCP 系统 | ✅ McpServer/McpTool/McpConfig |
| Hook 系统 | ✅ PreToolUse/PostToolUse/PermissionRequest |
| Agent 系统 | ✅ SubAgent/AgentMessage/AgentLoop |
| 构建信息 | ✅ Cargo 路径 + 版本号 |
| 功能定位 | ✅ 字符串 → 附近函数提取 |
