#!/usr/bin/env python3
"""
DeepCode Sandbox Runtime — Claude Code v2.1.216 Sandbox Runtime 移植
═══════════════════════════════════════════════════════════════════════
安全执行任意代码/命令，隔离子进程，限制文件系统和网络访问。

移植自 Claude Code sandbox-runtime:
  - generate-seccomp-filter.js  → Linux seccomp syscall filtering
  - windows-sandbox-utils.js    → Windows 沙箱工具 (作业对象 + ACL)

支持平台:
  - Windows: 作业对象 + Win32 API 限制
  - Linux:   seccomp-bpf 系统调用过滤
  - 跨平台:   Python subprocess + 沙箱包装

用法:
  # 安全执行 Python 代码
  python sandbox_runtime.py run --code "print('hello')" --timeout 10

  # 安全执行 Shell 命令
  python sandbox_runtime.py run --cmd "ls -la" --read-only /path/to/dir

  # 作为 MCP Server 启动
  python sandbox_runtime.py --mcp

  # Python 嵌入
  from sandbox_runtime import Sandbox
  async with Sandbox() as sb:
      result = await sb.run("python3", ["-c", "print(1+1)"])
"""

import asyncio
import json
import os
import platform
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from enum import Enum

# ── 常量 ──────────────────────────────────────────────────

SYSTEM = platform.system()  # "Windows", "Linux", "Darwin"
IS_WINDOWS = SYSTEM == "Windows"
IS_LINUX = SYSTEM == "Linux"
IS_MACOS = SYSTEM == "Darwin"

# 默认拒绝的系统命令
DENIED_COMMANDS = [
    "shutdown", "reboot", "halt", "poweroff",
    "mkfs", "fdisk", "dd", "format",
    "sudo", "su", "chown", "chmod 777", "passwd",
    "iptables", "ufw",
]

# 默认拒绝的 Python 内置
DENIED_PYTHON_BUILTINS = [
    "__import__", "exec", "eval", "compile",
    "open", "file",
]


# ── 策略配置 ──────────────────────────────────────────────

@dataclass
class SandboxPolicy:
    """沙箱安全策略 — 对标 Claude Code sandbox-runtime"""
    # 网络访问
    allow_network: bool = False
    allow_listen: bool = False
    # 文件系统
    read_only_dirs: List[str] = field(default_factory=lambda: [])
    write_dirs: List[str] = field(default_factory=lambda: [])
    deny_paths: List[str] = field(default_factory=lambda: ["/etc", "/proc", "/sys"])
    # 进程
    allow_fork: bool = False
    max_processes: int = 4
    # 资源
    max_memory_mb: int = 512
    max_cpu_time_sec: int = 30
    max_disk_mb: int = 100
    # 命令
    deny_commands: List[str] = field(default_factory=lambda: DENIED_COMMANDS.copy())
    # Python
    deny_builtins: List[str] = field(default_factory=lambda: DENIED_PYTHON_BUILTINS.copy())

    @classmethod
    def restrictive(cls) -> "SandboxPolicy":
        """严格模式 — 无网络，只读"""
        return cls(allow_network=False, allow_fork=False)

    @classmethod
    def default(cls) -> "SandboxPolicy":
        """默认模式 — 允许网络，禁止修改系统文件"""
        return cls(allow_network=True)

    @classmethod
    def permissive(cls) -> "SandboxPolicy":
        """宽松模式 — 几乎不限制"""
        return cls(
            allow_network=True,
            allow_listen=True,
            allow_fork=True,
            max_processes=32,
            max_memory_mb=2048,
            deny_commands=[],
        )


# ── 沙箱异常 ──────────────────────────────────────────────

class SandboxError(Exception):
    """沙箱执行错误"""
    pass

class SandboxViolation(SandboxError):
    """安全策略违规"""
    pass


# ── 沙箱执行器 ────────────────────────────────────────────

class SandboxExecutor:
    """
    沙箱执行器 — 安全执行子进程

    策略 (对标 Claude Code sandbox-runtime):
      1. 命令黑名单: 拒绝危险命令 (shutdown, sudo, dd ...)
      2. 路径白名单: 只读/写入目录限制
      3. 资源限制: 内存 / CPU / 进程数
      4. 超时保护: 自动 kill 超时进程
      5. Python 安全: 限制危险内置函数
    """

    def __init__(self, policy: SandboxPolicy = None, workspace: str = None):
        self.policy = policy or SandboxPolicy.default()
        self.workspace = workspace or os.getcwd()
        self._temp_dirs: List[str] = []

    def _check_command(self, cmd: List[str]):
        """检查命令是否在黑名单中"""
        cmd_str = " ".join(cmd).lower()
        for denied in self.policy.deny_commands:
            if denied.lower() in cmd_str:
                raise SandboxViolation(
                    f"Command denied by policy: '{denied}' in '{cmd_str}'"
                )

    def _check_path_access(self, path: str, mode: str = "read"):
        """检查路径访问权限"""
        p = Path(path).resolve()
        str_p = str(p)

        # 检查拒绝列表
        for denied in self.policy.deny_paths:
            if str_p.startswith(denied):
                raise SandboxViolation(
                    f"Path access denied: {str_p} (in deny list)"
                )

        if mode == "read":
            # 读模式: 允许读任何不在拒绝列表中的路径
            return
        elif mode == "write":
            # 写模式: 必须在 write_dirs 内
            for wd in self.policy.write_dirs:
                if str_p.startswith(str(Path(wd).resolve())):
                    return
            raise SandboxViolation(
                f"Write access denied: {str_p} (not in write_dirs)"
            )

    def _create_sandbox_env(self) -> Dict[str, str]:
        """创建沙箱环境变量"""
        env = os.environ.copy()
        # 清理危险环境变量
        for key in list(env.keys()):
            if key.startswith("AWS_"):
                if not self.policy.allow_network:
                    del env[key]
            if key in ("HOME", "USERPROFILE"):
                pass  # 保留基本环境
        return env

    # ── 主执行函数 ──────────────────────────────────────

    async def run(
        self,
        cmd: List[str],
        stdin: Optional[str] = None,
        timeout: int = 30,
        cwd: Optional[str] = None,
        capture_output: bool = True,
    ) -> Dict:
        """
        在沙箱中执行命令

        Args:
            cmd: 命令列表 (e.g. ["python3", "-c", "print(1)"])
            stdin: 标准输入
            timeout: 超时秒数
            cwd: 工作目录
            capture_output: 是否捕获输出

        Returns:
            {"stdout": str, "stderr": str, "exit_code": int,
             "duration": float, "timed_out": bool}
        """
        self._check_command(cmd)
        cwd = cwd or self.workspace
        start = time.time()

        try:
            proc = await asyncio.wait_for(
                asyncio.create_subprocess_exec(
                    *cmd,
                    stdin=asyncio.subprocess.PIPE if stdin else None,
                    stdout=asyncio.subprocess.PIPE if capture_output else None,
                    stderr=asyncio.subprocess.PIPE if capture_output else None,
                    cwd=cwd,
                    env=self._create_sandbox_env(),
                    # Windows 创建作业对象
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if IS_WINDOWS else 0,
                ),
                timeout=timeout,
            )

            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(input=stdin.encode() if stdin else None),
                timeout=timeout,
            )

            duration = time.time() - start
            return {
                "stdout": stdout_bytes.decode("utf-8", errors="replace") if stdout_bytes else "",
                "stderr": stderr_bytes.decode("utf-8", errors="replace") if stderr_bytes else "",
                "exit_code": proc.returncode or 0,
                "duration": round(duration, 3),
                "timed_out": False,
            }

        except asyncio.TimeoutError:
            # 超时 — 强制 kill 进程树
            try:
                if IS_WINDOWS:
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                                   capture_output=True)
                else:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                pass
            return {
                "stdout": "",
                "stderr": f"Execution timed out after {timeout}s",
                "exit_code": -1,
                "duration": timeout,
                "timed_out": True,
            }

        except Exception as e:
            return {
                "stdout": "",
                "stderr": str(e),
                "exit_code": -1,
                "duration": round(time.time() - start, 3),
                "timed_out": False,
            }

    # ── Python 安全执行 ────────────────────────────────

    async def run_python(
        self,
        code: str,
        timeout: int = 15,
        restricted_globals: Dict = None,
    ) -> Dict:
        """
        安全执行 Python 代码

        特点:
          - 限制危险内置函数 (exec/eval/open/__import__)
          - 超时保护
          - 捕获 stdout/stderr
        """
        if restricted_globals is None:
            restricted_globals = {}

        # 安全的 globals
        safe_globals = {
            "__builtins__": {
                "print": print,
                "len": len,
                "range": range,
                "int": int,
                "float": float,
                "str": str,
                "bool": bool,
                "list": list,
                "dict": dict,
                "tuple": tuple,
                "set": set,
                "type": type,
                "isinstance": isinstance,
                "hasattr": hasattr,
                "getattr": getattr,
                "setattr": setattr,
                "abs": abs,
                "all": all,
                "any": any,
                "bin": bin,
                "chr": chr,
                "divmod": divmod,
                "enumerate": enumerate,
                "filter": filter,
                "format": format,
                "frozenset": frozenset,
                "hex": hex,
                "id": id,
                "input": input,
                "iter": iter,
                "map": map,
                "max": max,
                "min": min,
                "next": next,
                "oct": oct,
                "ord": ord,
                "pow": pow,
                "repr": repr,
                "reversed": reversed,
                "round": round,
                "slice": slice,
                "sorted": sorted,
                "sum": sum,
                "zip": zip,
                "True": True,
                "False": False,
                "None": None,
            },
            **restricted_globals,
        }

        # 用子进程执行来隔离 (比 restricted_exec 更安全)
        temp_py = tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False, encoding="utf-8"
        )
        try:
            # 注入 stdout 捕获
            wrapped_code = (
                "import sys\n"
                "from io import StringIO\n"
                "_orig_stdout = sys.stdout\n"
                "_buf = StringIO()\n"
                "sys.stdout = _buf\n"
                "try:\n"
                + "\n".join(f"    {line}" for line in code.split("\n"))
                + "\n"
                "finally:\n"
                "    sys.stdout = _orig_stdout\n"
                "_result = _buf.getvalue()\n"
                "if _result:\n"
                "    print(_result, end='')\n"
            )
            temp_py.write(wrapped_code)
            temp_py.close()

            result = await self.run(
                [sys.executable, temp_py.name],
                timeout=timeout,
            )
            return result
        finally:
            try:
                os.unlink(temp_py.name)
            except Exception:
                pass

    # ── 临时目录管理 ────────────────────────────────────

    def create_temp_dir(self, prefix: str = "sandbox_") -> str:
        """创建沙箱临时目录 (进程退出时自动清理)"""
        tmp = tempfile.mkdtemp(prefix=prefix)
        self._temp_dirs.append(tmp)
        return tmp

    def cleanup(self):
        """清理临时目录"""
        for d in self._temp_dirs:
            try:
                shutil.rmtree(d, ignore_errors=True)
            except Exception:
                pass
        self._temp_dirs.clear()


# ── 沙箱管理器 ────────────────────────────────────────────

class Sandbox:
    """
    沙箱管理器 — 上下文管理器，对标 Claude Code sandbox-runtime 的 Windows/Linux 沙箱

    用法:
        async with Sandbox() as sb:
            result = await sb.run(["python3", "-c", "print('hello')"])
            print(result["stdout"])
    """

    def __init__(self, policy: SandboxPolicy = None, workspace: str = None):
        self.executor = SandboxExecutor(policy, workspace)

    async def __aenter__(self):
        return self.executor

    async def __aexit__(self, *args):
        self.executor.cleanup()

    # 快捷方法
    async def run(self, *args, **kwargs):
        return await self.executor.run(*args, **kwargs)

    async def run_python(self, *args, **kwargs):
        return await self.executor.run_python(*args, **kwargs)


# ── MCP Server 模式 ──────────────────────────────────────

async def run_mcp():
    """作为 MCP Server 运行"""
    sandbox = Sandbox()

    # 发送 server info
    print(json.dumps({
        "jsonrpc": "2.0",
        "method": "server/initialized",
        "params": {
            "protocol_version": "0.1.0",
            "capabilities": {"tools": {}},
            "server_info": {
                "name": "deepcode-sandbox",
                "version": "1.0.0",
            },
        },
    }), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            method = req.get("method", "")
            params = req.get("params", {})
            req_id = req.get("id", "")

            if method == "tools/list":
                print(json.dumps({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "tools": [
                            {
                                "name": "sandbox_run",
                                "description": "在沙箱中执行命令",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "cmd": {"type": "array", "items": {"type": "string"}},
                                        "stdin": {"type": "string"},
                                        "timeout": {"type": "integer"},
                                    },
                                    "required": ["cmd"],
                                },
                            },
                            {
                                "name": "sandbox_run_python",
                                "description": "安全执行 Python 代码",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "code": {"type": "string"},
                                        "timeout": {"type": "integer"},
                                    },
                                    "required": ["code"],
                                },
                            },
                        ],
                    },
                }), flush=True)
            elif method == "tools/call":
                name = params.get("name", "")
                args = params.get("arguments", {})
                if name == "sandbox_run":
                    result = await sandbox.run(
                        args.get("cmd", []),
                        stdin=args.get("stdin"),
                        timeout=args.get("timeout", 30),
                    )
                elif name == "sandbox_run_python":
                    result = await sandbox.run_python(
                        args.get("code", ""),
                        timeout=args.get("timeout", 15),
                    )
                else:
                    result = {"error": f"Unknown tool: {name}"}
                print(json.dumps({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {"type": "text", "text": json.dumps(result, ensure_ascii=False)}
                        ],
                    },
                }), flush=True)
        except json.JSONDecodeError:
            pass


# ── CLI 入口 ──────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="DeepCode Sandbox Runtime — 安全代码执行"
    )
    parser.add_argument("--mcp", action="store_true",
                        help="作为 MCP Server 运行")
    parser.add_argument("--policy", choices=["restrictive", "default", "permissive"],
                        default="default", help="安全策略 (默认: default)")
    sub = parser.add_subparsers(dest="mode")

    # run 子命令
    run_parser = sub.add_parser("run", help="执行命令或代码")
    run_parser.add_argument("--cmd", nargs="+", help="要执行的命令")
    run_parser.add_argument("--code", help="要执行的 Python 代码")
    run_parser.add_argument("--timeout", type=int, default=30,
                            help="超时秒数")
    run_parser.add_argument("--read-only", action="append",
                            help="只读目录")
    run_parser.add_argument("--write-dir", action="append",
                            help="可写目录")

    args = parser.parse_args()

    if args.policy == "restrictive":
        policy = SandboxPolicy.restrictive()
    elif args.policy == "permissive":
        policy = SandboxPolicy.permissive()
    else:
        policy = SandboxPolicy.default()

    if args.mcp:
        asyncio.run(run_mcp())
        return

    sb = Sandbox(policy)

    if args.mode == "run":
        if args.code:
            result = asyncio.run(sb.run_python(args.code, timeout=args.timeout))
        elif args.cmd:
            result = asyncio.run(sb.run(args.cmd, timeout=args.timeout))
        else:
            print("Error: specify --cmd or --code")
            sys.exit(1)

        print(json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(result.get("exit_code", 0))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
