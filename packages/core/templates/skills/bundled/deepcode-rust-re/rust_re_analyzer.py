#!/usr/bin/env python3
"""
DeepCode Rust RE Analyzer — Rust 二进制逆向分析引擎
═════════════════════════════════════════════════════════
自动分析 Rust Release 二进制，提取关键信息 + LLM 辅助重建 Rust 伪代码。

工作流:
  1. 二进制扫描 → 提取功能字符串和模式
  2. Ghidra 集成 → 提取关键函数反编译结果
  3. LLM 分析 → 将 C 伪代码重建为 Rust 风格代码

用法:
  # 完整分析
  python rust_re_analyzer.py analyze codex.exe --output report.json

  # 只做字符串扫描
  python rust_re_analyzer.py scan codex.exe --features mcp,tools

  # Ghidra 反编译提取 (需要在 Ghidra 脚本窗口运行)
  python rust_re_analyzer.py ghidra-extract codex.exe --functions 100

  # LLM 重建
  python rust_re_analyzer.py rebuild scan_result.json --model deepseek-chat
"""

import json
import os
import re
import struct
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Any


# ── 1. 二进制扫描引擎 ──────────────────────────────────

class BinaryScanner:
    """Rust 二进制扫描器 — 从二进制中直接提取信息"""

    # Rust 工具链特征
    RUST_IDENTIFIERS = {
        'rust_begin_unwind': rb'rust_begin_unwind',
        'core::panic': rb'core::pani',
        'std::rt': rb'std::rt',
        'cargo': rb'cargo::',
    }

    # 已知 Rust crate 签名
    CRATE_SIGS = {
        'tokio': rb'tokio::runtime|tokio_crate',
        'reqwest': rb'reqwest::',
        'hyper': rb'hyper::',
        'serde': rb'serde::de|serde::ser',
        'axum': rb'axum::',
        'tower': rb'tower::',
        'tracing': rb'tracing::',
        'clap': rb'clap::',
        'anyhow': rb'anyhow::',
        'thiserror': rb'thiserror::',
    }

    # 功能特征关键词
    FEATURE_SIGS = {
        'MCP': [rb'[Mm]cp[Ss]erver', rb'mcp__', rb'mcp[.]json'],
        'Tools': [rb'[Tt]ool[Uu]se', rb'[Tt]ool[Cc]all', rb'[Tt]ool[Rr]esult'],
        'Hooks': [rb'[Pp]re[Tt]ool[Uu]se', rb'[Pp]ost[Tt]ool[Uu]se', rb'[Pp]ermission[Rr]equest'],
        'Agent': [rb'[Ss]ub[Aa]gent', rb'[Aa]gent[Ll]oop', rb'[Aa]gent[Mm]essage'],
        'Session': [rb'[Ss]ession[Ss]tart', rb'[Ss]ession[Ee]nd'],
        'Sandbox': [rb'[Ss]andbox', rb'seccomp'],
        'Auth': [rb'[Bb]earer', rb'[Oo][Aa]uth', rb'api_key', rb'access_token'],
        'Stream': [rb'streaming', rb'[Ss]tream[Ee]vent'],
        'Plugin': [rb'[Pp]lugin[Cc]onfig', rb'[Pp]lugin[Hh]ook'],
        'Storage': [rb'[Dd]atabase', rb'[Ss]tore', rb'[Cc]ache'],
        'Network': [rb'reqwest', rb'hyper', rb'tokio::net'],
        'Shell': [rb'bash|sh\b|pwsh|zsh', rb'[Cc]ommand[Ee]xecution'],
    }

    def __init__(self, path: str):
        self.path = path
        self.name = os.path.basename(path)
        with open(path, 'rb') as f:
            self.data = f.read()
        self.size = len(self.data)
        self.pe_info = self._parse_pe()

    def _parse_pe(self) -> Dict:
        """解析 PE 结构"""
        pe_off = struct.unpack('<I', self.data[0x3c:0x40])[0]
        fh = pe_off + 4
        ns = struct.unpack('<H', self.data[fh+2:fh+4])[0]
        ohs = struct.unpack('<H', self.data[fh+16:fh+18])[0]
        st = fh + 20 + ohs
        entries = []
        for i in range(ns):
            s = st + i*40
            nm = self.data[s:s+8].rstrip(b'\x00').decode('ascii', errors='replace')
            vsz = struct.unpack('<I', self.data[s+8:s+12])[0]
            va = struct.unpack('<I', self.data[s+12:s+16])[0]
            entries.append({'name': nm, 'vsize': vsz, 'va': va})
        return {'segments': entries}

    def is_rust(self) -> Dict:
        """检测是否为 Rust 二进制"""
        results = {}
        for name, sig in self.RUST_IDENTIFIERS.items():
            cnt = len(list(re.finditer(sig, self.data)))
            results[name] = cnt > 0
        return {
            'is_rust': any(results.values()),
            'details': results,
        }

    def detect_crates(self) -> Dict[str, int]:
        """检测依赖的 Rust crate"""
        crates = {}
        for name, sig in self.CRATE_SIGS.items():
            cnt = len(list(re.finditer(sig, self.data)))
            if cnt > 0:
                crates[name] = cnt
        return crates

    def scan_features(self) -> Dict[str, Dict]:
        """扫描功能特征"""
        features = {}
        for name, sigs in self.FEATURE_SIGS.items():
            matches = []
            for sig in sigs:
                for m in re.finditer(sig, self.data, re.IGNORECASE):
                    off = m.start()
                    ctx = self.data[max(0,off-10):off+60]
                    text = ''.join(chr(b) if 32 <= b < 127 else '.' for b in ctx)
                    matches.append({'offset': off, 'context': text.strip('.')})
            features[name] = {
                'count': len(matches),
                'samples': matches[:3],
                'present': len(matches) > 0,
            }
        return features

    def find_strings(self, pattern: str, limit: int = 20) -> List[Dict]:
        """搜索特定字符串模式"""
        results = []
        for m in re.finditer(pattern.encode(), self.data, re.IGNORECASE):
            off = m.start()
            ctx = self.data[max(0,off-20):off+80]
            text = ''.join(chr(b) if 32 <= b < 127 else '.' for b in ctx)
            results.append({'offset': f'0x{off:x}', 'context': text.strip('.')})
            if len(results) >= limit:
                break
        return results

    def find_cargo_paths(self) -> List[str]:
        """提取 Cargo 构建路径 (含 crate 名和版本)"""
        paths = set()
        for m in re.finditer(rb'cargo\\registry\\src\\[^\\]+\\\\([^\\\\]+)-(\d+\.\d+\.\d+)', self.data):
            try:
                name = m.group(1).decode('ascii')
                ver = m.group(2).decode('ascii')
                paths.add(f'{name}@{ver}')
            except:
                pass
        return sorted(paths)

    def summary(self) -> Dict:
        """生成扫描摘要"""
        return {
            'binary': self.name,
            'size_mb': round(self.size / 1024 / 1024, 1),
            'rust_check': self.is_rust(),
            'crates': self.detect_crates(),
            'features': {k: {'count': v['count'], 'present': v['present']}
                         for k, v in self.scan_features().items()},
            'cargo_deps': self.find_cargo_paths()[:20],
            'segments': self.pe_info['segments'],
        }


# ── 2. Ghidra 集成层 ──────────────────────────────────

class GhidraExtractor:
    """
    从 Ghidra 提取函数反编译结果

    通过 Ghidra-MCP 或直接运行 Ghidra 脚本实现。
    需要 Ghidra 打开目标二进制。
    """

    def __init__(self, ghidra_mcp_url: str = "http://127.0.0.1:8089"):
        self.url = ghidra_mcp_url
        self._connected = False

    def is_available(self) -> bool:
        """检查 Ghidra-MCP 是否可用"""
        try:
            import urllib.request
            urllib.request.urlopen(f"{self.url}/health", timeout=2)
            self._connected = True
            return True
        except Exception:
            return False

    def extract_near_address(self, address: str, context_lines: int = 50) -> Optional[str]:
        """从指定地址提取反编译结果"""
        if not self._connected:
            return None
        try:
            import urllib.request
            req = urllib.request.Request(
                f"{self.url}/decompile",
                json.dumps({"address": address}).encode(),
                {"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())['decompiled']
        except Exception as e:
            return f"[error] {e}"

    def extract_by_string(self, search_term: str, max_funcs: int = 5) -> List[Dict]:
        """
        通过字符串搜索找到函数并反编译

        工作流:
          1. 在 Ghidra 中搜索字符串
          2. 找到引用该字符串的函数
          3. 反编译每个函数
        """
        results = []
        if not self._connected:
            return results

        try:
            import urllib.request
            # 1. 搜索字符串
            req1 = urllib.request.Request(
                f"{self.url}/search_strings",
                json.dumps({"search": search_term, "limit": 10}).encode(),
                {"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req1, timeout=15) as resp:
                str_results = json.loads(resp.read()).get('matches', [])

            # 2. 对每个字符串找 xref
            for sr in str_results[:max_funcs]:
                addr = sr['address']
                req2 = urllib.request.Request(
                    f"{self.url}/get_xrefs_to",
                    json.dumps({"address": addr}).encode(),
                    {"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req2, timeout=15) as resp:
                    xrefs = json.loads(resp.read()).get('xrefs', [])

                # 3. 反编译每个引用函数
                for xr in xrefs[:2]:
                    func_addr = xr.get('from_address')
                    if func_addr:
                        decomp = self.extract_near_address(func_addr)
                        results.append({
                            'string': sr.get('value', ''),
                            'string_addr': addr,
                            'function_addr': func_addr,
                            'decompiled': decomp,
                        })
        except Exception as e:
            results.append({'error': str(e)})

        return results

    def generate_ghidra_script(self) -> str:
        """生成可用的 Ghidra Python 脚本"""
        return '''# DeepCode Rust RE — Ghidra Python 脚本
# 在 Ghidra 脚本管理器中运行
# 用途: 提取 Rust 二进制中关键函数的反编译结果

from ghidra.app.decompiler import DecompInterface
from ghidra.util.task import ConsoleTaskMonitor
import json

def main():
    monitor = ConsoleTaskMonitor()
    ifc = DecompInterface()
    ifc.openProgram(currentProgram)
    
    results = []
    fm = currentProgram.getFunctionManager()
    
    # 搜索含关键字符串的函数
    key_strings = ["mcp", "tool", "hook", "agent", "sandbox", "plugin"]
    for func in fm.getFunctions(True):
        name = func.getName()
        body = func.getBody()
        
        # 跳过匿名函数 (FUN_...)
        if name.startswith("FUN_"):
            continue
            
        # 反编译
        decomp = ifc.decompileFunction(func, 30, monitor)
        if decomp and decomp.getDecompiledFunction():
            code = decomp.getDecompiledFunction().getC()
            
            # 检查是否含关键词
            if any(kw in code.lower() for kw in key_strings):
                results.append({
                    "name": name,
                    "address": str(func.getEntryPoint()),
                    "body_start": str(body.getMinAddress()),
                    "body_end": str(body.getMaxAddress()),
                    "code": code[:3000],
                })
    
    # 输出 JSON
    out = {
        "program": currentProgram.getName(),
        "functions": results,
        "total": len(results),
    }
    print(json.dumps(out, indent=2))

if __name__ == "__main__":
    main()
'''


# ── 3. LLM 重建引擎 ────────────────────────────────────

class RustReconstructor:
    """
    Rust 代码重建引擎

    将 Ghidra 的 C 伪代码 + 字符串信息发送给 LLM，
    重建为 Rust 风格的伪代码和架构文档。
    """

    RUST_RE_PROMPT = """你是一个 Rust 逆向工程专家。我会给你一段从 Ghidra 反编译出的 C 伪代码，
以及从这个 Rust 二进制中提取的相关字符串。请：

1. 识别这段代码在 Rust 中的原始语义
2. 重建为 Rust 风格的伪代码 (使用 Option/Result/match/impl 等 Rust 惯用法)
3. 标注关键函数的作用
4. 识别所有权/借用关系

C 伪代码:
```c
{code}
```

相关字符串:
{strings}

相关 crate 依赖:
{crates}

请输出:
1. Rust 风格伪代码
2. 功能说明
3. 可能的原始 Rust 类型定义
"""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
        self.base_url = "https://api.deepseek.com"

    def is_available(self) -> bool:
        return bool(self.api_key)

    def analyze_decompiled(self, code: str, strings: List[str],
                           crates: Dict[str, int]) -> Dict:
        """分析单个反编译函数"""
        if not self.is_available():
            return {"error": "DEEPSEEK_API_KEY not set"}

        prompt = self.RUST_RE_PROMPT.format(
            code=code[:4000],
            strings='\n'.join(strings[:10]),
            crates=json.dumps(crates, indent=2),
        )

        try:
            from openai import OpenAI
            client = OpenAI(api_key=self.api_key, base_url=f"{self.base_url}/v1")
            resp = client.chat.completions.create(
                model="deepseek-chat",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=4096,
                temperature=0.3,
            )
            return {
                "rust_reconstruction": resp.choices[0].message.content,
                "model": "deepseek-chat",
            }
        except Exception as e:
            return {"error": str(e)}

    def analyze_architecture(self, summary: Dict) -> Dict:
        """分析整体架构"""
        prompt = f"""
你是一个 Rust 逆向架构分析师。请分析以下二进制扫描结果，重建架构文档。

二进制: {summary.get('binary', 'unknown')}
大小: {summary.get('size_mb', 0)} MB
检测到的 crate: {json.dumps(summary.get('crates', {}), indent=2)}
功能特征: {json.dumps(summary.get('features', {}), indent=2)}
Cargo 依赖: {json.dumps(summary.get('cargo_deps', [])[:15], indent=2)}

请输出:
1. **架构总览** — 这个二进制的主要模块划分
2. **关键 crate 用途** — 每个检测到的 crate 在这个场景中的作用
3. **功能实现分析** — 基于检测到的特征，描述每个功能的可能实现方式
4. **入口点猜测** — main 函数可能在做什么
5. **与 Claude Code 对比** — 架构差异和各自的独特设计
"""
        if not self.is_available():
            return {"architecture_analysis": "(需要设置 DEEPSEEK_API_KEY)"}

        try:
            from openai import OpenAI
            client = OpenAI(api_key=self.api_key, base_url=f"{self.base_url}/v1")
            resp = client.chat.completions.create(
                model="deepseek-chat",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=4096,
                temperature=0.3,
            )
            return {"architecture_analysis": resp.choices[0].message.content}
        except Exception as e:
            return {"error": str(e)}


# ── 4. CLI 入口 ────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="DeepCode Rust RE Analyzer — Rust 二进制逆向引擎"
    )
    sub = parser.add_subparsers(dest="mode")

    # scan
    scan_p = sub.add_parser("scan", help="扫描二进制")
    scan_p.add_argument("binary", help="二进制路径")
    scan_p.add_argument("--features", help="指定功能 (逗号分隔)")
    scan_p.add_argument("--output", help="输出文件")

    # analyze (scan + LLM)
    ana_p = sub.add_parser("analyze", help="完整分析")
    ana_p.add_argument("binary", help="二进制路径")
    ana_p.add_argument("--output", default="rust_re_report.json")

    # ghidra-script
    gs_p = sub.add_parser("ghidra-script", help="生成 Ghidra 脚本")
    gs_p.add_argument("--output", default="rust_re_ghidra.py")

    # rebuild
    rb_p = sub.add_parser("rebuild", help="LLM 重建 Rust 代码")
    rb_p.add_argument("scan_result", help="扫描结果 JSON")
    rb_p.add_argument("--model", default="deepseek-chat")

    args = parser.parse_args()

    if args.mode == "scan":
        scanner = BinaryScanner(args.binary)
        result = scanner.summary()
        if args.features:
            feats = args.features.split(',')
            result['features'] = {k: v for k, v in result['features'].items()
                                   if k in feats}
        output = args.output or f"{scanner.name}_scan.json"
        Path(output).write_text(json.dumps(result, indent=2, ensure_ascii=False))
        print(json.dumps(result, indent=2, ensure_ascii=False))
        print(f"\n[OK] Scan saved to {output}")

    elif args.mode == "analyze":
        scanner = BinaryScanner(args.binary)
        summary = scanner.summary()

        # 额外提取
        summary['strings_hooks'] = scanner.find_strings('PreTool|PostTool|PermissionRequest', 10)
        summary['strings_api'] = scanner.find_strings('/v1/|/api/', 10)
        summary['strings_error'] = scanner.find_strings('error|failed|invalid', 5)
        summary['cargo_paths'] = scanner.find_cargo_paths()[:30]

        # LLM 分析
        reconstructor = RustReconstructor()
        arch = reconstructor.analyze_architecture(summary)

        report = {
            'scan': summary,
            'architecture': arch,
            'toolchain': {
                'rustfilt': shutil.which('rustfilt') or '(not in PATH)',
                'GhidRust': os.path.exists(os.path.expanduser(
                    '~/AppData/Roaming/ghidra/ghidra_12.1.2_PUBLIC/Extensions/GhidRust')),
                'Ghidra_MCP': True,
            },
        }

        Path(args.output).write_text(
            json.dumps(report, indent=2, ensure_ascii=False)
        )
        print(f"[OK] Full report saved to {args.output}")
        print(f"\n=== 架构分析 ===\n{arch.get('architecture_analysis', 'N/A')}")

    elif args.mode == "ghidra-script":
        extractor = GhidraExtractor()
        script = extractor.generate_ghidra_script()
        path = args.output or "rust_re_ghidra.py"
        Path(path).write_text(script)
        print(f"[OK] Ghidra script saved to {path}")
        print("在 Ghidra 中: Window → Script Manager → Run Script")

    elif args.mode == "rebuild":
        data = json.loads(Path(args.scan_result).read_text())
        reconstructor = RustReconstructor()

        # 从扫描结果中提取需要重建的部分
        features = data.get('scan', data).get('features', {})
        crates = data.get('scan', data).get('crates', {})

        for feat_name, feat_data in features.items():
            if feat_data.get('present') and feat_data.get('samples'):
                print(f"\n=== Rebuilding: {feat_name} ===")
                strings = [s.get('context', '') for s in feat_data['samples'][:3]]
                result = reconstructor.analyze_decompiled(
                    code=f"// {feat_name} feature detected with {feat_data['count']} references",
                    strings=strings,
                    crates=crates,
                )
                if 'rust_reconstruction' in result:
                    print(result['rust_reconstruction'][:1000])
                else:
                    print(f"Error: {result.get('error', 'unknown')}")

    else:
        parser.print_help()


import shutil

if __name__ == "__main__":
    main()
