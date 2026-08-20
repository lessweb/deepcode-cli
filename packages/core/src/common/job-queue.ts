/**
 * Job 队列模块
 * 借鉴 OpenAI Codex CLI 的 SpawnRequest→SpawnReady→ExitPayload 三阶段协议
 *
 * 核心功能：
 * - Job 生命周期管理（pending → running → completed | failed | timed_out）
 * - 指数退避重试
 * - 超时控制
 * - 并发限制
 * - 事件通知
 */

import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";

// ─── 类型定义 ────────────────────────────────────────────

/** Job 状态 */
export type JobStatus = "pending" | "running" | "completed" | "failed" | "timed_out" | "cancelled";

/** SpawnRequest：请求执行命令 */
export interface SpawnRequest {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  /** 是否允许后台运行 */
  background: boolean;
  /** 权限 Profile 名称（用于关联审计日志） */
  permissionProfile?: string;
}

/** SpawnReady：子进程就绪通知 */
export interface SpawnReady {
  processId: number;
  jobId: string;
  startedAt: number;
}

/** ExitPayload：执行结果 */
export interface ExitPayload {
  jobId: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  attempts: number;
}

/** Job 完整状态 */
export interface JobState {
  id: string;
  status: JobStatus;
  request: SpawnRequest;
  attempt: number;
  maxAttempts: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: ExitPayload;
  error?: string;
}

/** Job 事件回调 */
export interface JobEventCallbacks {
  onStart?: (jobId: string, pid: number) => void;
  onStdout?: (jobId: string, text: string) => void;
  onStderr?: (jobId: string, text: string) => void;
  onComplete?: (payload: ExitPayload) => void;
  onRetry?: (jobId: string, attempt: number, error: string, nextDelayMs: number) => void;
}

// ─── Job 队列 ─────────────────────────────────────────────

export class JobQueue {
  private jobs = new Map<string, JobState>();
  private activeJobs = new Map<string, ChildProcess>();
  private maxConcurrency: number;
  private pendingQueue: string[] = [];

  constructor(maxConcurrency = 5) {
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * 提交一个 Job 到队列
   * @returns jobId
   */
  submit(request: SpawnRequest, callbacks?: JobEventCallbacks): string {
    const jobId = randomUUID();
    const state: JobState = {
      id: jobId,
      status: "pending",
      request,
      attempt: 0,
      maxAttempts: Math.max(1, request.maxRetries + 1),
      createdAt: Date.now(),
    };
    this.jobs.set(jobId, state);
    this.pendingQueue.push(jobId);

    // 尝试调度执行
    this.scheduleNext(callbacks);
    return jobId;
  }

  /**
   * 获取 Job 当前状态
   */
  getState(jobId: string): JobState | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * 取消一个 Job
   */
  cancel(jobId: string): boolean {
    const state = this.jobs.get(jobId);
    if (!state || state.status === "completed" || state.status === "cancelled") return false;

    state.status = "cancelled";
    state.completedAt = Date.now();

    const child = this.activeJobs.get(jobId);
    if (child && !child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ok */
      }
    }
    this.activeJobs.delete(jobId);
    this.pendingQueue = this.pendingQueue.filter((id) => id !== jobId);
    return true;
  }

  /**
   * 等待 Job 完成（返回 ExitPayload）
   */
  async waitFor(jobId: string): Promise<ExitPayload> {
    const state = this.jobs.get(jobId);
    if (!state) throw new Error(`Job ${jobId} not found`);
    if (state.result) return state.result;

    return new Promise((resolve, reject) => {
      const check = setInterval(() => {
        const current = this.jobs.get(jobId);
        if (!current) {
          clearInterval(check);
          reject(new Error(`Job ${jobId} removed`));
          return;
        }
        if (current.result) {
          clearInterval(check);
          resolve(current.result);
        }
        if (current.status === "cancelled") {
          clearInterval(check);
          resolve({
            jobId,
            exitCode: null,
            signal: "SIGKILL",
            stdout: "",
            stderr: "",
            timedOut: false,
            durationMs: Date.now() - current.createdAt,
            attempts: current.attempt,
          });
        }
      }, 100);
    });
  }

  /** 当前活动 Job 数 */
  get activeCount(): number {
    return this.activeJobs.size;
  }

  /** 队列中所有 Job */
  get allJobs(): JobState[] {
    return Array.from(this.jobs.values());
  }

  /** 清除已完成 Job */
  cleanup(): void {
    for (const [id, state] of this.jobs) {
      if (state.status === "completed" || state.status === "cancelled") {
        const age = Date.now() - (state.completedAt ?? state.createdAt);
        if (age > 5 * 60 * 1000) {
          // 5 分钟
          this.jobs.delete(id);
        }
      }
    }
  }

  // ─── 内部调度 ───────────────────────────────────────

  private scheduleNext(callbacks?: JobEventCallbacks): void {
    while (this.activeJobs.size < this.maxConcurrency && this.pendingQueue.length > 0) {
      const jobId = this.pendingQueue.shift()!;
      const state = this.jobs.get(jobId);
      if (!state || state.status === "cancelled") continue;
      this.executeJob(jobId, callbacks);
    }
  }

  private executeJob(jobId: string, callbacks?: JobEventCallbacks): void {
    const state = this.jobs.get(jobId);
    if (!state) return;

    state.status = "running";
    state.attempt++;
    state.startedAt = Date.now();
    state.error = undefined;

    const req = state.request;
    const startedAt = Date.now();
    let timedOut = false;

    const child = spawn(req.command, req.args, {
      cwd: req.cwd,
      env: req.env ? { ...process.env, ...req.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    this.activeJobs.set(jobId, child);
    callbacks?.onStart?.(jobId, child.pid ?? 0);

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      callbacks?.onStdout?.(jobId, text);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      callbacks?.onStderr?.(jobId, text);
    });

    // 超时控制
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      if (!child.killed) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ok */
        }
      }
    }, req.timeoutMs);

    child.on("close", (exitCode, signal) => {
      clearTimeout(timeoutTimer);
      this.activeJobs.delete(jobId);

      const durationMs = Date.now() - startedAt;
      const payload: ExitPayload = {
        jobId,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        durationMs,
        attempts: state.attempt,
      };

      // 判断是否需要重试
      const shouldRetry =
        (exitCode !== 0 || timedOut || signal) && state.attempt < state.maxAttempts && state.status !== "cancelled";

      if (shouldRetry) {
        // 计算指数退避延迟
        const delayMs = Math.min(
          req.retryDelayMs * Math.pow(2, state.attempt - 1),
          30000 // 最大 30s
        );
        const errorMsg = timedOut ? `Timed out after ${req.timeoutMs}ms` : `Exit code ${exitCode}, signal ${signal}`;
        state.error = errorMsg;
        callbacks?.onRetry?.(jobId, state.attempt, errorMsg, delayMs);

        setTimeout(() => {
          this.executeJob(jobId, callbacks);
        }, delayMs);
      } else {
        // 最终完成
        state.status = timedOut ? "timed_out" : exitCode === 0 ? "completed" : "failed";
        state.completedAt = Date.now();
        state.result = payload;
        callbacks?.onComplete?.(payload);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeoutTimer);
      this.activeJobs.delete(jobId);

      const durationMs = Date.now() - startedAt;
      const errorMsg = err.message;
      state.error = errorMsg;

      if (state.attempt < state.maxAttempts && state.status !== "cancelled") {
        const delayMs = Math.min(req.retryDelayMs * Math.pow(2, state.attempt - 1), 30000);
        callbacks?.onRetry?.(jobId, state.attempt, errorMsg, delayMs);
        setTimeout(() => {
          this.executeJob(jobId, callbacks);
        }, delayMs);
      } else {
        state.status = "failed";
        state.completedAt = Date.now();
        state.result = {
          jobId,
          exitCode: -1,
          signal: null,
          stdout,
          stderr,
          timedOut: false,
          durationMs,
          attempts: state.attempt,
        };
        callbacks?.onComplete?.(state.result);
      }
    });
  }
}

// ─── 全局单例 ─────────────────────────────────────────────

let globalJobQueue: JobQueue | null = null;

/** 获取全局 Job 队列实例 */
export function getGlobalJobQueue(maxConcurrency = 5): JobQueue {
  if (!globalJobQueue) {
    globalJobQueue = new JobQueue(maxConcurrency);
  }
  return globalJobQueue;
}

/** 创建默认 SpawnRequest */
export function createSpawnRequest(command: string, options?: Partial<SpawnRequest>): SpawnRequest {
  return {
    command,
    args: options?.args ?? [],
    cwd: options?.cwd,
    env: options?.env,
    timeoutMs: options?.timeoutMs ?? 30000,
    maxRetries: options?.maxRetries ?? 2,
    retryDelayMs: options?.retryDelayMs ?? 500,
    background: options?.background ?? false,
    permissionProfile: options?.permissionProfile,
  };
}
