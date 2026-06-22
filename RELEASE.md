# 版本发布

Deep Code 使用两个脚本管理 monorepo 的版本发布流程：

| 脚本 | 命令 | 用途 |
|------|------|------|
| `scripts/version.js` | `npm run release:version` | 升级所有 workspace 包的版本号 + 重新生成 lockfile |
| `scripts/prepare-package.js` | `npm run prepare:package` | 构建 + 质量检查 + 发布到 npm + git commit & tag |

两者配合使用，先升版本号，再发布。

---

## release:version — 版本号升级

用法与 `npm version` 一致，支持所有标准 bump 类型。

### 基本用法

```bash
npm run release:version -- <bump-type | version> [options]
```

> 注意：npm scripts 传参需要 `--` 分隔符。

### 支持的 bump 类型

| 类型 | 当前版本 | 结果 | 说明 |
|------|---------|------|------|
| `patch` | `0.1.31` | `0.1.32` | 补丁版本 +1 |
| `minor` | `0.1.31` | `0.2.0` | 次版本 +1，patch 归零 |
| `major` | `0.1.31` | `1.0.0` | 主版本 +1，minor/patch 归零 |
| `prepatch` | `0.1.31` | `0.1.32-0` | 预发布补丁 |
| `preminor` | `0.1.31` | `0.2.0-0` | 预发布次版本 |
| `premajor` | `0.1.31` | `1.0.0-0` | 预发布主版本 |
| `prerelease` | `0.1.31` | `0.1.32-0` | 递增预发布号 |
| `from-git` | — | 从最新 git tag 读取 | 适用于已有 tag 但未更新 package.json 的情况 |

也可以直接指定版本号：

```bash
npm run release:version -- 0.2.0
```

### 预发布链

`prerelease` 支持链式递增：

```
0.1.31
  → prerelease → 0.1.32-beta.0
  → prerelease → 0.1.32-beta.1
  → prerelease → 0.1.32-beta.2
  → patch      → 0.1.32        （去掉 prerelease 后缀）
```

### --preid 选项

预发布标识符，默认为 `"0"`，可自定义：

```bash
npm run release:version -- prerelease --preid beta
# 0.1.31 → 0.1.32-beta.0

npm run release:version -- premajor --preid alpha
# 0.1.31 → 1.0.0-alpha.0
```

### 实际执行的操作

1. 读取 `packages/core/package.json` 中的当前版本
2. 根据 bump 类型计算目标版本
3. 更新 **所有** `packages/*/package.json` 的 `version` 字段（core、cli、vscode-ide-companion）
4. 删除旧的 `package-lock.json`，执行 `npm install --package-lock-only` 重新生成

### 完整示例

```bash
# 升级 patch 版本
npm run release:version -- patch

# 升级 minor 版本
npm run release:version -- minor

# 发布 beta 预发布版
npm run release:version -- prerelease --preid beta

# 直接指定版本
npm run release:version -- 0.2.0

# 从 git tag 获取版本
npm run release:version -- from-git
```

升级后检查变更，确认无误后提交：

```bash
git diff
git add -A
git commit -m "chore(release): v0.1.32"
git tag v0.1.32
```

---

## prepare:package — 构建并发布到 npm

完成质量检查、构建、发布两个 npm 包，并自动创建 git commit 和 tag。

### 基本用法

```bash
npm run prepare:package -- <version> [options]
```

### 参数

| 参数 | 说明 |
|------|------|
| `<version>` | **必填**，要发布的 semver 版本号 |
| `--tag <dist-tag>` | npm dist-tag，默认 `"latest`"，常用于 `beta`、`next` |
| `--dry-run` | 预演模式，不实际执行任何写操作 |
| `--force` | 跳过 main 分支检查，允许从其他分支发布 |

### 执行流程（9 步）

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | Git 检查 | 工作区必须 clean，必须在 main 分支（`--force` 可跳过分支检查） |
| 2 | npm 认证 | 检查 `npm whoami`，未登录则中止 |
| 3 | 更新版本号 | 同时更新 `packages/core` 和 `packages/cli` 的 version |
| 4 | 质量检查 | `npm run check`（typecheck + eslint + prettier） |
| 5 | 测试 | `npm run test --workspaces` |
| 6 | 构建 | `npm run build`（core tsc + cli esbuild bundle） |
| 7 | 发布 core | `npm publish --workspace=@vegamo/deepcode-core --access public` |
| 8 | 发布 cli | 将 cli 的 `@vegamo/deepcode-core` 依赖从 `file:../core` 临时改为 `^<version>`，发布后恢复 |
| 9 | Git commit & tag | `chore(release): v<version>` + `git tag v<version>` |

### 完整示例

```bash
# 发布正式版
npm run prepare:package -- 0.1.32

# 发布 beta 版
npm run prepare:package -- 0.1.32-beta.1 --tag beta

# 预演（不实际发布，用于检查流程）
npm run prepare:package -- 0.1.32 --dry-run

# 从非 main 分支发布
npm run prepare:package -- 0.1.32 --force
```

### 关于 file:../core 依赖

CLI 包的 `@vegamo/deepcode-core` 依赖在开发时使用 `"file:../core"`（monorepo 本地链接）。发布到 npm 时，脚本会自动将其替换为 `"^<version>"`，发布完成后恢复为 `file:../core`。这个过程对用户透明，无需手动处理。

### 发布后

脚本完成后会提示手动推送到 remote：

```bash
git push && git push --tags
```

验证发布结果：

```bash
npm view @vegamo/deepcode-cli version
npx @vegamo/deepcode-cli --version
```

---

## 典型发布流程

一个完整的版本发布通常按以下步骤进行：

```bash
# 1. 确保工作区干净
git status

# 2. 升级版本号
npm run release:version -- patch

# 3. 检查变更
git diff

# 4. 提交版本变更
git add -A
git commit -m "chore(release): v0.1.32"

# 5. 构建 + 质量检查 + 发布
npm run prepare:package -- 0.1.32

# 6. 推送到 remote
git push && git push --tags
```

也可以简化为两步（`prepare:package` 会自动 commit 和 tag）：

```bash
npm run release:version -- patch
npm run prepare:package -- 0.1.32
git push && git push --tags
```

---

## 预发布版本流程

```bash
# 第一个 beta
npm run release:version -- prerelease --preid beta
# → 0.1.32-beta.0

git add -A && git commit -m "chore(release): v0.1.32-beta.0"
npm run prepare:package -- 0.1.32-beta.0 --tag beta

# 后续 beta
npm run release:version -- prerelease --preid beta
# → 0.1.32-beta.1

git add -A && git commit -m "chore(release): v0.1.32-beta.1"
npm run prepare:package -- 0.1.32-beta.1 --tag beta

# 正式发布
npm run release:version -- patch
# → 0.1.32

git add -A && git commit -m "chore(release): v0.1.32"
npm run prepare:package -- 0.1.32
git push && git push --tags
```
