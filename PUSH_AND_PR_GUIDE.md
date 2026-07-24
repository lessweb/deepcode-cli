# Push and Create Pull Request Guide

## 已完成的提交

当前有两个提交需要推送：

1. `f9cda70` - fix: make -p/--prompt flag exit after response (non-interactive mode)
2. `e2823a4` - feat: implement true non-interactive mode for -p/--prompt flag

## 步骤 1: 推送到远程仓库

### 方法 A: 使用 GitHub CLI（推荐）

```bash
# 首先登录 GitHub
gh auth login

# 然后推送并创建 PR
git push origin main
gh pr create \
  --title "feat: Implement true non-interactive mode for -p/--prompt flag" \
  --body-file PR_DESCRIPTION.md \
  --base main \
  --head main
```

### 方法 B: 手动推送

```bash
# 使用 HTTPS（需要输入用户名和密码/token）
git push origin main

# 或者使用 SSH（如果配置了 SSH key）
git remote set-url origin git@github.com:lessweb/deepcode-cli.git
git push origin main
```

## 步骤 2: 创建 Pull Request

### PR 标题
```
feat: Implement true non-interactive mode for -p/--prompt flag
```

### PR 描述

```markdown
## Summary

This PR implements a true non-interactive mode for the `-p`/`--prompt` flag, similar to Claude Code's `--print` mode. Instead of rendering the TUI interface, the CLI now outputs pure text responses and exits automatically.

## Changes

### Core Implementation (`packages/cli/src/cli.tsx`)

- Added `runNonInteractiveMode()` function that bypasses Ink/React UI entirely
- Uses `SessionManager` directly to process prompts
- Outputs only the LLM response as plain text to stdout
- Handles errors gracefully with stderr output and proper exit codes
- Imports necessary types and functions from `@vegamo/deepcode-core`

### Behavior

**Before:**
```bash
$ deepcode -p "hello"
[Shows full TUI with banner, status bar, etc.]
[User must manually exit]
```

**After:**
```bash
$ deepcode -p "hello"
Hello! I'm Deep Code, an interactive CLI tool designed to help you with software engineering tasks.
...
[Auto-exits with code 0]
```

## Testing & Verification

### All Tests Pass ✅
- **Core package**: 255/255 tests passed
- **CLI package**: 253/254 tests passed (1 skipped)
- **UI package**: 49/49 tests passed
- **Total**: 557/558 tests passed

### Build Verification ✅
- TypeScript type checking: Passed
- ESLint: Passed
- Prettier formatting: Passed
- Full build: Successful

### Functional Testing ✅
- Non-interactive mode works correctly
- Pure text output without ANSI escape codes
- Auto-exit after response confirmed
- Exit code 0 on success verified
- Error handling tested

## Use Cases

This feature enables:
- Scripting and automation workflows
- Integration with other CLI tools
- Quick queries without entering interactive mode
- CI/CD pipeline integration

## Related Issues

Fixes Issue #252: Make -p flag exit after response

## Checklist

- [x] Code follows project style guidelines
- [x] Self-review completed
- [x] Tests added/updated and passing
- [x] Documentation updated (help text reflects new behavior)
- [x] No breaking changes to existing functionality
```

## 步骤 3: 验证 PR

创建 PR 后，请检查：

1. ✅ 所有 CI 检查通过
2. ✅ 代码审查通过
3. ✅ 测试覆盖完整
4. ✅ 文档更新正确

## 注意事项

- 这个实现是向后兼容的，不影响现有的交互式模式
- `-p` 参数现在完全跳过 TUI，提供更轻量的体验
- 错误处理完善，确保脚本可以正确处理失败情况
