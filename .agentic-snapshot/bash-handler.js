import { spawn } from "child_process";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DEFAULT_BASH_TIMEOUT_MS, clampBashTimeoutMs } from "../common/bash-timeout.js";
import { killProcessTree } from "../common/process-tree.js";
import { buildDisableExtglobCommand, buildShellEnv, buildShellInitCommand, resolveShellPath, rewriteWindowsNullRedirect, toNativeCwd, } from "../common/shell-utils.js";
const MAX_OUTPUT_CHARS = 30000;
const MAX_CAPTURE_CHARS = 10 * 1024 * 1024;
const BACKGROUND_OUTPUT_DIR = path.join(os.tmpdir(), "deepcode-background");
const TRAILING_BACKGROUND_OPERATOR_PATTERN = /(^|[^\\&])\s*&\s*$/;
const sessionWorkingDirs = new Map();
export function clearSessionWorkingDir(sessionId) {
    if (!sessionId) {
        return;
    }
    sessionWorkingDirs.delete(sessionId);
}
export async function handleBashTool(args, context) {
    const rawCommand = typeof args.command === "string" ? args.command : "";
    const runInBackground = isTrue(args.run_in_background);
    const command = runInBackground ? stripTrailingBackgroundOperator(rawCommand) : rawCommand;
    if (!command.trim()) {
        return {
            ok: false,
            name: "bash",
            error: 'Missing required "command" string.',
        };
    }
    const startCwd = getSessionCwd(context.sessionId, context.projectRoot);
    const { shellPath, shellArgs, marker } = buildShellCommand(command);
    if (runInBackground) {
        return startBackgroundShellCommand(shellPath, shellArgs, startCwd, command, marker, context);
    }
    const execution = await executeShellCommand(shellPath, shellArgs, startCwd, command, context);
    const result = buildToolCommandResultWithAnalysis(execution.stdout, execution.stderr, marker, execution.exitCode, execution.signal, shellPath, startCwd, execution.timedOut, execution.timeoutMs, execution.deadlineAtMs);
    updateSessionCwd(context.sessionId, startCwd, result.cwd);
    if (execution.error || result.exitCode !== 0 || result.signal !== null) {
        const errorMessage = buildErrorMessage(result.exitCode, result.signal, execution.error, execution.timedOut);
        return formatResult({ ...result, ok: false }, "bash", errorMessage);
    }
    return formatResult(result, "bash");
}
/**
 * Extract structured error pattern information from command output.
 * Helps the LLM identify the root cause of failures more quickly.
 */
function extractErrorAnalysis(output, exitCode) {
    if (!output || exitCode === 0) {
        return undefined;
    }
    const lines = output.split(/\r?\n/);
    const errorLines = [];
    let lineCount = 0;
    // Collect error-like lines (common patterns across languages/tools)
    for (const line of lines) {
        const lower = line.toLowerCase();
        if (/error|exception|traceback|failed|failure|not found|syntax\s*error|cannot\s+find|undefined|ts\d+|ts error/i.test(lower)) {
            errorLines.push(line.trim());
            lineCount++;
            if (lineCount >= 10)
                break; // limit to top 10 error lines
        }
    }
    if (errorLines.length === 0)
        return undefined;
    return errorLines.join("\n");
}
function buildToolCommandResultWithAnalysis(stdout, stderr, marker, exitCode, signal, shellPath, startCwd, timedOut = false, timeoutMs, deadlineAtMs) {
    const result = buildToolCommandResult(stdout, stderr, marker, exitCode, signal, shellPath, startCwd, timedOut, timeoutMs, deadlineAtMs);
    // Attach error analysis for failed commands
    if (exitCode !== 0 && signal === null && !timedOut) {
        const analysis = extractErrorAnalysis(result.output, exitCode);
        if (analysis) {
            // Prepend error analysis to the output so the LLM sees it first
            result.output = `<error_analysis>\n${analysis}\n</error_analysis>\n\n${result.output}`;
        }
    }
    return result;
}
function isTrue(value) {
    return value === true || value === "true";
}
function stripTrailingBackgroundOperator(command) {
    return command.replace(TRAILING_BACKGROUND_OPERATOR_PATTERN, "$1").trimEnd();
}
function getSessionCwd(sessionId, fallback) {
    return sessionWorkingDirs.get(sessionId) ?? fallback;
}
function updateSessionCwd(sessionId, fallback, cwd) {
    const nextCwd = cwd ?? fallback;
    sessionWorkingDirs.set(sessionId, nextCwd);
}
function buildShellCommand(command) {
    const shellPath = resolveShellPath();
    const marker = buildMarker();
    const initCommand = buildShellInitCommand(shellPath);
    const disableExtglobCommand = buildDisableExtglobCommand(shellPath);
    const normalizedCommand = rewriteWindowsNullRedirect(command);
    const wrappedParts = [];
    if (initCommand) {
        wrappedParts.push(initCommand);
    }
    if (disableExtglobCommand) {
        wrappedParts.push(disableExtglobCommand);
    }
    wrappedParts.push(normalizedCommand, "__DEEPCODE_STATUS__=$?", `printf '%s%s\\n' "${marker}" "$PWD"`, "exit $__DEEPCODE_STATUS__");
    const wrappedCommand = `{ ${wrappedParts.join("; ")}; } < /dev/null`;
    return { shellPath, shellArgs: ["-c", wrappedCommand], marker };
}
async function executeShellCommand(shellPath, shellArgs, cwd, command, context) {
    return new Promise((resolve) => {
        const detached = process.platform !== "win32";
        const configuredEnv = context.createOpenAIClient?.().env ?? {};
        const minTimeoutMs = context.bashMinTimeoutMs;
        const initialTimeoutMs = clampBashTimeoutMs(context.bashTimeoutMs ?? DEFAULT_BASH_TIMEOUT_MS, minTimeoutMs);
        const startedAtMs = Date.now();
        let timeoutMs = initialTimeoutMs;
        let deadlineAtMs = startedAtMs + timeoutMs;
        let timedOut = false;
        let settled = false;
        let timeoutTimer = null;
        const child = spawn(shellPath, shellArgs, {
            cwd,
            env: buildShellEnv(shellPath, configuredEnv),
            detached,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        const pid = child.pid;
        const getTimeoutInfo = () => ({
            timeoutMs,
            startedAtMs,
            deadlineAtMs,
            timedOut,
        });
        const stopTimeoutTimer = () => {
            if (timeoutTimer) {
                clearTimeout(timeoutTimer);
                timeoutTimer = null;
            }
        };
        const triggerTimeout = () => {
            if (settled || timedOut || typeof pid !== "number") {
                return;
            }
            timedOut = true;
            stopTimeoutTimer();
            killProcessTree(pid, "SIGKILL");
        };
        const scheduleTimeout = () => {
            stopTimeoutTimer();
            if (settled) {
                return;
            }
            const remainingMs = Math.max(0, deadlineAtMs - Date.now());
            timeoutTimer = setTimeout(triggerTimeout, remainingMs);
        };
        const timeoutControl = {
            getInfo: getTimeoutInfo,
            setTimeoutMs: (nextTimeoutMs) => {
                timeoutMs = clampBashTimeoutMs(nextTimeoutMs, minTimeoutMs);
                deadlineAtMs = startedAtMs + timeoutMs;
                if (deadlineAtMs <= Date.now()) {
                    triggerTimeout();
                }
                else {
                    scheduleTimeout();
                }
                return getTimeoutInfo();
            },
        };
        if (typeof pid === "number") {
            context.onProcessStart?.(pid, command);
            context.onProcessTimeoutControl?.(pid, timeoutControl);
            scheduleTimeout();
        }
        let stdout = "";
        let stderr = "";
        let error;
        child.stdout?.on("data", (chunk) => {
            stdout = appendChunk(stdout, chunk);
            const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
            context.onProcessStdout?.(pid, text);
        });
        child.stderr?.on("data", (chunk) => {
            stderr = appendChunk(stderr, chunk);
            const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
            context.onProcessStdout?.(pid, text);
        });
        child.on("error", (spawnError) => {
            error = spawnError.message;
        });
        child.on("close", (code, signal) => {
            settled = true;
            stopTimeoutTimer();
            if (typeof pid === "number") {
                context.onProcessTimeoutControl?.(pid, null);
                context.onProcessExit?.(pid);
            }
            resolve({
                stdout,
                stderr,
                exitCode: typeof code === "number" ? code : null,
                signal: signal ?? null,
                error,
                timedOut,
                timeoutMs,
                deadlineAtMs,
            });
        });
    });
}
function startBackgroundShellCommand(shellPath, shellArgs, cwd, command, marker, context) {
    fs.mkdirSync(BACKGROUND_OUTPUT_DIR, { recursive: true });
    const taskId = `bash-${randomUUID()}`;
    const outputPath = path.join(BACKGROUND_OUTPUT_DIR, `${taskId}.log`);
    const startedAtMs = Date.now();
    const detached = process.platform !== "win32";
    const configuredEnv = context.createOpenAIClient?.().env ?? {};
    const child = spawn(shellPath, shellArgs, {
        cwd,
        env: buildShellEnv(shellPath, configuredEnv),
        detached,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
    });
    const pid = child.pid;
    const processId = typeof pid === "number" ? pid : -1;
    const stopCommand = typeof pid === "number" ? buildStopBackgroundProcessCommand(pid) : null;
    let stdout = "";
    let stderr = "";
    let error;
    const appendOutputFile = (chunk) => {
        try {
            fs.appendFileSync(outputPath, chunk);
        }
        catch {
            // Keep the background process running even if temp-file writes fail.
        }
    };
    if (typeof pid === "number") {
        context.onProcessStart?.(pid, command);
    }
    child.stdout?.on("data", (chunk) => {
        stdout = appendChunk(stdout, chunk);
        appendOutputFile(chunk);
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (typeof pid === "number") {
            context.onProcessStdout?.(pid, text);
        }
    });
    child.stderr?.on("data", (chunk) => {
        stderr = appendChunk(stderr, chunk);
        appendOutputFile(chunk);
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (typeof pid === "number") {
            context.onProcessStdout?.(pid, text);
        }
    });
    child.on("error", (spawnError) => {
        error = spawnError.message;
    });
    child.on("close", (code, signal) => {
        const markerResult = stripMarker(stdout, marker);
        const finalOutput = joinOutput(markerResult.output, stderr);
        const result = buildToolCommandResult(stdout, stderr, marker, typeof code === "number" ? code : null, signal ?? null, shellPath, cwd);
        updateSessionCwd(context.sessionId, cwd, result.cwd);
        writeFinalBackgroundOutput(outputPath, finalOutput);
        if (typeof pid === "number") {
            context.onProcessExit?.(pid);
        }
        const ok = !error && result.exitCode === 0 && result.signal === null;
        context.onBackgroundProcessComplete?.({
            taskId,
            processId,
            command,
            outputPath,
            ok,
            exitCode: result.exitCode,
            signal: result.signal,
            error: ok ? undefined : buildErrorMessage(result.exitCode, result.signal, error),
            cwd: result.cwd,
            shellPath,
            startedAtMs,
            completedAtMs: Date.now(),
        });
    });
    return {
        ok: true,
        name: "bash",
        output: buildBackgroundStartMessage(taskId, outputPath, stopCommand),
        metadata: {
            backgroundTaskId: taskId,
            processId: typeof pid === "number" ? pid : null,
            outputPath,
            stopCommand,
            cwd,
            shellPath,
            startCwd: cwd,
            runInBackground: true,
        },
    };
}
function buildBackgroundStartMessage(taskId, outputPath, stopCommand) {
    const parts = [`Command running in background with ID: ${taskId}.`];
    if (stopCommand) {
        parts.push(`Stop it with: ${stopCommand}`);
    }
    parts.push(`Output is being written to: ${outputPath}`);
    return parts.join(" ");
}
function buildStopBackgroundProcessCommand(processId) {
    if (process.platform === "win32") {
        return `cmd.exe /c "taskkill /PID ${processId} /T /F"`;
    }
    return `kill -- -${processId}`;
}
function writeFinalBackgroundOutput(outputPath, output) {
    try {
        fs.writeFileSync(outputPath, output ?? "", "utf8");
    }
    catch {
        // Ignore notification/output persistence failures; the tool result already returned.
    }
}
function appendChunk(existing, chunk) {
    if (existing.length >= MAX_CAPTURE_CHARS) {
        return existing;
    }
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const remaining = MAX_CAPTURE_CHARS - existing.length;
    return `${existing}${text.slice(0, remaining)}`;
}
function buildMarker() {
    const token = Math.random().toString(36).slice(2);
    return `__DEEPCODE_PWD__${token}__`;
}
function buildToolCommandResult(stdout, stderr, marker, exitCode, signal, shellPath, startCwd, timedOut = false, timeoutMs, deadlineAtMs) {
    const { output: cleanedStdout, cwd } = stripMarker(stdout, marker);
    const combined = joinOutput(cleanedStdout, stderr);
    const { text, truncated } = truncateOutput(combined);
    return {
        ok: exitCode === 0 && signal === null,
        output: text,
        cwd,
        exitCode,
        signal,
        truncated,
        shellPath,
        startCwd,
        timedOut,
        timeoutMs,
        deadlineAt: typeof deadlineAtMs === "number" ? new Date(deadlineAtMs).toISOString() : undefined,
    };
}
function stripMarker(stdout, marker) {
    if (!stdout) {
        return { output: "", cwd: null };
    }
    const lines = stdout.split(/\r?\n/);
    let markerIndex = -1;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (lines[i].startsWith(marker)) {
            markerIndex = i;
            break;
        }
    }
    if (markerIndex === -1) {
        return { output: stdout, cwd: null };
    }
    const markerLine = lines[markerIndex];
    const shellCwd = markerLine.slice(marker.length).trim();
    const cwd = shellCwd ? toNativeCwd(shellCwd) : null;
    lines.splice(markerIndex, 1);
    return { output: lines.join("\n"), cwd };
}
function joinOutput(stdout, stderr) {
    const trimmedStdout = stdout ?? "";
    const trimmedStderr = stderr ?? "";
    if (trimmedStdout && trimmedStderr) {
        return `${trimmedStdout}\n${trimmedStderr}`;
    }
    return trimmedStdout || trimmedStderr;
}
function truncateOutput(output) {
    if (output.length <= MAX_OUTPUT_CHARS) {
        return { text: output, truncated: false };
    }
    return { text: output.slice(0, MAX_OUTPUT_CHARS), truncated: true };
}
function buildErrorMessage(exitCode, signal, error, timedOut = false) {
    if (error) {
        return error;
    }
    if (timedOut) {
        return "Command timed out.";
    }
    if (signal) {
        return `Command terminated by signal ${signal}.`;
    }
    if (exitCode !== null) {
        return `Command failed with exit code ${exitCode}.`;
    }
    return "Command failed.";
}
function formatResult(result, name, errorMessage) {
    const metadata = {
        exitCode: result.exitCode,
        signal: result.signal,
        cwd: result.cwd,
        truncated: result.truncated,
        shellPath: result.shellPath,
        startCwd: result.startCwd,
    };
    if (typeof result.timedOut === "boolean") {
        metadata.timedOut = result.timedOut;
    }
    if (typeof result.timeoutMs === "number") {
        metadata.timeoutMs = result.timeoutMs;
    }
    if (result.deadlineAt) {
        metadata.deadlineAt = result.deadlineAt;
    }
    const outputValue = result.output ? result.output : undefined;
    return {
        ok: result.ok,
        name,
        output: outputValue,
        error: errorMessage,
        metadata,
    };
}
