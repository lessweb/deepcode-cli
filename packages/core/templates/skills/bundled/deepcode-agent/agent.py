#!/usr/bin/env python3
"""
DeepCode Agent — Agent Message 类型系统
═══════════════════════════════════════
移植自 codex.exe 的 Agent Message 架构:
  - AgentMessagePlan / AgentMessageEvent / AgentMessageItem
  - CallToolResult / CommandExecution / DynamicToolCall
  - AgentMessageContent 的 21 种变体

用法:
  # CLI 记录 Agent 活动
  python agent.py plan "分析代码然后修复 bug"
  python agent.py tool --name Bash --input "ls -la" --result '{"exit_code": 0}'
  python agent.py status

  # MCP Server
  python agent.py --mcp

  # Python 嵌入
  from agent import AgentSession, ToolCall, CommandExec
  session = AgentSession("分析项目")
  session.add_tool_call("Bash", {"command": "ls"})
"""

import asyncio
import json
import os
import sys
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Any, AsyncIterator


# ── Agent Message 类型定义 — 移植自 codex.exe ────────────

class AgentMessageType(str, Enum):
    """Agent 消息类型 — codex.exe AgentMessageContent 变体"""
    REASONING = "reasoning"
    PLAN = "plan"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    COMMAND_EXECUTION = "command_execution"
    COMMAND_BEGIN = "command_begin"
    COMMAND_END = "command_end"
    FILE_CHANGE = "file_change"
    WEB_SEARCH = "web_search"
    IMAGE_VIEW = "image_view"
    IMAGE_GENERATION = "image_generation"
    MCP_TOOL_CALL = "mcp_tool_call"
    SUB_AGENT_ACTIVITY = "sub_agent_activity"
    COLLAB_AGENT_TOOL_CALL = "collab_agent_tool_call"
    EXTENSION = "extension"
    CONTEXT_COMPACT = "context_compact"
    ENTERED_REVIEW_MODE = "entered_review_mode"
    EXITED_REVIEW_MODE = "exited_review_mode"
    TEXT = "text"
    ERROR = "error"
    SYSTEM = "system"


class AgentStatus(str, Enum):
    """Agent 状态"""
    PLANNING = "planning"
    EXECUTING = "executing"
    AWAITING_INPUT = "awaiting_input"
    COMPLETED = "completed"
    FAILED = "failed"
    STOPPED = "stopped"


class ToolCallStatus(str, Enum):
    """工具调用状态 — codex.exe CallToolResult"""
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    BLOCKED = "blocked"
    TIMEOUT = "timeout"


# ── 核心数据类型 ─────────────────────────────────────────

@dataclass
class ToolCall:
    """工具调用 — 对标 codex.exe DynamicToolCall + CallToolResult"""
    id: str = ""
    name: str = ""
    input: Dict[str, Any] = field(default_factory=dict)
    status: ToolCallStatus = ToolCallStatus.PENDING
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    duration_ms: Optional[int] = None
    turn_id: str = ""

    def __post_init__(self):
        if not self.id:
            self.id = f"tc_{uuid.uuid4().hex[:8]}"
        if not self.started_at:
            self.started_at = datetime.now().isoformat()

    def complete(self, result: Dict[str, Any]):
        self.status = ToolCallStatus.SUCCESS
        self.result = result
        self.ended_at = datetime.now().isoformat()
        self._calc_duration()

    def fail(self, error: str):
        self.status = ToolCallStatus.FAILED
        self.error = error
        self.ended_at = datetime.now().isoformat()
        self._calc_duration()

    def _calc_duration(self):
        if self.started_at and self.ended_at:
            try:
                s = datetime.fromisoformat(self.started_at)
                e = datetime.fromisoformat(self.ended_at)
                self.duration_ms = int((e - s).total_seconds() * 1000)
            except Exception:
                pass

    def to_dict(self) -> Dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class CommandExecution:
    """命令执行 — 对标 codex.exe CommandExecutionItem + CommandBeginEvent + CommandEndEvent"""
    id: str = ""
    command: str = ""
    parsed_cmd: str = ""
    source: str = "bash"
    stdin: str = ""
    stdout: str = ""
    stderr: str = ""
    exit_code: Optional[int] = None
    interaction_input: str = ""
    status: ToolCallStatus = ToolCallStatus.PENDING
    started_at: str = ""
    ended_at: str = ""
    duration_ms: Optional[int] = None
    cwd: str = ""

    def __post_init__(self):
        if not self.id:
            self.id = f"cmd_{uuid.uuid4().hex[:8]}"
        if not self.started_at:
            self.started_at = datetime.now().isoformat()

    def complete(self, stdout: str = "", stderr: str = "", exit_code: int = 0):
        self.stdout = stdout
        self.stderr = stderr
        self.exit_code = exit_code
        self.status = ToolCallStatus.SUCCESS if exit_code == 0 else ToolCallStatus.FAILED
        self.ended_at = datetime.now().isoformat()

    def to_dict(self) -> Dict:
        d = asdict(self)
        # 截断过长的输出
        for key in ['stdout', 'stderr']:
            if len(d.get(key, '')) > 1000:
                d[key] = d[key][:1000] + f'... ({len(d[key])} chars total)'
        return d


@dataclass
class AgentMessage:
    """Agent 消息 — 对标 codex.exe AgentMessageItem + AgentMessageContentDeltaEvent"""
    id: str = ""
    type: AgentMessageType = AgentMessageType.TEXT
    content: str = ""
    timestamp: str = ""
    turn_id: str = ""
    tool_call: Optional[ToolCall] = None
    command_exec: Optional[CommandExecution] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    parent_id: Optional[str] = None
    delta: bool = False  # True = 增量事件 (AgentMessageContentDeltaEvent)

    def __post_init__(self):
        if not self.id:
            self.id = f"msg_{uuid.uuid4().hex[:8]}"
        if not self.timestamp:
            self.timestamp = datetime.now().isoformat()

    def to_dict(self) -> Dict:
        d = asdict(self)
        if self.tool_call:
            d['tool_call'] = self.tool_call.to_dict()
        if self.command_exec:
            d['command_exec'] = self.command_exec.to_dict()
        return d


@dataclass
class AgentPlan:
    """Agent 计划 — 对标 codex.exe AgentMessagePlan"""
    id: str = ""
    goal: str = ""
    steps: List[Dict[str, Any]] = field(default_factory=list)
    status: AgentStatus = AgentStatus.PLANNING
    reasoning: str = ""
    created_at: str = ""
    completed_at: str = ""
    turn_count: int = 0
    tool_call_count: int = 0
    error: Optional[str] = None

    def __post_init__(self):
        if not self.id:
            self.id = f"plan_{uuid.uuid4().hex[:8]}"
        if not self.created_at:
            self.created_at = datetime.now().isoformat()

    def to_dict(self) -> Dict:
        return asdict(self)


# ── Agent 会话 ───────────────────────────────────────────

class AgentSession:
    """
    Agent 会话 — 记录 Agent 的完整活动历史

    对标 codex.exe 的:
      - AgentSession 生命周期 (SessionStart/SessionEnd)
      - AgentMessageItem 消息序列
      - SubagentStart/SubagentStop 子 Agent 管理
      - CallToolResult 工具调用结果
    """

    def __init__(self, goal: str = "", session_id: str = ""):
        self.id = session_id or f"sess_{uuid.uuid4().hex[:8]}"
        self.goal = goal
        self.plan = AgentPlan(goal=goal)
        self.messages: List[AgentMessage] = []
        self.tool_calls: List[ToolCall] = []
        self.command_execs: List[CommandExecution] = []
        self.sub_agents: List[Dict] = []
        self.status = AgentStatus.PLANNING
        self.started_at = datetime.now().isoformat()
        self.ended_at: Optional[str] = None
        self.current_turn_id: str = ""

    def start_turn(self) -> str:
        """开始一个新 turn"""
        self.current_turn_id = f"turn_{uuid.uuid4().hex[:8]}"
        self.plan.turn_count += 1
        return self.current_turn_id

    def add_message(self, msg_type: AgentMessageType, content: str,
                    tool_call: Optional[ToolCall] = None,
                    command_exec: Optional[CommandExecution] = None,
                    delta: bool = False) -> AgentMessage:
        """添加消息 — 对标 AgentMessageItem / AgentMessageContentDeltaEvent"""
        msg = AgentMessage(
            type=msg_type,
            content=content,
            turn_id=self.current_turn_id,
            tool_call=tool_call,
            command_exec=command_exec,
            delta=delta,
        )
        if self.messages:
            msg.parent_id = self.messages[-1].id
        self.messages.append(msg)
        return msg

    def add_tool_call(self, name: str, input_data: Dict) -> ToolCall:
        """记录工具调用 — 对标 DynamicToolCall"""
        tc = ToolCall(name=name, input=input_data, turn_id=self.current_turn_id)
        self.tool_calls.append(tc)
        self.plan.tool_call_count += 1
        self.add_message(AgentMessageType.TOOL_CALL,
                        f"调用工具: {name}", tool_call=tc)
        return tc

    def add_command(self, command: str, cwd: str = "") -> CommandExecution:
        """记录命令执行 — 对标 CommandExecutionItem + CommandBeginEvent"""
        ce = CommandExecution(command=command, cwd=cwd)
        self.command_execs.append(ce)
        self.add_message(AgentMessageType.COMMAND_BEGIN,
                        f"执行: {command[:100]}", command_exec=ce)
        return ce

    def add_reasoning(self, text: str) -> AgentMessage:
        """记录推理过程 — 对标 AgentMessagePlan / Reasoning"""
        return self.add_message(AgentMessageType.REASONING, text)

    def add_text(self, text: str) -> AgentMessage:
        """记录文本消息"""
        return self.add_message(AgentMessageType.TEXT, text)

    def add_error(self, error: str) -> AgentMessage:
        """记录错误"""
        self.status = AgentStatus.FAILED
        return self.add_message(AgentMessageType.ERROR, error)

    def create_sub_agent(self, agent_id: str, goal: str) -> Dict:
        """创建子 Agent — 对标 SubagentStart"""
        sa = {
            "id": agent_id,
            "goal": goal,
            "started_at": datetime.now().isoformat(),
        }
        self.sub_agents.append(sa)
        return sa

    def complete(self):
        """标记会话完成 — 对标 SessionEnd"""
        self.status = AgentStatus.COMPLETED
        self.ended_at = datetime.now().isoformat()
        self.plan.status = AgentStatus.COMPLETED
        self.plan.completed_at = self.ended_at

    def summary(self) -> Dict:
        """生成会话摘要"""
        return {
            "session_id": self.id,
            "goal": self.goal,
            "status": self.status.value,
            "messages": len(self.messages),
            "tool_calls": len(self.tool_calls),
            "commands": len(self.command_execs),
            "sub_agents": len(self.sub_agents),
            "turns": self.plan.turn_count,
            "duration_sec": (datetime.fromisoformat(self.ended_at) -
                           datetime.fromisoformat(self.started_at)).total_seconds()
                           if self.ended_at else 0,
            "started_at": self.started_at,
            "ended_at": self.ended_at or "",
        }

    def export_json(self) -> Dict:
        """导出完整 JSON — 可供 LLM 分析"""
        return {
            "session": self.summary(),
            "plan": self.plan.to_dict(),
            "messages": [m.to_dict() for m in self.messages],
            "tool_calls": [tc.to_dict() for tc in self.tool_calls],
            "commands": [ce.to_dict() for ce in self.command_execs],
        }


# ── MCP Server 模式 ─────────────────────────────────────

sessions: Dict[str, AgentSession] = {}
_current_session: Optional[AgentSession] = None

def _get_session() -> AgentSession:
    global _current_session
    if _current_session is None:
        _current_session = AgentSession()
        sessions[_current_session.id] = _current_session
    return _current_session


async def run_mcp():
    """MCP Server 模式"""
    global _current_session

    print(json.dumps({
        "jsonrpc": "2.0", "method": "server/initialized",
        "params": {
            "protocol_version": "0.1.0",
            "capabilities": {"tools": {}},
            "server_info": {"name": "deepcode-agent", "version": "1.0.0"},
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
            rid = req.get("id", "")

            if method == "tools/list":
                print(json.dumps({
                    "jsonrpc": "2.0", "id": rid,
                    "result": {
                        "tools": [
                            {"name": "agent_plan",
                             "description": "创建/更新 Agent 计划 (AgentMessagePlan)",
                             "inputSchema": {"type": "object", "properties": {
                                 "goal": {"type": "string"},
                                 "steps": {"type": "array", "items": {"type": "string"}},
                             }, "required": ["goal"]}},
                            {"name": "agent_tool_call",
                             "description": "记录工具调用 (DynamicToolCall + CallToolResult)",
                             "inputSchema": {"type": "object", "properties": {
                                 "name": {"type": "string"}, "input": {"type": "object"},
                                 "result": {"type": "object"}, "error": {"type": "string"},
                             }, "required": ["name"]}},
                            {"name": "agent_reasoning",
                             "description": "记录推理过程 (AgentMessagePlan/Reasoning)",
                             "inputSchema": {"type": "object", "properties": {
                                 "text": {"type": "string"},
                             }, "required": ["text"]}},
                            {"name": "agent_command",
                             "description": "记录命令执行 (CommandExecutionItem)",
                             "inputSchema": {"type": "object", "properties": {
                                 "command": {"type": "string"}, "cwd": {"type": "string"},
                                 "stdout": {"type": "string"}, "exit_code": {"type": "integer"},
                             }, "required": ["command"]}},
                            {"name": "agent_status",
                             "description": "获取 Agent 会话状态",
                             "inputSchema": {"type": "object", "properties": {}}},
                            {"name": "agent_export",
                             "description": "导出完整会话 JSON",
                             "inputSchema": {"type": "object", "properties": {}}},
                        ],
                    },
                }), flush=True)

            elif method == "tools/call":
                name = params.get("name", "")
                args = params.get("arguments", {})
                sess = _get_session()
                sess.start_turn()

                if name == "agent_plan":
                    sess.plan.goal = args.get("goal", "")
                    sess.add_message(AgentMessageType.PLAN, sess.plan.goal)
                    sess.status = AgentStatus.EXECUTING
                    result = {"plan_id": sess.plan.id, "goal": sess.plan.goal}
                elif name == "agent_tool_call":
                    tc = sess.add_tool_call(
                        args.get("name", ""), args.get("input", {}))
                    if args.get("result"):
                        tc.complete(args["result"])
                    if args.get("error"):
                        tc.fail(args["error"])
                    result = {"tool_call_id": tc.id, "status": tc.status.value}
                elif name == "agent_reasoning":
                    msg = sess.add_reasoning(args.get("text", ""))
                    result = {"message_id": msg.id}
                elif name == "agent_command":
                    cmd = args.get("command", "")
                    ce = sess.add_command(cmd, args.get("cwd", ""))
                    if "stdout" in args or "exit_code" in args:
                        ce.complete(
                            stdout=args.get("stdout", ""),
                            stderr=args.get("stderr", ""),
                            exit_code=args.get("exit_code", 0),
                        )
                    result = {"command_id": ce.id, "status": ce.status.value}
                elif name == "agent_status":
                    result = sess.summary()
                elif name == "agent_export":
                    result = sess.export_json()
                else:
                    result = {"error": f"Unknown: {name}"}

                print(json.dumps({
                    "jsonrpc": "2.0", "id": rid,
                    "result": {
                        "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]
                    },
                }), flush=True)

        except json.JSONDecodeError:
            pass


# ── CLI 入口 ──────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="DeepCode Agent")
    parser.add_argument("--mcp", action="store_true", help="MCP Server 模式")
    sub = parser.add_subparsers(dest="mode")

    p_plan = sub.add_parser("plan", help="创建计划")
    p_plan.add_argument("goal", help="目标")

    p_tool = sub.add_parser("tool", help="记录工具调用")
    p_tool.add_argument("--name", required=True)
    p_tool.add_argument("--input", default="{}")
    p_tool.add_argument("--result")
    p_tool.add_argument("--error")

    p_cmd = sub.add_parser("command", help="记录命令执行")
    p_cmd.add_argument("cmd", help="命令")
    p_cmd.add_argument("--cwd", default=os.getcwd())
    p_cmd.add_argument("--stdout", default="")
    p_cmd.add_argument("--exit-code", type=int, default=0)

    p_reason = sub.add_parser("reason", help="记录推理")
    p_reason.add_argument("text", help="推理内容")

    sub.add_parser("status", help="会话状态")
    sub.add_parser("export", help="导出 JSON")

    args = parser.parse_args()

    if args.mcp:
        asyncio.run(run_mcp())
        return

    sess = _get_session()
    sess.start_turn()

    if args.mode == "plan":
        sess.plan.goal = args.goal
        sess.add_message(AgentMessageType.PLAN, args.goal)
        sess.status = AgentStatus.EXECUTING
        print(json.dumps({"plan_id": sess.plan.id, "goal": args.goal}, indent=2))

    elif args.mode == "tool":
        tc = sess.add_tool_call(args.name, json.loads(args.input or "{}"))
        if args.result:
            tc.complete(json.loads(args.result))
        if args.error:
            tc.fail(args.error)
        print(json.dumps(tc.to_dict(), indent=2))

    elif args.mode == "command":
        ce = sess.add_command(args.cmd, args.cwd)
        if args.stdout:
            ce.complete(stdout=args.stdout, exit_code=args.exit_code)
        print(json.dumps(ce.to_dict(), indent=2))

    elif args.mode == "reason":
        msg = sess.add_reasoning(args.text)
        print(json.dumps({"message_id": msg.id, "content": args.text[:200]}, indent=2))

    elif args.mode == "status":
        print(json.dumps(sess.summary(), indent=2))

    elif args.mode == "export":
        print(json.dumps(sess.export_json(), indent=2))

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
