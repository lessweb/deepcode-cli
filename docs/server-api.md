# DeepCode Server API

[English](./server-api_en.md) · 中文

```bash
deepcode-server --port 8787
```

默认开启 token 鉴权。stdout 会打印类似：

```text
deepcode server listening on http://127.0.0.1:8787 token=<token>
```

通过以下任一方式传递：

- `?token=<token>`
- `x-deepcode-token: <token>`
- `Authorization: Bearer <token>`

## 范围

Server 暴露现有 DeepCode runtime / CLI-TUI 已有能力作为 http api。斜杠命令含义参考 [README 的“斜杠命令与按键功能”](../README.md#斜杠命令与按键功能)。
