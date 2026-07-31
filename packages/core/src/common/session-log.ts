/**
 * SQLite 会话日志模块
 * 借鉴 OpenAI Codex CLI 的 SQLite 结构化持久化设计
 *
 * 用 SQLite 替代文件系统散乱存储，支持：
 * - 结构化 JSON 日志查询（json_extract）
 * - Token 预算审计
 * - 权限审批记录
 * - 自动清理过期数据
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// sql.js 是纯 WASM 实现，无需本地编译

type SqlJsModule = { Database: new (data?: ArrayLike<number> | Buffer | null) => import("sql.js").Database };
let SQL: SqlJsModule | null = null;

// 数据库实例缓存（按会话 ID）
const dbCache = new Map<string, DatabaseHandle>();

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type SqlJsDatabase = import("sql.js").Database;

interface DatabaseHandle {
  db: SqlJsDatabase;
  path: string;
  save: () => void;
}

// ─── 表结构 ───────────────────────────────────────────────

const SCHEMA_SESSION_LOGS = `
CREATE TABLE IF NOT EXISTS session_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL,       -- 'agentMessage' | 'toolCall' | 'permission' | 'system'
  item_json TEXT NOT NULL   -- 结构化 JSON 数据
);
CREATE INDEX IF NOT EXISTS idx_logs_session ON session_logs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_logs_type ON session_logs(session_id, type);
`;

const SCHEMA_TOKEN_BUDGET = `
CREATE TABLE IF NOT EXISTS token_budget (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  turn_tokens INTEGER NOT NULL,
  total_used INTEGER NOT NULL,
  budget_max INTEGER NOT NULL,
  remaining AS (budget_max - total_used) STORED
);
CREATE INDEX IF NOT EXISTS idx_token_session ON token_budget(session_id, created_at);
`;

const SCHEMA_PERMISSION_AUDIT = `
CREATE TABLE IF NOT EXISTS permission_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  scopes TEXT NOT NULL,      -- JSON array of scopes
  decision TEXT NOT NULL,    -- 'allow' | 'deny' | 'ask'
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_perm_session ON permission_audit(session_id, created_at);
`;

const SCHEMA_CHECKPOINTS = `
CREATE TABLE IF NOT EXISTS checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  label TEXT,
  snapshot_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cp_session ON checkpoints(session_id, created_at DESC);
`;

const ALL_SCHEMAS = [SCHEMA_SESSION_LOGS, SCHEMA_TOKEN_BUDGET, SCHEMA_PERMISSION_AUDIT, SCHEMA_CHECKPOINTS];

// ─── 数据库管理 ───────────────────────────────────────────

function getDbPath(sessionId: string): string {
  const baseDir = process.env.DEEPCODE_DATA_DIR || path.join(os.homedir(), ".deepcode", "data");
  fs.mkdirSync(baseDir, { recursive: true });
  return path.join(baseDir, `session_${sessionId}.db`);
}

async function ensureSqlJs(): Promise<void> {
  if (!SQL) {
    const sqlJsModule = await import("sql.js");
    const initSqlJs = sqlJsModule.default;
    SQL = (await initSqlJs()) as unknown as SqlJsModule;
  }
}

async function getDb(sessionId: string): Promise<DatabaseHandle> {
  const cached = dbCache.get(sessionId);
  if (cached) return cached;

  await ensureSqlJs();
  if (!SQL) {
    throw new Error("SQLite initialization failed");
  }

  const dbPath = getDbPath(sessionId);
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let db: import("sql.js").Database;

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // 初始化表结构
  for (const schema of ALL_SCHEMAS) {
    db.run(schema);
  }
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA synchronous=NORMAL");

  const handle: DatabaseHandle = {
    db,
    path: dbPath,
    save: () => {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    },
  };

  dbCache.set(sessionId, handle);
  return handle;
}

/** 定期持久化 + 清理旧数据 */
let saveInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoSave(intervalMs = 30000): void {
  if (saveInterval) return;
  saveInterval = setInterval(() => {
    for (const [sessionId, handle] of dbCache.entries()) {
      try {
        handle.save();
        // 清理 7 天前的日志
        handle.db.run("DELETE FROM session_logs WHERE created_at < datetime('now', '-7 days')");
      } catch (err) {
        console.error(`[session-log] Auto-save failed for ${sessionId}:`, err);
      }
    }
  }, intervalMs);
}

// ─── 日志写入 ─────────────────────────────────────────────

/** 写入一条 agent 消息日志 */
export async function logAgentMessage(sessionId: string, message: Record<string, unknown>): Promise<void> {
  const handle = await getDb(sessionId);
  handle.db.run("INSERT INTO session_logs (session_id, type, item_json) VALUES (?, 'agentMessage', ?)", [
    sessionId,
    JSON.stringify(message),
  ]);
}

/** 写入一条 tool call 日志 */
export async function logToolCall(sessionId: string, toolCall: Record<string, unknown>): Promise<void> {
  const handle = await getDb(sessionId);
  handle.db.run("INSERT INTO session_logs (session_id, type, item_json) VALUES (?, 'toolCall', ?)", [
    sessionId,
    JSON.stringify(toolCall),
  ]);
}

/** 写入权限审批记录 */
export async function logPermissionDecision(
  sessionId: string,
  toolCallId: string,
  toolName: string,
  scopes: string[],
  decision: "allow" | "deny" | "ask",
  reason?: string
): Promise<void> {
  const handle = await getDb(sessionId);
  handle.db.run(
    `INSERT INTO permission_audit (session_id, tool_call_id, tool_name, scopes, decision, reason)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, toolCallId, toolName, JSON.stringify(scopes), decision, reason ?? null]
  );
}

/** 记录 Token 消耗 */
export async function logTokenUsage(
  sessionId: string,
  turnTokens: number,
  totalUsed: number,
  budgetMax: number
): Promise<void> {
  const handle = await getDb(sessionId);
  handle.db.run(
    `INSERT INTO token_budget (session_id, turn_tokens, total_used, budget_max)
     VALUES (?, ?, ?, ?)`,
    [sessionId, turnTokens, totalUsed, budgetMax]
  );
}

/** 保存检查点快照 */
export async function saveCheckpoint(
  sessionId: string,
  snapshot: Record<string, unknown>,
  label?: string
): Promise<number> {
  const handle = await getDb(sessionId);
  handle.db.run("INSERT INTO checkpoints (session_id, label, snapshot_json) VALUES (?, ?, ?)", [
    sessionId,
    label ?? null,
    JSON.stringify(snapshot),
  ]);
  return (handle.db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] as number) ?? 0;
}

// ─── 日志查询 ─────────────────────────────────────────────

/** 查询最新的 N 条日志 */
export async function queryRecentLogs(
  sessionId: string,
  limit = 50,
  type?: string
): Promise<Array<{ id: number; created_at: string; type: string; data: unknown }>> {
  const handle = await getDb(sessionId);
  let sql = "SELECT id, created_at, type, item_json FROM session_logs WHERE session_id = ?";
  const params: unknown[] = [sessionId];

  if (type) {
    sql += " AND type = ?";
    params.push(type);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const results = handle.db.exec(sql, params);
  if (results.length === 0) return [];

  return results[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
    created_at: row[1] as string,
    type: row[2] as string,
    data: JSON.parse(row[3] as string),
  }));
}

/** 使用 json_extract 查询特定字段 */
export async function queryLogsByJsonPath(
  sessionId: string,
  jsonPath: string,
  expectedValue: string,
  limit = 50
): Promise<Array<{ id: number; created_at: string; type: string; data: unknown }>> {
  const handle = await getDb(sessionId);
  const sql = `
    SELECT id, created_at, type, item_json
    FROM session_logs
    WHERE session_id = ?
      AND json_extract(item_json, ?) = ?
    ORDER BY created_at DESC
    LIMIT ?
  `;
  const results = handle.db.exec(sql, [sessionId, jsonPath, expectedValue, limit]);
  if (results.length === 0) return [];

  return results[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
    created_at: row[1] as string,
    type: row[2] as string,
    data: JSON.parse(row[3] as string),
  }));
}

/** 查询 Token 使用统计 */
export async function queryTokenStats(
  sessionId: string
): Promise<{ totalTokens: number; maxBudget: number; remainingBudget: number } | null> {
  const handle = await getDb(sessionId);
  const results = handle.db.exec(
    `SELECT total_used, budget_max FROM token_budget
     WHERE session_id = ?
     ORDER BY created_at DESC LIMIT 1`,
    [sessionId]
  );
  if (results.length === 0 || results[0].values.length === 0) return null;

  const [totalUsed, budgetMax] = results[0].values[0] as [number, number];
  return {
    totalTokens: totalUsed,
    maxBudget: budgetMax,
    remainingBudget: Math.max(0, budgetMax - totalUsed),
  };
}

/** 查询权限审批历史 */
export async function queryPermissionHistory(
  sessionId: string,
  limit = 100
): Promise<
  Array<{
    id: number;
    created_at: string;
    tool_name: string;
    scopes: string[];
    decision: string;
  }>
> {
  const handle = await getDb(sessionId);
  const results = handle.db.exec(
    `SELECT id, created_at, tool_name, scopes, decision
     FROM permission_audit
     WHERE session_id = ?
     ORDER BY created_at DESC LIMIT ?`,
    [sessionId, limit]
  );
  if (results.length === 0) return [];

  return results[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
    created_at: row[1] as string,
    tool_name: row[2] as string,
    scopes: JSON.parse(row[3] as string),
    decision: row[4] as string,
  }));
}

// ─── 生命周期管理 ─────────────────────────────────────────

/** 关闭数据库并持久化 */
export async function closeSession(sessionId: string): Promise<void> {
  const handle = dbCache.get(sessionId);
  if (!handle) return;
  handle.save();
  handle.db.close();
  dbCache.delete(sessionId);
}

/** 删除会话数据 */
export async function deleteSession(sessionId: string): Promise<void> {
  await closeSession(sessionId);
  const dbPath = getDbPath(sessionId);
  try {
    fs.unlinkSync(dbPath);
    // 删除 WAL/SHM 文件
    try {
      fs.unlinkSync(dbPath + "-wal");
    } catch {
      /* ok */
    }
    try {
      fs.unlinkSync(dbPath + "-shm");
    } catch {
      /* ok */
    }
  } catch {
    // 文件不存在就忽略
  }
}

/** 关闭所有会话（退出时调用） */
export async function closeAll(): Promise<void> {
  for (const [sessionId] of dbCache) {
    await closeSession(sessionId);
  }
  if (saveInterval) {
    clearInterval(saveInterval);
    saveInterval = null;
  }
}

// 进程退出时自动保存
process.on("exit", () => {
  for (const [, handle] of dbCache) {
    try {
      const data = handle.db.export();
      fs.writeFileSync(handle.path, Buffer.from(data));
    } catch {
      // 退出时静默处理
    }
  }
});

// 由顶层 consumer 按需启动（session.ts 或 cli 入口处调用 startAutoSave()）
// 模块加载时不自动启动，避免阻止测试进程退出
