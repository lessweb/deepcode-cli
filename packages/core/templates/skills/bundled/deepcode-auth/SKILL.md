---
name: deepcode-auth
description: >
  DeepCode Auth — 移植自 Claude Code v2.1.216 OAuth2/OIDC 认证栈。
  支持 OAuth2 客户端模式、OIDC (OpenID Connect)、API Key、Bearer Token。
  对标 Claude Code 的 getToken/refresh/invalidate/authHeaders 等。
version: 1.0.0
author: DeepCode + Ghidra RE (Claude Code v2.1.216)
date: 2026-07-26
tags: [auth, oauth, oidc, security, enterprise]
---

# DeepCode Auth

移植自 **Claude Code v2.1.216** 的完整认证栈:
- OAuth2 (client_credentials / refresh_token / jwt-bearer)
- OIDC (OpenID Connect + Discovery + UserInfo + JWKS)
- API Key / Bearer Token

## 支持的认证方式

| 方式 | 类 | 对标 Claude Code |
|:---|:---|:----------------|
| OAuth2 客户端凭证 | `OAuth2Client` | `getToken` / `doRefresh` |
| OIDC (OpenID Connect) | `OIDCClient` | `oidc-federation-2026-04-01` |
| API Key | `APIKeyAuth` | `apiKeyAuth` |
| Bearer Token | `BearerAuth` | `bearerAuth` |
| 统一管理器 | `AuthManager` | `_resolveDefaultCredentials` |

## 用法

```python
from deepcode_auth import (
    OAuth2Client, OIDCClient, APIKeyAuth,
    BearerAuth, AuthManager
)

# OAuth2
oauth = OAuth2Client(
    client_id="myapp",
    client_secret="secret",
    token_url="https://auth.example.com/token",
    scopes=["openid", "api:read"],
)
headers = oauth.get_headers()
# → {"Authorization": "Bearer eyJ..."}

# API Key
auth = APIKeyAuth("sk-xxx")
headers = auth.get_headers()
# → {"x-api-key": "sk-xxx"}

# 统一管理器
mgr = AuthManager()
mgr.register_provider("deepseek", APIKeyAuth("sk-xxx"))
mgr.register_provider("github", OAuth2Client(...))
headers = mgr.get_headers("deepseek")
```

## Token 存储

Token 自动缓存到 `~/.deepcode/auth_tokens.json`，过期前 60 秒自动刷新。

## CLI

```bash
# OAuth2
python deepcode_auth.py oauth --client-id x --client-secret y --token-url https://...

# API Key
python deepcode_auth.py apikey --key sk-xxx

# OIDC
python deepcode_auth.py oidc --client-id x --client-secret y --issuer https://accounts.example.com
```
