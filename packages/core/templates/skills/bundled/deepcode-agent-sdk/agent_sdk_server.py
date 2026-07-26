#!/usr/bin/env python3
"""
DeepCode Agent SDK Server — Claude Code v2.1.216 Agent SDK 移植
═══════════════════════════════════════════════════════════════
让 DeepCode 作为 Agent 被外部程序调用，支持三种模式：
  1. HTTP API  — RESTful API，外部直接发送 HTTP 请求
  2. MCP stdio — 通过标准输入输出作为 MCP Server 运行
  3. Embedded  — 作为 Python 模块嵌入到其他程序

从 Claude Code agentSdk.ts 移植的核心概念:
  - Agent 作为可调用的服务端
  - 工具注册与执行
  - 任务队列与结果回调
  - 认证与权限控制

用法:
  # HTTP Server 模式 (默认端口 8088)
  python agent_sdk_server.py --http --port 8088

  # MCP stdio 模式 (用于 settings.json MCP Server 配置)
  python agent_sdk_server.py --mcp

  # 作为模块导入
  from agent_sdk_server import DeepCodeAgent
  agent = DeepCodeAgent()
  result = await agent.execute("读文件", {"path": "xxx"})
"""

import asyncio
import json
import os
import sys
import uuid
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Callable, Awaitable

try:
    import uvicorn
    from fastapi import FastAPI, HTTPException, Request
    from pydantic import BaseModel
    HAS_HTTP = True
except ImportError:
    HAS_HTTP = False

# ── 工具注册表 ──────────────────────────────────────────────

ToolHandler = Callable[..., Awaitable[Dict[str, Any]]]

class ToolRegistry:
    """Agent 可调用的工具注册表"""

    def __init__(self):
        self._tools: Dict[str, Dict] = {}

    def register(self, name_or_handler, handler: ToolHandler = None,
                 description: str = "",
                 parameters: Dict = None):
        """
        注册一个工具 — 支持装饰器模式和直接调用

        装饰器模式:
            @self.tools.register
            async def my_tool(): ...

        直接调用:
            self.tools.register("my_tool", handler_fn, "desc", {...})
        """
        if handler is None:
            # 装饰器模式: name_or_handler 是函数本身
            func = name_or_handler
            # 从函数的 __mcp_tool__ 属性获取元数据
            meta = getattr(func, "__mcp_tool__", {})
            name = meta.get("name", func.__name__)
            desc = meta.get("description", func.__doc__ or "")
            params = meta.get("parameters", {})
            self._tools[name] = {
                "handler": func,
                "description": desc,
                "parameters": params,
            }
            return func
        else:
            # 直接调用模式
            self._tools[name_or_handler] = {
                "handler": handler,
                "description": description,
                "parameters": parameters or {},
            }

    def get_tool(self, name: str) -> Optional[Dict]:
        return self._tools.get(name)

    def list_tools(self) -> List[Dict]:
        """返回 MCP 兼容的工具列表"""
        return [
            {
                "name": name,
                "description": info["description"],
                "inputSchema": {
                    "type": "object",
                    "properties": info["parameters"],
                    "required": [
                        k for k, v in info["parameters"].items()
                        if v.get("required", False)
                    ],
                },
            }
            for name, info in self._tools.items()
        ]

    def call(self, name: str, **kwargs) -> Awaitable[Dict]:
        tool = self.get_tool(name)
        if not tool:
            raise ValueError(f"Unknown tool: {name}")
        return tool["handler"](**kwargs)


# ── Agent SDK 核心 ──────────────────────────────────────────

class DeepCodeAgent:
    """
    DeepCode Agent — 移植自 Claude Code agentSdk.ts

    将 DeepCode 的能力封装为可远程调用的 Agent，支持：
    - 文件操作 (读/写/搜索)
    - 命令执行 (Bash)
    - 代码编辑 (Edit)
    - Web 搜索 (WebSearch)
    - 模型推理 (通过 DeepSeek API)
    - 工具链编排 (MCP 工具链调用)
    """

    def __init__(self, workspace: str = None, allowed_dirs: List[str] = None):
        self.agent_id = f"agent-{uuid.uuid4().hex[:8]}"
        self.workspace = workspace or os.getcwd()
        self.allowed_dirs = allowed_dirs or [self.workspace]
        self.tools = ToolRegistry()
        self._task_history: List[Dict] = []
        self._register_default_tools()

    # ── 工具注册 ──────────────────────────────────────────

    def register_tool(self, name: str, handler: ToolHandler,
                      description: str = "", parameters: Dict = None):
        """注册自定义工具"""
        self.tools.register(name, handler, description, parameters)

    def _register_default_tools(self):
        """注册内置工具 — 对标 Claude Code agentSdk.ts 能力"""

        @self.tools.register
        async def read_file(path: str):
            """读取文件内容"""
            resolved = self._resolve_path(path)
            if not resolved:
                return {"error": f"Access denied: {path}"}
            content = Path(resolved).read_text(encoding="utf-8", errors="replace")
            return {"path": str(resolved), "content": content, "size": len(content)}

        read_file.__mcp_tool__ = {
            "name": "read_file",
            "description": "读取指定文件的内容",
            "parameters": {
                "path": {"type": "string", "description": "文件路径", "required": True},
            },
        }

        @self.tools.register
        async def write_file(path: str, content: str):
            """写入文件"""
            resolved = self._resolve_path(path)
            if not resolved:
                return {"error": f"Access denied: {path}"}
            resolved.parent.mkdir(parents=True, exist_ok=True)
            Path(resolved).write_text(content, encoding="utf-8")
            return {"path": str(resolved), "size": len(content), "status": "written"}

        write_file.__mcp_tool__ = {
            "name": "write_file",
            "description": "写入内容到指定文件",
            "parameters": {
                "path": {"type": "string", "description": "文件路径", "required": True},
                "content": {"type": "string", "description": "文件内容", "required": True},
            },
        }

        @self.tools.register
        async def execute_command(command: str, timeout: int = 30):
            """执行 Shell 命令"""
            import subprocess
            try:
                result = subprocess.run(
                    command, shell=True, capture_output=True, text=True,
                    timeout=timeout, cwd=self.workspace
                )
                return {
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "exit_code": result.returncode,
                }
            except subprocess.TimeoutExpired:
                return {"error": f"Command timed out after {timeout}s"}
            except Exception as e:
                return {"error": str(e)}

        execute_command.__mcp_tool__ = {
            "name": "execute_command",
            "description": "执行 Shell 命令 (Bash)",
            "parameters": {
                "command": {"type": "string", "description": "要执行的命令", "required": True},
                "timeout": {"type": "integer", "description": "超时秒数"},
            },
        }

        @self.tools.register
        async def search_files(pattern: str, path: str = "."):
            """搜索文件"""
            import fnmatch
            base = self._resolve_path(path) or self.workspace
            matches = []
            for root, dirs, files in os.walk(base):
                for f in files:
                    if fnmatch.fnmatch(f, pattern):
                        matches.append(os.path.join(root, f))
            return {"matches": matches[:100], "total": len(matches)}

        search_files.__mcp_tool__ = {
            "name": "search_files",
            "description": "搜索匹配 pattern 的文件",
            "parameters": {
                "pattern": {"type": "string", "description": "通配符模式", "required": True},
                "path": {"type": "string", "description": "搜索起始目录"},
            },
        }

        @self.tools.register
        async def list_directory(path: str = "."):
            """列出目录内容"""
            resolved = self._resolve_path(path)
            if not resolved:
                return {"error": f"Access denied: {path}"}
            items = []
            for entry in sorted(Path(resolved).iterdir()):
                items.append({
                    "name": entry.name,
                    "type": "dir" if entry.is_dir() else "file",
                    "size": entry.stat().st_size if entry.is_file() else 0,
                })
            return {"path": str(resolved), "items": items}

        list_directory.__mcp_tool__ = {
            "name": "list_directory",
            "description": "列出目录内容",
            "parameters": {
                "path": {"type": "string", "description": "目录路径"},
            },
        }

        @self.tools.register
        async def agent_query(query: str, model: str = "auto"):
            """向 DeepSeek 模型发送查询"""
            try:
                from openai import OpenAI
                client = OpenAI(
                    api_key=os.environ.get("DEEPSEEK_API_KEY", ""),
                    base_url="https://api.deepseek.com",
                )
                actual_model = model if model != "auto" else "deepseek-chat"
                response = client.chat.completions.create(
                    model=actual_model,
                    messages=[{"role": "user", "content": query}],
                    max_tokens=4096,
                )
                return {"response": response.choices[0].message.content}
            except ImportError:
                return {"error": "openai not installed. pip install openai"}
            except Exception as e:
                return {"error": str(e)}

        agent_query.__mcp_tool__ = {
            "name": "agent_query",
            "description": "向 AI 模型发送查询",
            "parameters": {
                "query": {"type": "string", "description": "查询内容", "required": True},
                "model": {"type": "string", "description": "模型名称 (auto=自动)"},
            },
        }

        @self.tools.register
        async def agent_status():
            """获取 Agent 状态信息"""
            return {
                "agent_id": self.agent_id,
                "workspace": self.workspace,
                "allowed_dirs": self.allowed_dirs,
                "tools_count": len(self.tools._tools),
                "tools": list(self.tools._tools.keys()),
                "tasks_completed": len(self._task_history),
                "uptime": datetime.now().isoformat(),
            }

        agent_status.__mcp_tool__ = {
            "name": "agent_status",
            "description": "获取 Agent 运行状态",
            "parameters": {},
        }

    # ── 路径解析与安全 ────────────────────────────────────

    def _resolve_path(self, path: str) -> Optional[Path]:
        """解析并验证路径在允许范围内"""
        p = Path(path)
        if not p.is_absolute():
            p = Path(self.workspace) / p
        p = p.resolve()
        for allowed in self.allowed_dirs:
            try:
                p.relative_to(Path(allowed).resolve())
                return p
            except ValueError:
                continue
        return None

    # ── 任务执行 ──────────────────────────────────────────

    async def execute(self, tool_name: str, params: Dict = None) -> Dict:
        """执行一个工具调用"""
        params = params or {}
        start = datetime.now()
        try:
            result = await self.tools.call(tool_name, **params)
            status = "success"
        except Exception as e:
            result = {"error": str(e), "traceback": traceback.format_exc()}
            status = "error"

        duration = (datetime.now() - start).total_seconds()
        record = {
            "tool": tool_name,
            "params": params,
            "status": status,
            "duration": duration,
            "timestamp": start.isoformat(),
        }
        self._task_history.append(record)
        return {
            "result": result,
            "meta": {"status": status, "duration": duration, "tool": tool_name},
        }

    async def execute_batch(self, tasks: List[Dict]) -> List[Dict]:
        """批量执行多个工具调用"""
        results = []
        for task in tasks:
            r = await self.execute(task.get("tool"), task.get("params", {}))
            results.append(r)
        return results

    # ── MCP 协议适配 ─────────────────────────────────────

    async def handle_mcp_request(self, request: Dict) -> Dict:
        """
        处理 MCP 协议请求

        支持:
          - tools/list → 列出可用工具
          - tools/call → 调用工具
          - ping       → 健康检查
        """
        method = request.get("method", "")
        params = request.get("params", {})
        req_id = request.get("id", str(uuid.uuid4()))

        if method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"tools": self.tools.list_tools()},
            }
        elif method == "tools/call":
            name = params.get("name", "")
            args = params.get("arguments", {})
            result = await self.execute(name, args)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(result, ensure_ascii=False, indent=2),
                        }
                    ],
                },
            }
        elif method == "ping":
            return {"jsonrpc": "2.0", "id": req_id, "result": "pong"}
        else:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"},
            }


# ── MCP stdio 模式 ────────────────────────────────────────

async def run_mcp_stdio(agent: DeepCodeAgent):
    """通过标准输入输出运行 MCP 协议"""
    import sys
    # 发送初始 server info
    server_info = json.dumps({
        "jsonrpc": "2.0",
        "method": "server/initialized",
        "params": {
            "protocol_version": "0.1.0",
            "capabilities": {"tools": {}},
            "server_info": {
                "name": "deepcode-agent-sdk",
                "version": "1.0.0",
            },
        },
    })
    print(server_info, flush=True)

    # 持续读取 stdin JSON-RPC 请求
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            response = await agent.handle_mcp_request(request)
            print(json.dumps(response, ensure_ascii=False), flush=True)
        except json.JSONDecodeError:
            print(json.dumps({
                "jsonrpc": "2.0",
                "error": {"code": -32700, "message": "Parse error"},
            }), flush=True)


# ── HTTP Server 模式 ─────────────────────────────────────

def create_http_app(agent: DeepCodeAgent):
    """创建 FastAPI HTTP 应用"""
    if not HAS_HTTP:
        raise RuntimeError("FastAPI not installed. pip install fastapi uvicorn")

    app = FastAPI(
        title="DeepCode Agent SDK",
        version="1.0.0",
        description="DeepCode Agent — 外部程序可调用的 AI Agent",
    )

    @app.get("/health")
    async def health():
        return {"status": "ok", "agent_id": agent.agent_id}

    @app.get("/tools")
    async def list_tools():
        return {"tools": agent.tools.list_tools()}

    @app.post("/execute")
    async def execute_tool(request: Request):
        body = await request.json()
        tool = body.get("tool")
        params = body.get("params", {})
        if not tool:
            raise HTTPException(status_code=400, detail="Missing 'tool' field")
        result = await agent.execute(tool, params)
        return result

    @app.post("/batch")
    async def batch_execute(request: Request):
        body = await request.json()
        tasks = body.get("tasks", [])
        results = await agent.execute_batch(tasks)
        return {"results": results}

    @app.get("/history")
    async def get_history(limit: int = 10):
        history = agent._task_history[-limit:]
        return {"history": history}

    return app


# ── CLI 入口 ──────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="DeepCode Agent SDK Server"
    )
    parser.add_argument("--http", action="store_true",
                        help="以 HTTP Server 模式启动")
    parser.add_argument("--mcp", action="store_true",
                        help="以 MCP stdio 模式启动")
    parser.add_argument("--port", type=int, default=8088,
                        help="HTTP 端口 (默认 8088)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="HTTP 绑定地址 (默认 127.0.0.1)")
    parser.add_argument("--workspace", default=os.getcwd(),
                        help="Agent 工作目录")
    parser.add_argument("--allow-dir", action="append", dest="allow_dirs",
                        help="允许访问的目录 (可多次指定)")

    args = parser.parse_args()

    allowed = args.allow_dirs or [args.workspace]
    agent = DeepCodeAgent(workspace=args.workspace, allowed_dirs=allowed)

    if args.http:
        if not HAS_HTTP:
            print("Error: HTTP mode requires fastapi+uvicorn. pip install fastapi uvicorn")
            sys.exit(1)
        app = create_http_app(agent)
        print(f"[agent-sdk] HTTP Server starting on {args.host}:{args.port}")
        print(f"[agent-sdk] Tools: {list(agent.tools._tools.keys())}")
        uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    elif args.mcp:
        print(f"[agent-sdk] MCP stdio mode starting", file=sys.stderr)
        print(f"[agent-sdk] Workspace: {args.workspace}", file=sys.stderr)
        print(f"[agent-sdk] Tools: {list(agent.tools._tools.keys())}", file=sys.stderr)
        asyncio.run(run_mcp_stdio(agent))
    else:
        # 交互式测试模式
        print("[agent-sdk] Interactive mode. Type 'help' for commands.")
        import subprocess

        async def interactive():
            while True:
                try:
                    cmd = input("agent> ").strip()
                except (EOFError, KeyboardInterrupt):
                    break
                if not cmd:
                    continue
                if cmd == "help":
                    print("Available commands:")
                    for t in agent.tools.list_tools():
                        print(f"  {t['name']}: {t['description']}")
                    print("  exit/quit: 退出")
                elif cmd in ("exit", "quit"):
                    break
                elif cmd == "status":
                    result = await agent.execute("agent_status")
                    print(json.dumps(result, ensure_ascii=False, indent=2))
                else:
                    parts = cmd.split(maxsplit=1)
                    tool = parts[0]
                    params = json.loads(parts[1]) if len(parts) > 1 else {}
                    result = await agent.execute(tool, params)
                    print(json.dumps(result, ensure_ascii=False, indent=2))

        asyncio.run(interactive())


if __name__ == "__main__":
    main()
