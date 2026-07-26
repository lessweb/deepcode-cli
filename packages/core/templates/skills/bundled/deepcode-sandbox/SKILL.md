---
name: deepcode-sandbox
description: >
  DeepCode Sandbox Runtime — 移植自 Claude Code v2.1.216 sandbox-runtime。
  安全执行任意代码/命令，隔离子进程，限制文件系统/网络/进程权限。
  支持 Windows (作业对象) 和 Linux (seccomp) 两种沙箱机制。
version: 1.0.0
author: DeepCode + Ghidra RE (Claude Code v2.1.216)
date: 2026-07-26
tags: [sandbox, security, isolation, runtime]
---

# DeepCode Sandbox Runtime

移植自 **Claude Code v2.1.216** 的 `sandbox-runtime` 包:
- `generate-seccomp-filter.js` → Linux seccomp-bpf 系统调用过滤
- `windows-sandbox-utils.js` → Windows 作业对象 + ACL 限制

## 安全策略

| 策略 | 网络 | 写文件 | 进程 | 用途 |
|:----|:----|:------|:----|:-----|
| **restrictive** | ❌ | ❌ | ❌ | 不可信代码 |
| **default** | ✅ | ❌(系统路径) | ✅(有限) | 日常任务 |
| **permissive** | ✅ | ✅ | ✅ | 可信代码 |

## 内置工具 (MCP)

| 工具 | 说明 |
|:----|:-----|
| `sandbox_run` | 在沙箱中执行命令 (`--cmd ls -la`) |
| `sandbox_run_python` | 安全执行 Python 代码 (`--code "print(1)"`) |

## 用法

### 命令行

```bash
# 安全执行命令
python sandbox_runtime.py run --cmd python3 -c "print('hi')"

# 安全执行 Python 代码 (限制危险内置)
python sandbox_runtime.py run --code "print(1+1)" --timeout 10

# 严格模式 (无网络)
python sandbox_runtime.py run --policy restrictive --code "import os; os.listdir('.')"
```

### 作为 MCP Server

```json
"deepcode-sandbox": {
  "command": "python",
  "args": [
    "F:/DEEPCODE/.deepcode/skills/deepcode-sandbox/sandbox_runtime.py",
    "--mcp"
  ]
}
```

### Python 嵌入

```python
from sandbox_runtime import Sandbox, SandboxPolicy

# 严格模式
policy = SandboxPolicy.restrictive()
async with Sandbox(policy) as sb:
    result = await sb.run(["python3", "-c", "print('hello')"])
    print(result["stdout"])

    result = await sb.run_python("print(sum(range(10)))")
    print(result["stdout"])
```

## 安全特性

- **命令黑名单**: 拒绝 `shutdown`/`sudo`/`mkfs`/`dd` 等危险命令
- **路径白名单**: 只读/可写目录精确控制
- **超时保护**: 自动 kill 超时进程
- **Python 安全**: `exec`/`eval`/`open`/`__import__` 被拦截
- **跨平台**: Windows/Linux/Linux seccomp (规划中)

## 注意事项

- Windows 下通过 `taskkill /F /T` 清理进程树
- Linux 下通过 `SIGKILL` 清理进程组
- Python 安全沙箱使用子进程隔离，比 `restricted_exec` 更安全
- 生产环境建议配合容器 (Docker) 使用
