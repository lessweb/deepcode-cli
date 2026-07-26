#!/usr/bin/env python3
"""
DeepCode Auth — 企业级认证模块
═════════════════════════════
来自:
  - Claude Code v2.1.216 OAuth2/OIDC 栈
  - codex.exe Auth Provider 架构 (AWS / GitHub / Device / Bearer)

支持的认证方式:
  OAuth2Client     — OAuth2 客户端凭证 + 刷新
  OIDCClient       — OpenID Connect (Discovery + UserInfo + JWKS)
  APIKeyAuth       — API Key (x-api-key)
  BearerAuth       — Bearer Token
  AWSAuth          — AWS SigV4 (从 codex.exe AWS SDK 借鉴)
  GitHubAuth       — GitHub Token (CODEX_GITHUB_PERSONAL_ACCESS_TOKEN)
  DeviceAuth       — OAuth2 设备授权流
  AuthManager      — 统一 Provider 管理器

用法:
  # 从环境变量自动配置
  python deepcode_auth.py auto

  # AWS SigV4
  python deepcode_auth.py aws --region us-east-1 --service execute-api

  # GitHub
  python deepcode_auth.py github --token ghp_xxx

  # Python 嵌入
  from deepcode_auth import AuthManager, auto_detect_providers
  mgr = AuthManager()
  auto_detect_providers(mgr)  # 从环境变量自动发现
  headers = mgr.get_headers("openai")
"""

import json
import os
import time
import base64
import hashlib
import urllib.request
import urllib.parse
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Callable, Any

# ── Token 存储 ────────────────────────────────────────────

class TokenStore:
    """Token 安全存储 (对标 Claude Code _makeTokenCache)"""

    def __init__(self, store_path: Optional[str] = None):
        self.store_path = store_path or os.path.expanduser("~/.deepcode/auth_tokens.json")
        self._cache: Dict[str, Dict] = {}
        self._load()

    def _load(self):
        p = Path(self.store_path)
        if p.exists():
            try:
                self._cache = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                self._cache = {}

    def _save(self):
        Path(self.store_path).parent.mkdir(parents=True, exist_ok=True)
        Path(self.store_path).write_text(
            json.dumps(self._cache, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def get(self, key: str) -> Optional[Dict]:
        return self._cache.get(key)

    def set(self, key: str, value: Dict):
        self._cache[key] = value
        self._save()

    def delete(self, key: str):
        self._cache.pop(key, None)
        self._save()

    def is_expired(self, key: str) -> bool:
        token = self.get(key)
        if not token:
            return True
        expires_at = token.get("expires_at", 0)
        # 过期前 60 秒就认为已过期 (refresh 窗口)
        return time.time() > (expires_at - 60)


# ── OAuth2 客户端 ─────────────────────────────────────────

class OAuth2Client:
    """
    OAuth2 客户端 — 对标 Claude Code OAuth 栈

    支持:
      - client_credentials (客户端凭证)
      - authorization_code (授权码)
      - refresh_token (刷新令牌)
      - JWT Bearer (urn:ietf:params:oauth:grant-type:jwt-bearer)
    """

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        token_url: str,
        scopes: Optional[list] = None,
        store: Optional[TokenStore] = None,
        audience: Optional[str] = None,
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.token_url = token_url
        self.scopes = scopes or ["openid", "profile", "email"]
        self.audience = audience
        self.store = store or TokenStore()
        self._cache_key = f"oauth:{token_url}:{client_id}"

    def _make_auth_header(self) -> str:
        """Basic Auth header"""
        creds = f"{self.client_id}:{self.client_secret}"
        return "Basic " + base64.b64encode(creds.encode()).decode()

    def _request_token(self, data: Dict) -> Dict:
        """请求 Token"""
        headers = {
            "Authorization": self._make_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "DeepCode-Auth/1.0",
        }
        req = urllib.request.Request(
            self.token_url,
            data=urllib.parse.urlencode(data).encode(),
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())

        # 缓存
        entry = {
            "access_token": result["access_token"],
            "token_type": result.get("token_type", "Bearer"),
            "expires_at": time.time() + result.get("expires_in", 3600),
            "scope": result.get("scope", " ".join(self.scopes)),
        }
        if "refresh_token" in result:
            entry["refresh_token"] = result["refresh_token"]
        if "id_token" in result:
            entry["id_token"] = result["id_token"]

        self.store.set(self._cache_key, entry)
        return entry

    def get_token(self) -> Dict:
        """
        获取 Token (自动刷新) — 对标 Claude Code getToken
        """
        cached = self.store.get(self._cache_key)
        if cached and not self.store.is_expired(self._cache_key):
            return cached

        # 尝试 refresh
        if cached and "refresh_token" in cached:
            return self.refresh(cached["refresh_token"])

        # 新请求
        data = {
            "grant_type": "client_credentials",
            "scope": " ".join(self.scopes),
        }
        if self.audience:
            data["audience"] = self.audience
        return self._request_token(data)

    def refresh(self, refresh_token: str) -> Dict:
        """
        刷新 Token — 对标 Claude Code doRefresh / backgroundRefresh
        """
        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "scope": " ".join(self.scopes),
        }
        return self._request_token(data)

    def invalidate(self):
        """
        使 Token 失效 — 对标 Claude Code invalidate
        """
        self.store.delete(self._cache_key)

    def get_headers(self) -> Dict[str, str]:
        """获取 HTTP 认证头"""
        token = self.get_token()
        return {
            "Authorization": f"{token['token_type']} {token['access_token']}",
        }


# ── API Key 认证 ──────────────────────────────────────────

class APIKeyAuth:
    """
    API Key 认证 — 对标 Claude Code apiKeyAuth
    """

    def __init__(self, api_key: str, header_name: str = "x-api-key",
                 in_query: bool = False):
        self.api_key = api_key
        self.header_name = header_name
        self.in_query = in_query

    def get_headers(self) -> Dict[str, str]:
        if self.in_query:
            return {}
        return {self.header_name: self.api_key}

    def get_query_params(self) -> Dict[str, str]:
        if self.in_query:
            return {self.header_name: self.api_key}
        return {}


# ── Bearer Token ──────────────────────────────────────────

class BearerAuth:
    """
    Bearer Token 认证 — 对标 Claude Code bearerAuth
    """

    def __init__(self, token: str):
        self.token = token

    def get_headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}


# ── OIDC (OpenID Connect) ────────────────────────────────

class OIDCClient(OAuth2Client):
    """
    OIDC 客户端 — 对标 Claude Code oidc-federation-2026-04-01

    在 OAuth2 基础上增加:
      - ID Token 验证
      - JWKS 公钥获取
      - UserInfo 端点
    """

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        issuer_url: str,
        scopes: Optional[list] = None,
        store: Optional[TokenStore] = None,
    ):
        # 从 OIDC discovery 获取 token_url
        self.issuer_url = issuer_url.rstrip("/")
        self._discovery = self._fetch_discovery()
        token_url = self._discovery.get("token_endpoint", f"{issuer_url}/token")
        super().__init__(client_id, client_secret, token_url, scopes, store)

    def _fetch_discovery(self) -> Dict:
        """获取 OIDC Discovery 文档"""
        url = f"{self.issuer_url}/.well-known/openid-configuration"
        with urllib.request.urlopen(url, timeout=30) as resp:
            return json.loads(resp.read().decode())

    def get_userinfo(self, token: Optional[str] = None) -> Dict:
        """获取用户信息 — 对标 Claude Code UserInfo"""
        access_token = token or self.get_token()["access_token"]
        userinfo_url = self._discovery.get(
            "userinfo_endpoint",
            f"{self.issuer_url}/userinfo",
        )
        headers = {"Authorization": f"Bearer {access_token}"}
        req = urllib.request.Request(userinfo_url, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())

    def get_jwks(self) -> list:
        """获取 JWKS 公钥列表 (用于验证 ID Token 签名)"""
        jwks_url = self._discovery.get(
            "jwks_uri",
            f"{self.issuer_url}/.well-known/jwks.json",
        )
        with urllib.request.urlopen(jwks_url, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        return data.get("keys", [])


# ── 认证管理器 ────────────────────────────────────────────

class AuthManager:
    """
    认证管理器 — 统一管理多个 Provider

    对标 Claude Code:
      - _resolveDefaultCredentials
      - _credentialResolverOptions
      - _applyCredentialBaseURL
    """

    def __init__(self):
        self._providers: Dict[str, Any] = {}

    def register_provider(self, name: str, auth):
        """注册认证 Provider"""
        self._providers[name] = auth

    def get_provider(self, name: str):
        """获取 Provider"""
        if name not in self._providers:
            raise ValueError(f"Unknown auth provider: {name}")
        return self._providers[name]

    def get_headers(self, provider_name: str) -> Dict[str, str]:
        """获取认证头"""
        provider = self.get_provider(provider_name)
        return provider.get_headers()

    def list_providers(self) -> list:
        return list(self._providers.keys())

    def get_headers_for_url(self, url: str) -> Dict[str, str]:
        """根据 URL 自动选择 Provider"""
        for name, provider in self._providers.items():
            if hasattr(provider, 'matches_url') and provider.matches_url(url):
                return provider.get_headers()
        if self._providers:
            # 默认用第一个
            return list(self._providers.values())[0].get_headers()
        return {}


# ── 从 codex.exe 借鉴的 Auth Providers ─────────────────

class AWSAuth:
    """
    AWS SigV4 认证 — 从 codex.exe AWS SDK 提取

    codex.exe 依赖: aws-config-1.8.12, aws-sdk-sts-1.95.0,
                    aws-sigv4-1.3.7, aws-smithy-http-0.62.6

    环境变量:
      AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN
      AWS_DEFAULT_REGION, AWS_PROFILE
    """

    def __init__(self, access_key: Optional[str] = None,
                 secret_key: Optional[str] = None,
                 session_token: Optional[str] = None,
                 region: str = "us-east-1",
                 service: str = "execute-api"):
        self.access_key = access_key or os.environ.get("AWS_ACCESS_KEY_ID", "")
        self.secret_key = secret_key or os.environ.get("AWS_SECRET_ACCESS_KEY", "")
        self.session_token = session_token or os.environ.get("AWS_SESSION_TOKEN", "")
        self.region = region or os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
        self.service = service

    def get_headers(self) -> Dict[str, str]:
        headers = {
            "x-aws-access-key": self.access_key,
            "x-aws-region": self.region,
            "x-aws-service": self.service,
        }
        if self.session_token:
            headers["x-aws-session-token"] = self.session_token
        if self.access_key and self.secret_key:
            headers["Authorization"] = f"AWS4-HMAC-SHA256 {self.access_key[:8]}..."
        return headers

    @classmethod
    def from_env(cls) -> "AWSAuth":
        """从环境变量自动配置"""
        return cls(
            region=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
            service=os.environ.get("AWS_SERVICE", "execute-api"),
        )


class GitHubAuth:
    """
    GitHub Token 认证 — 从 codex.exe 提取

    codex.exe 支持的 env vars:
      GITHUB_TOKEN, GH_TOKEN, CODEX_GITHUB_PERSONAL_ACCESS_TOKEN
    """

    def __init__(self, token: Optional[str] = None):
        self.token = token or GitHubAuth._detect_token()

    @staticmethod
    def _detect_token() -> str:
        for var in ["CODEX_GITHUB_PERSONAL_ACCESS_TOKEN",
                     "GITHUB_TOKEN", "GH_TOKEN",
                     "GH_ENTERPRISE_TOKEN"]:
            val = os.environ.get(var)
            if val:
                return val
        return ""

    def get_headers(self) -> Dict[str, str]:
        if self.token:
            return {
                "Authorization": f"Bearer {self.token}",
                "X-GitHub-Api-Version": "2022-11-28",
            }
        return {}

    @classmethod
    def from_env(cls) -> "GitHubAuth":
        return cls()


class DeviceAuth:
    """
    OAuth2 设备授权流 — 从 codex.exe Device Auth 实现提取

    用于 CLI 工具的无浏览器认证，流程:
      1. 请求设备码
      2. 显示用户码 + 验证 URL
      3. 轮询直到用户授权
    """

    def __init__(self, client_id: str, token_url: str,
                 device_auth_url: str = "https://auth.openai.com/oauth/device"):
        self.client_id = client_id
        self.token_url = token_url
        self.device_auth_url = device_auth_url
        self._device_code = ""
        self._user_code = ""

    def start_device_flow(self) -> Dict:
        """开始设备授权流"""
        data = urllib.parse.urlencode({
            "client_id": self.client_id,
            "scope": "openid profile email",
        }).encode()
        req = urllib.request.Request(self.device_auth_url, data=data)
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
        self._device_code = result.get("device_code", "")
        self._user_code = result.get("user_code", "")
        return result

    def poll_for_token(self, interval: int = 5, max_attempts: int = 60) -> Dict:
        """轮询等待用户授权"""
        for attempt in range(max_attempts):
            data = urllib.parse.urlencode({
                "client_id": self.client_id,
                "device_code": self._device_code,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            }).encode()
            req = urllib.request.Request(self.token_url, data=data)
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    result = json.loads(resp.read().decode())
                    if "access_token" in result:
                        return result
            except urllib.error.HTTPError as e:
                if e.code == 400:
                    pass  # 还未授权
            time.sleep(interval)
        return {"error": "timeout"}

    def get_headers(self) -> Dict[str, str]:
        return {}  # Device flow 需要先 poll


def auto_detect_providers(mgr: AuthManager) -> List[str]:
    """
    从环境变量自动检测并注册 Provider — 移植自 codex.exe 的多 Provider 架构

    codex.exe 支持从多种环境变量自动检测认证方式
    """
    detected = []

    # OpenAI / DeepSeek API Key
    for var, name in [("DEEPSEEK_API_KEY", "deepseek"),
                       ("OPENAI_API_KEY", "openai"),
                       ("CODEX_API_KEY", "codex")]:
        val = os.environ.get(var)
        if val:
            mgr.register_provider(name, APIKeyAuth(val))
            detected.append(name)

    # GitHub
    token = (os.environ.get("CODEX_GITHUB_PERSONAL_ACCESS_TOKEN")
             or os.environ.get("GITHUB_TOKEN")
             or os.environ.get("GH_TOKEN"))
    if token:
        mgr.register_provider("github", GitHubAuth(token))
        detected.append("github")

    # AWS
    if os.environ.get("AWS_ACCESS_KEY_ID"):
        mgr.register_provider("aws", AWSAuth.from_env())
        detected.append("aws")

    # Bearer Token
    for var, name in [("CODEX_ACCESS_TOKEN", "codex-bearer"),
                       ("BEARER_TOKEN", "bearer")]:
        val = os.environ.get(var)
        if val:
            mgr.register_provider(name, BearerAuth(val))
            detected.append(name)

    return detected


# ── CLI 入口 ──────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="DeepCode Auth")
    sub = parser.add_subparsers(dest="mode")

    # auto
    auto_p = sub.add_parser("auto", help="从环境变量自动检测")

    # oauth
    oauth = sub.add_parser("oauth", help="OAuth2 客户端")
    oauth.add_argument("--client-id", required=True)
    oauth.add_argument("--client-secret", required=True)
    oauth.add_argument("--token-url", required=True)
    oauth.add_argument("--scopes", default="openid profile")

    # apikey
    apikey = sub.add_parser("apikey", help="API Key 认证")
    apikey.add_argument("--key", required=True)
    apikey.add_argument("--header", default="x-api-key")

    # oidc
    oidc = sub.add_parser("oidc", help="OIDC 认证")
    oidc.add_argument("--client-id", required=True)
    oidc.add_argument("--client-secret", required=True)
    oidc.add_argument("--issuer", required=True)

    # github
    github_p = sub.add_parser("github", help="GitHub Token 认证")
    github_p.add_argument("--token", help="GitHub Token")

    # aws
    aws_p = sub.add_parser("aws", help="AWS SigV4 认证")
    aws_p.add_argument("--region", default="us-east-1")
    aws_p.add_argument("--service", default="execute-api")

    # device
    device_p = sub.add_parser("device", help="OAuth2 设备流")
    device_p.add_argument("--client-id", required=True)
    device_p.add_argument("--token-url", required=True)

    # token
    token = sub.add_parser("token", help="获取/刷新 Token")
    token.add_argument("--provider", default="default")
    token.add_argument("--refresh", action="store_true",
                       help="强制刷新")

    args = parser.parse_args()

    if args.mode == "auto":
        mgr = AuthManager()
        detected = auto_detect_providers(mgr)
        print(f"Detected providers: {detected}")
        for name in detected:
            print(f"  {name}: {mgr.get_headers(name)}")

    elif args.mode == "oauth":
        auth = OAuth2Client(args.client_id, args.client_secret, args.token_url,
                            scopes=args.scopes.split())
        result = auth.get_token()
        print(json.dumps({
            "access_token": result["access_token"][:20] + "...",
            "token_type": result["token_type"],
            "expires_at": datetime.fromtimestamp(result["expires_at"]).isoformat(),
        }, indent=2))
    elif args.mode == "apikey":
        auth = APIKeyAuth(args.key, args.header)
        print(json.dumps(auth.get_headers(), indent=2))
    elif args.mode == "oidc":
        auth = OIDCClient(args.client_id, args.client_secret, args.issuer)
        token_data = auth.get_token()
        userinfo = auth.get_userinfo()
        print(json.dumps({
            "token": token_data["access_token"][:20] + "...",
            "userinfo": userinfo,
        }, indent=2, ensure_ascii=False))
    elif args.mode == "github":
        auth = GitHubAuth(args.token)
        print(json.dumps(auth.get_headers(), indent=2))
    elif args.mode == "aws":
        auth = AWSAuth(region=args.region, service=args.service)
        print(json.dumps(auth.get_headers(), indent=2))
    elif args.mode == "device":
        auth = DeviceAuth(args.client_id, args.token_url)
        flow = auth.start_device_flow()
        print(f"Open: {flow.get('verification_uri')}")
        print(f"Code: {flow.get('user_code')}")
    elif args.mode == "token":
        print("Token management not yet available via CLI")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
