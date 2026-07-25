#!/usr/bin/env node
/**
 * patch-dist.mjs
 *
 * 在 `npm update -g @vegamo/deepcode-cli` 之后重新注入运行时压缩补丁。
 *
 * 用法：
 *   node patch-dist.mjs                    # 自动定位全局安装路径
 *   node patch-dist.mjs /custom/path/cli.js # 手动指定路径
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const COMPRESS_CONTENT_SNIPPET = `
  /** Runtime compression — truncates large output, keeps JSON structure. */
  static _compressContent(content, maxLength = 1e4) {
    if (content.length <= maxLength) return content;
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.output === "string" && parsed.output.length > maxLength / 2) {
        const suffix = \`\\n\\n... (truncated, original \${parsed.output.length} chars)\`;
        const avail = maxLength - suffix.length;
        const truncated = avail <= 0 ? parsed.output.slice(0, maxLength) : parsed.output.slice(0, avail) + suffix;
        const compacted = { ...parsed, output: truncated };
        const result = JSON.stringify(compacted, null, 2);
        if (result.length < content.length) return result;
      }
    } catch {}
    const suffix = \`\\n\\n... (truncated, original \${content.length} chars)\`;
    const avail = maxLength - suffix.length;
    return avail <= 0 ? content.slice(0, maxLength) : content.slice(0, avail) + suffix;
  }
`;

const COMPRESS_MESSAGE_SNIPPET = `
  /** Compress message content before writing JSONL (tool results already compressed by executor). */
  _compressMessageContent(message) {
    const content = message.content;
    if (!content || content.length <= 1e4) return message;
    const suffix = \`\\n\\n... (truncated, original \${content.length} chars)\`;
    const maxLen = 1e4;
    const avail = maxLen - suffix.length;
    const truncated = avail <= 0 ? content.slice(0, maxLen) : content.slice(0, avail) + suffix;
    return { ...message, content: truncated };
  }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findGlobalCliJs() {
  // Common locations by priority
  const candidates = [
    // npm global root + our package
    ...getNpmGlobalCandidates(),
    // Direct common paths
    "/usr/local/lib/node_modules/@vegamo/deepcode-cli/dist/cli.js",
    "/usr/lib/node_modules/@vegamo/deepcode-cli/dist/cli.js",
    // Homebrew / nvm style
    ...getHomeCandidates(),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function getNpmGlobalCandidates() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const paths = [];
  // Windows
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || resolve(home, "AppData", "Roaming");
    paths.push(resolve(appData, "npm", "node_modules", "@vegamo", "deepcode-cli", "dist", "cli.js"));
  }
  // Unix
  paths.push(resolve("/usr/local/lib/node_modules/@vegamo/deepcode-cli/dist/cli.js"));
  paths.push(resolve("/usr/lib/node_modules/@vegamo/deepcode-cli/dist/cli.js"));
  // npm root -g
  try {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    if (root) {
      paths.push(resolve(root, "@vegamo", "deepcode-cli", "dist", "cli.js"));
    }
  } catch {
    // ignore
  }
  return paths;
}

function getHomeCandidates() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return [
    resolve(home, ".nvm", "versions", "node", "current", "lib", "node_modules", "@vegamo", "deepcode-cli", "dist", "cli.js"),
    resolve(home, ".local", "share", "fnm", "node-versions", "current", "lib", "node_modules", "@vegamo", "deepcode-cli", "dist", "cli.js"),
  ];
}

// ---------------------------------------------------------------------------
// Patch logic
// ---------------------------------------------------------------------------

const MARK_BEGIN = "// === PATCH: compressContent (deepcode runtime compression) ===";
const MARK_END   = "// === END PATCH ===";

function alreadyPatched(code) {
  return code.includes(MARK_BEGIN);
}

/**
 * Patch 1: Inject _compressContent static method into the ToolExecutor class,
 *          and wrap the return of formatToolResult.
 */
function patchFormatToolResult(code) {
  // 1. Inject static method right before formatToolResult
  const fmtTarget = "  formatToolResult(result) {";
  const insertPos = code.lastIndexOf(fmtTarget, code.lastIndexOf("formatToolResult"));
  if (insertPos === -1) {
    console.error("  x Cannot locate `formatToolResult` method");
    return null;
  }

  const before = code.slice(0, insertPos);
  const after  = code.slice(insertPos);
  code = before + `\n${MARK_BEGIN}${COMPRESS_CONTENT_SNIPPET}\n${MARK_END}\n` + after;

  // 2. Replace `return JSON.stringify(payload, null, 2);` inside formatToolResult
  const retTarget = "    return JSON.stringify(payload, null, 2);";
  // Only replace the last occurrence (inside the ToolExecutor class, not elsewhere)
  const lastRetPos = code.lastIndexOf(retTarget);
  if (lastRetPos === -1) {
    console.error("  x Cannot locate `return JSON.stringify(payload, null, 2)`");
    return null;
  }
  code = code.slice(0, lastRetPos) +
    "    return ToolExecutor._compressContent(JSON.stringify(payload, null, 2));" +
    code.slice(lastRetPos + retTarget.length);

  return code;
}

/**
 * Detect the bundled fs variable name by scanning for
 * `<var>.appendFileSync(messagePath` near getSessionMessagesPath calls.
 * This avoids hardcoding bundle-internal names (e.g. fs17, fs, fs2, ...).
 */
function detectFsVar(code) {
  const re = /(\w+)\.(?:appendFileSync|writeFileSync)\(messagePath/g;
  for (const m of code.matchAll(re)) {
    if (m[1] !== "JSON") return m[1];
  }
  return null;
}

/**
 * Rewrite a method body to inject `_compressMessageContent` wrapping.
 */
function rewriteMethodBody(code, methodName, fsVar) {
  const methodRe = new RegExp(
    `(  ${methodName}\\(sessionId,\\s*\\w+\\s*\\)\\s*\\{)`,
    "m"
  );
  const match = methodRe.exec(code);
  if (!match) {
    console.error(`  x Cannot locate \`${methodName}\``);
    return null;
  }

  // Find matching closing brace (2-space indent)
  let depth = 0;
  let closeAt = -1;
  for (let i = match.index; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") { depth--; if (depth === 0) { closeAt = i; break; } }
  }
  if (closeAt === -1) {
    console.error(`  x Cannot parse \`${methodName}\` body (unbalanced braces)`);
    return null;
  }

  const body = code.slice(match.index, closeAt + 1);

  // Try appendFileSync pattern first
  const appendRe = new RegExp(
    `${fsVar}\\.appendFileSync\\(messagePath,\\s*(\\S[^;]+)\\)`,
    "m"
  );
  const appendMatch = appendRe.exec(body);
  if (appendMatch) {
    const msgVar = appendMatch[1].match(/JSON\.stringify\((\w+)\)/)?.[1];
    if (msgVar) {
      const oldLine = appendMatch[0];
      const newLine = `const compressed = this._compressMessageContent(${msgVar});\n    ${fsVar}.appendFileSync(messagePath, \`\${JSON.stringify(compressed)}\\n\`, "utf8")`;
      return code.slice(0, match.index) + body.replace(oldLine, newLine) + code.slice(closeAt + 1);
    }
  }

  // Try writeFileSync pattern (saveSessionMessages)
  const writeRe = new RegExp(
    `${fsVar}\\.writeFileSync\\(messagePath,.*messages\\.map\\(`,
    "m"
  );
  const writeMatch = writeRe.exec(body);
  if (writeMatch) {
    const newBody = body.replace(
      /messages\.map\(\((\w+)\)\s*=>\s*JSON\.stringify\(\1\)\)/,
      "messages.map(($1) => JSON.stringify(this._compressMessageContent($1)))"
    );
    return code.slice(0, match.index) + newBody + code.slice(closeAt + 1);
  }

  console.error(`  x Cannot find fs call in \`${methodName}\` body`);
  return null;
}

/**
 * Patch 2: Inject _compressMessageContent and wrap appendSessionMessage / saveSessionMessages.
 */
function patchPersistence(code) {
  const fsVar = detectFsVar(code);
  if (!fsVar) {
    console.error("  x Cannot detect bundled fs variable name");
    return null;
  }
  console.log(`  i Detected fs variable: \`${fsVar}\``);

  const appendTarget = "  appendSessionMessage(sessionId, message) {";
  const appendPos   = code.indexOf(appendTarget);
  if (appendPos === -1) {
    console.error("  x Cannot locate `appendSessionMessage`");
    return null;
  }

  // Insert _compressMessageContent helper right before appendSessionMessage
  const before = code.slice(0, appendPos);
  const after  = code.slice(appendPos);
  code = before + `\n${MARK_BEGIN}${COMPRESS_MESSAGE_SNIPPET}\n${MARK_END}\n` + after;

  // Rewrite appendSessionMessage body
  code = rewriteMethodBody(code, "appendSessionMessage", fsVar);
  if (!code) return null;

  // Rewrite saveSessionMessages body
  code = rewriteMethodBody(code, "saveSessionMessages", fsVar);
  return code;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  let cliPath = process.argv[2];

  if (!cliPath) {
    cliPath = findGlobalCliJs();
    if (!cliPath) {
      console.error("x Cannot auto-detect deepcode CLI path.");
      console.error("  Usage: node patch-dist.mjs [/path/to/cli.js]");
      process.exit(1);
    }
  }

  if (!existsSync(cliPath)) {
    console.error(`x File not found: ${cliPath}`);
    process.exit(1);
  }

  let code = readFileSync(cliPath, "utf8");

  if (alreadyPatched(code)) {
    console.log("Already patched — nothing to do.");
    process.exit(0);
  }

  console.log(`Patching ${cliPath} ...`);

  code = patchFormatToolResult(code);
  if (!code) process.exit(1);

  code = patchPersistence(code);
  if (!code) process.exit(1);

  writeFileSync(cliPath, code, "utf8");
  console.log("Done. Restart Deep Code for changes to take effect.");
}

main();
