/**
 * pre-commit hook 脚本
 *
 * 在 git commit 前自动执行 lint-staged，对暂存区的文件进行：
 *   - ESLint 检查并自动修复（*.{ts,tsx,js,mjs,cjs,jsx}）
 *   - Prettier 格式化（*.{ts,tsx,js,mjs,cjs,jsx,json} 及 .prettierrc）
 *
 * 由 .husky/pre-commit 调用，lint-staged 失败时会阻止提交。
 */

import { execSync } from "node:child_process";
import lintStaged from "lint-staged";

try {
  // 获取 git 仓库根目录，作为 lint-staged 的工作目录
  const root = execSync("git rev-parse --show-toplevel").toString().trim();

  // 通过 lint-staged API 直接运行，仅处理暂存区文件
  const passed = await lintStaged({ cwd: root });

  // lint-staged 全部通过则正常退出，否则以失败码退出阻止提交
  process.exit(passed ? 0 : 1);
} catch {
  process.exit(1);
}
