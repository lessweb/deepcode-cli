# Deep Code Agentic 能力快照

此目录保存了 Agentic 两大能力的备份。

## 能力

1. **Plan→Execute→Verify 循环** — 系统提示增强，LLM 自动先规划、每步验证、失败必修
2. **自动错误修复循环** — 命令失败自动分析错误、注入修复提醒、重试最多 3 轮

## 备份文件 (本地)

- `cli.js` — CLI 构建产物
- `prompt.js` — 带 Agentic 行为提示的 prompt 模块
- `session.js` — 带错误修复循环的 session 模块
- `bash-handler.js` — 带错误分析的 bash 处理器
- `restore-agentic.bat` — 一键恢复脚本

## 如何恢复

### 方式 1: 运行恢复脚本
```
双击 .agentic-snapshot\restore-agentic.bat
```

### 方式 2: 从 Git 还原
```bash
git checkout 4668f5b -- packages/core/src/prompt.ts packages/core/src/session.ts packages/core/src/tools/bash-handler.ts
cd packages/cli && npm link && cd .. && npm run build
```

### 方式 3: 手动 npm link
```bash
cd deepcode-cli-source/packages/cli
npm link
```

## Git 提交

```
4668f5b feat(core): 实现两大 Agentic 核心能力
```
