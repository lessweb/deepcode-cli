# DeepCode Server API

English · [中文](./server-api.md)

```bash
deepcode-server --port 8787
```

Token authentication is enabled by default. stdout prints a line similar to:

```text
deepcode server listening on http://127.0.0.1:8787 token=<token>
```

Pass the token with any of:

- `?token=<token>`
- `x-deepcode-token: <token>`
- `Authorization: Bearer <token>`

## Scope

The server exposes existing DeepCode runtime / CLI-TUI capabilities as HTTP APIs. For slash command meanings, see [README “Slash Commands & Keyboard Shortcuts”](../README-en.md#slash-commands--keyboard-shortcuts).
