#!/usr/bin/env python3
"""
DeepCode Chrome Bridge — 移植自 Claude Code claudeInChrome/setup.ts
══════════════════════════════════════════════════════════════════
Chrome 浏览器集成 — 让 DeepCode 控制浏览器、读取页面、管理 Tab。

从 claude.exe .bun 段逆向提取的 API:
  - trackClaudeInChromeTabId / openInChrome / isTrackedClaudeInChromeTabId
  - isClaudeInChromeMCPServer / getClaudeInChromeMCPToolOverrides
  - getSocketDir / getSecureSocketPath

MCP 工具 (对标 claude-in-chrome 扩展):
  - navigate      → 浏览器导航
  - computer      → 浏览器内操作 (点击/输入/滚动)
  - read_page     → 读取页面内容
  - tabs_context  → Tab 上下文管理
  - tabs_create   → 创建新 Tab

用法:
  python chrome_bridge.py --http --port 8090
  python chrome_bridge.py --mcp
  python chrome_bridge.py navigate https://example.com
"""

import asyncio
import json
import os
import sys
import tempfile
import time
import uuid
from datetime import datetime
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Any

HAS_PLAYWRIGHT = False
try:
    from playwright.async_api import async_playwright, Browser, Page, BrowserContext
    HAS_PLAYWRIGHT = True
except ImportError:
    pass

HAS_HTTP = False
try:
    from fastapi import FastAPI, HTTPException, Request
    import uvicorn
    HAS_HTTP = True
except ImportError:
    pass


# ── Tab 管理器 — 对标 Claude Code Chrome tab tracking ─────

class TabManager:
    """Tab 管理器 — 对标 claudeInChrome tab tracking API"""

    def __init__(self):
        self._tabs: Dict[str, Dict] = {}   # tab_id -> info
        self._tracked: Dict[str, str] = {}  # url -> tab_id

    def track(self, tab_id: str, url: str, title: str = ""):
        """trackClaudeInChromeTabId — 追踪一个 Tab"""
        self._tabs[tab_id] = {
            "id": tab_id, "url": url, "title": title,
            "created_at": datetime.now().isoformat(),
        }
        self._tracked[url] = tab_id

    def is_tracked(self, tab_id: str) -> bool:
        """isTrackedClaudeInChromeTabId — 检查 Tab 是否被追踪"""
        return tab_id in self._tabs

    def get_tab(self, tab_id: str) -> Optional[Dict]:
        return self._tabs.get(tab_id)

    def list_tabs(self) -> List[Dict]:
        return list(self._tabs.values())

    def remove(self, tab_id: str):
        self._tabs.pop(tab_id, None)
        # 清理 url 索引
        for url, tid in list(self._tracked.items()):
            if tid == tab_id:
                self._tracked.pop(url, None)


# ── Chrome 桥接器 ──────────────────────────────────────────

class ChromeBridge:
    """
    Chrome 浏览器桥接器 — 对标 Claude Code claudeInChrome 功能

    使用 Playwright 控制 Chrome 浏览器，提供对标 claude-in-chrome 扩展的 MCP 工具。

    核心 API (从 .bun 段逆向):
      - openInChrome(url)              → navigate
      - trackClaudeInChromeTabId(id)   → tab tracking
      - isClaudeInChromeMCPServer()    → MCP server status
      - getClaudeInChromeMCPToolOverrides() → tool config
      - getSocketDir()                 → temp dir
    """

    def __init__(self, chrome_path: Optional[str] = None, headless: bool = False):
        self.chrome_path = chrome_path or self._find_chrome()
        self.headless = headless
        self._playwright = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._default_page: Optional[Page] = None
        self.tabs = TabManager()
        self._connected = False

    @staticmethod
    def _find_chrome() -> Optional[str]:
        """自动查找 Chrome 路径"""
        candidates = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            os.path.expanduser("~") + r"\AppData\Local\Google\Chrome\Application\chrome.exe",
            "/usr/bin/google-chrome",
            "/usr/bin/chromium-browser",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ]
        for p in candidates:
            if os.path.exists(p):
                return p
        return None

    async def connect(self) -> bool:
        """连接 Chrome — 对标 isClaudeInChromeMCPServer"""
        if not HAS_PLAYWRIGHT:
            print("[chrome] Playwright not installed. Run: pip install playwright && playwright install chromium")
            return False
        if self._connected:
            return True
        try:
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=self.headless,
                executable_path=self.chrome_path,
            )
            self._context = await self._browser.new_context()
            self._default_page = await self._context.new_page()
            self._connected = True
            print(f"[chrome] Connected: {self.chrome_path}")
            return True
        except Exception as e:
            print(f"[chrome] Connection failed: {e}")
            return False

    async def disconnect(self):
        """断开连接"""
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        self._connected = False

    # ── 核心 API (对标 Claude Code claudeInChrome) ──────

    async def navigate(self, url: str, tab_id: Optional[str] = None) -> Dict:
        """
        openInChrome — 在 Chrome 中打开 URL

        对标 Claude Code claudeInChrome:
          - navigate / openInChrome
          - trackClaudeInChromeTabId
        """
        if not self._connected:
            return {"error": "Chrome not connected"}

        page = self._default_page
        try:
            await page.goto(url, timeout=30000, wait_until="domcontentloaded")
            actual_url = page.url
            title = await page.title()

            # 自动追踪 Tab
            tid = tab_id or str(uuid.uuid4())
            self.tabs.track(tid, actual_url, title)

            return {
                "status": "ok",
                "url": actual_url,
                "title": title,
                "tab_id": tid,
                "tracked": True,
            }
        except Exception as e:
            return {"error": str(e), "url": url}

    async def snap_page(self, tab_id: Optional[str] = None) -> Dict:
        """
        read_page — 读取页面内容 / 截屏

        对标 Claude Code claudeInChrome: read_page
        """
        if not self._connected:
            return {"error": "Chrome not connected"}
        page = self._default_page
        try:
            title = await page.title()
            url = page.url
            content = await page.content()
            text = await page.evaluate("() => document.body.innerText")
            # 截屏
            screenshot_path = os.path.join(
                tempfile.gettempdir(),
                f"chrome_screenshot_{uuid.uuid4().hex[:8]}.png"
            )
            await page.screenshot(path=screenshot_path, full_page=True)
            return {
                "title": title,
                "url": url,
                "text_length": len(text or ""),
                "text_preview": (text or "")[:2000],
                "screenshot": screenshot_path,
                "tab_id": tab_id or "default",
            }
        except Exception as e:
            return {"error": str(e)}

    async def get_tabs_context(self) -> Dict:
        """
        tabs_context — Tab 上下文管理

        对标 Claude Code claudeInChrome: tabs_context_mcp
        """
        if not self._connected:
            return {"error": "Chrome not connected"}
        pages = self._context.pages if self._context else []
        tabs_info = []
        for i, p in enumerate(pages):
            try:
                tabs_info.append({
                    "index": i,
                    "url": p.url,
                    "title": await p.title(),
                })
            except Exception:
                tabs_info.append({"index": i, "url": "?", "title": "?"})

        return {
            "tabs": tabs_info,
            "tracked": self.tabs.list_tabs(),
            "total": len(tabs_info),
            "is_mcp_server": self._connected,
        }

    async def create_tab(self, url: str = "about:blank") -> Dict:
        """
        tabs_create — 创建新 Tab

        对标 Claude Code claudeInChrome: tabs_create_mcp
        """
        if not self._connected or not self._context:
            return {"error": "Chrome not connected"}
        try:
            page = await self._context.new_page()
            if url and url != "about:blank":
                await page.goto(url, timeout=15000)
            tid = str(uuid.uuid4())
            self.tabs.track(tid, page.url, await page.title())
            return {"tab_id": tid, "url": page.url, "status": "created"}
        except Exception as e:
            return {"error": str(e)}

    # ── 支持方法 ──────────────────────────────────────

    def get_mcp_tool_overrides(self) -> Dict:
        """
        getClaudeInChromeMCPToolOverrides — 工具覆盖配置
        """
        return {
            "navigate": {"timeout": 30000, "wait_until": "domcontentloaded"},
            "computer": {"viewport": {"width": 1280, "height": 720}},
            "read_page": {"screenshot": True, "max_text": 50000},
        }

    def get_socket_dir(self) -> str:
        """getSocketDir — 临时目录"""
        return tempfile.gettempdir()

    def status(self) -> Dict:
        """isClaudeInChromeMCPServer — 服务状态"""
        return {
            "connected": self._connected,
            "chrome_path": self.chrome_path,
            "has_playwright": HAS_PLAYWRIGHT,
            "headless": self.headless,
            "tabs_tracked": len(self.tabs.list_tabs()),
            "tabs_open": len(self._context.pages) if self._context else 0,
        }


# ── MCP Server 模式 ──────────────────────────────────────

async def run_mcp(bridge: ChromeBridge):
    """MCP Server 模式"""
    await bridge.connect()

    print(json.dumps({
        "jsonrpc": "2.0",
        "method": "server/initialized",
        "params": {
            "protocol_version": "0.1.0",
            "capabilities": {"tools": {}},
            "server_info": {"name": "deepcode-chrome", "version": "1.0.0"},
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
                            {
                                "name": "chrome_navigate",
                                "description": "在 Chrome 中打开 URL (openInChrome)",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "url": {"type": "string", "description": "要打开的 URL"},
                                    },
                                    "required": ["url"],
                                },
                            },
                            {
                                "name": "chrome_snap",
                                "description": "读取当前页面内容/截屏 (read_page)",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {},
                                },
                            },
                            {
                                "name": "chrome_tabs",
                                "description": "列出所有 Tab 上下文 (tabs_context)",
                                "inputSchema": {"type": "object", "properties": {}},
                            },
                            {
                                "name": "chrome_new_tab",
                                "description": "创建新 Tab (tabs_create)",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "url": {"type": "string", "description": "URL"},
                                    },
                                },
                            },
                            {
                                "name": "chrome_status",
                                "description": "Chrome 桥接器状态 (isClaudeInChromeMCPServer)",
                                "inputSchema": {"type": "object", "properties": {}},
                            },
                        ],
                    },
                }), flush=True)

            elif method == "tools/call":
                name = params.get("name", "")
                args = params.get("arguments", {})
                result = {}

                if name == "chrome_navigate":
                    result = await bridge.navigate(args.get("url", "about:blank"))
                elif name == "chrome_snap":
                    result = await bridge.snap_page()
                elif name == "chrome_tabs":
                    result = await bridge.get_tabs_context()
                elif name == "chrome_new_tab":
                    result = await bridge.create_tab(args.get("url", "about:blank"))
                elif name == "chrome_status":
                    result = bridge.status()
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


# ── HTTP Server 模式 ─────────────────────────────────────

def create_http_app(bridge: ChromeBridge):
    """创建 FastAPI HTTP 应用"""
    if not HAS_HTTP:
        raise RuntimeError("FastAPI not installed")

    app = FastAPI(title="DeepCode Chrome Bridge", version="1.0.0")

    @app.on_event("startup")
    async def startup():
        await bridge.connect()

    @app.on_event("shutdown")
    async def shutdown():
        await bridge.disconnect()

    @app.get("/status")
    async def status():
        return bridge.status()

    @app.post("/navigate")
    async def navigate(req: Request):
        body = await req.json()
        result = await bridge.navigate(body.get("url", ""))
        return result

    @app.get("/snap")
    async def snap():
        return await bridge.snap_page()

    @app.get("/tabs")
    async def tabs():
        return await bridge.get_tabs_context()

    @app.post("/tab")
    async def new_tab(req: Request):
        body = await req.json()
        return await bridge.create_tab(body.get("url", "about:blank"))

    return app


# ── CLI 入口 ──────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="DeepCode Chrome Bridge")
    parser.add_argument("--mcp", action="store_true", help="MCP Server 模式")
    parser.add_argument("--http", action="store_true", help="HTTP Server 模式")
    parser.add_argument("--port", type=int, default=8090, help="HTTP 端口")
    parser.add_argument("--headless", action="store_true", help="无头模式")
    parser.add_argument("--chrome", help="Chrome 可执行文件路径")

    sub = parser.add_subparsers(dest="mode")
    nav = sub.add_parser("navigate", help="打开 URL")
    nav.add_argument("url", help="要打开的 URL")

    args = parser.parse_args()

    bridge = ChromeBridge(chrome_path=args.chrome, headless=args.headless)

    if args.mcp:
        asyncio.run(run_mcp(bridge))
    elif args.http:
        if not HAS_HTTP:
            print("Error: pip install fastapi uvicorn")
            sys.exit(1)
        app = create_http_app(bridge)
        uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")
    elif args.mode == "navigate":
        async def run():
            ok = await bridge.connect()
            if not ok:
                print("Failed to connect to Chrome")
                return
            result = await bridge.navigate(args.url)
            print(json.dumps(result, indent=2, ensure_ascii=False))
            await bridge.disconnect()
        asyncio.run(run())
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
