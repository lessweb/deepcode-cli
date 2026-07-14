import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import matter from "gray-matter";
import ejs from "ejs";
import { launchNotifyScript } from "./common/notify.js";
import { buildThinkingRequestOptions } from "./common/openai-thinking.js";
import { DEEPSEEK_V4_MODELS } from "./common/model-capabilities.js";
import { readTextFileWithMetadata } from "./common/file-utils.js";
import { buildSkillDocumentsPrompt, getCompactPrompt, getDefaultSkillPrompt, getExtensionRoot, getRuntimeContext, getSystemPrompt, getTools, } from "./prompt.js";
import { ToolExecutor, } from "./tools/executor.js";
import { McpManager } from "./mcp/mcp-manager.js";
import { logApiError } from "./common/error-logger.js";
import { logOpenAIChatCompletionDebug, normalizeDebugError } from "./common/debug-logger.js";
import { killProcessTree } from "./common/process-tree.js";
import { fireHook } from "./common/hooks.js";
import { GitFileHistory } from "./common/file-history.js";
import { clearSessionState, getSnippet, rebuildSessionStateFromHistory } from "./common/state.js";
import { appendProjectPermissionAllows, buildPermissionToolExecution, computeToolCallPermissions, hasUserPermissionReplies, normalizeAskPermissions, parseToolCallForPermissions, } from "./common/permissions.js";
import { clearSessionWorkingDir } from "./tools/bash-handler.js";
import { reportNewPrompt } from "./common/telemetry.js";
import { OpenAIMessageConverter } from "./common/openai-message-converter.js";
const MAX_SESSION_ENTRIES = 50;
const MAX_PROJECT_CODE_LENGTH = 64;
const PROJECT_CODE_HASH_LENGTH = 16;
const BACKGROUND_FAILURE_LOG_TAIL_CHARS = 4000;
const DEFAULT_COMPACT_PROMPT_TOKEN_THRESHOLD = 128 * 1024;
const DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD = 512 * 1024;
const PLAN_MODE_STATUS_MESSAGE = "/plan\n  └ Set Plan Mode on. Awaiting <proposed_plan>.";
export function getCompactPromptTokenThreshold(model) {
    return DEEPSEEK_V4_MODELS.has(model)
        ? DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD
        : DEFAULT_COMPACT_PROMPT_TOKEN_THRESHOLD;
}
// Keep project storage paths short enough for Git's internal files on Windows.
export function getProjectCode(projectRoot) {
    const legacyCode = getLegacyProjectCode(projectRoot);
    if (legacyCode.length <= MAX_PROJECT_CODE_LENGTH) {
        return legacyCode;
    }
    const normalizedRoot = path.resolve(projectRoot);
    const hashInput = process.platform === "win32" ? normalizedRoot.toLowerCase() : normalizedRoot;
    const hash = crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, PROJECT_CODE_HASH_LENGTH);
    const prefixLimit = MAX_PROJECT_CODE_LENGTH - PROJECT_CODE_HASH_LENGTH - 1;
    const basename = path.basename(normalizedRoot);
    const prefix = sanitizeProjectCodePart(basename)
        .slice(0, prefixLimit)
        .replace(/[-.]+$/g, "") || "project";
    return `${prefix}-${hash}`;
}
function getLegacyProjectCode(projectRoot) {
    return projectRoot.replace(/[\\/]/g, "-").replace(/:/g, "");
}
function sanitizeProjectCodePart(value) {
    return value
        .replace(/[^A-Za-z0-9._-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "");
}
function isUsageRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function summarizeCompletionOptions(options) {
    if (!options) {
        return undefined;
    }
    return {
        ...options,
        signal: options.signal instanceof AbortSignal ? { aborted: options.signal.aborted } : options.signal,
    };
}
function addUsageValue(current, next) {
    if (typeof next === "number") {
        return (typeof current === "number" ? current : 0) + next;
    }
    if (isUsageRecord(next)) {
        const currentRecord = isUsageRecord(current) ? current : {};
        const result = { ...currentRecord };
        for (const [key, value] of Object.entries(next)) {
            result[key] = addUsageValue(currentRecord[key], value);
        }
        return result;
    }
    return next;
}
function accumulateUsage(current, next) {
    if (next == null) {
        return current ?? null;
    }
    return addUsageValue(current, next);
}
function usageWithRequestCount(usage) {
    const totalReqs = typeof usage.total_reqs === "number" ? usage.total_reqs + 1 : 1;
    return {
        ...usage,
        total_reqs: totalReqs,
    };
}
function accumulateUsagePerModel(current, model, next) {
    if (next == null) {
        return current ?? null;
    }
    const usagePerModel = { ...(current ?? {}) };
    const modelName = model.trim() || "unknown";
    usagePerModel[modelName] = accumulateUsage(usagePerModel[modelName] ?? null, usageWithRequestCount(next));
    return usagePerModel;
}
function getTotalTokens(usage) {
    if (!isUsageRecord(usage)) {
        return 0;
    }
    const totalTokens = usage.total_tokens;
    return typeof totalTokens === "number" ? totalTokens : 0;
}
export class SessionManager {
    projectRoot;
    createOpenAIClient;
    getResolvedSettings;
    onAssistantMessage;
    onSessionEntryUpdated;
    onLlmStreamProgress;
    onMcpStatusChanged;
    onProcessStdout;
    activeSessionId = null;
    activePromptController = null;
    sessionControllers = new Map();
    processTimeoutControls = new Map();
    liveProcessKeys = new Set();
    toolExecutor;
    mcpManager = new McpManager();
    mcpToolDefinitions = [];
    messageConverter;
    constructor(options) {
        this.projectRoot = options.projectRoot;
        this.createOpenAIClient = options.createOpenAIClient;
        this.getResolvedSettings = options.getResolvedSettings;
        this.onAssistantMessage = options.onAssistantMessage;
        this.onSessionEntryUpdated = options.onSessionEntryUpdated;
        this.onLlmStreamProgress = options.onLlmStreamProgress;
        this.onMcpStatusChanged = options.onMcpStatusChanged;
        this.onProcessStdout = options.onProcessStdout;
        this.toolExecutor = new ToolExecutor(this.projectRoot, this.createOpenAIClient, this.mcpManager);
        this.mcpManager.prepare(this.getResolvedSettings().mcpServers);
        this.messageConverter = new OpenAIMessageConverter({
            renderInitPrompt: () => this.renderInitCommandPrompt(),
        });
    }
    /**
     * @deprecated Use messageConverter.buildMessages directly.
     * Kept for test compatibility.
     */
    buildOpenAIMessages(messages, thinkingEnabled, model) {
        return this.messageConverter.buildMessages(messages, thinkingEnabled, model);
    }
    async initMcpServers(servers) {
        this.mcpManager.setOnToolsListChanged(() => {
            this.mcpToolDefinitions = this.mcpManager.getMcpToolDefinitions();
        });
        // 设置状态变更回调，通知 UI 更新
        this.mcpManager.setOnStatusChanged(() => {
            this.onMcpStatusChanged?.();
        });
        await this.mcpManager.initialize(servers);
        this.mcpToolDefinitions = this.mcpManager.getMcpToolDefinitions();
    }
    getMcpStatus() {
        return this.mcpManager.getStatus();
    }
    async reconnectMcpServer(name, config) {
        await this.mcpManager.reconnect(name, config);
        this.mcpToolDefinitions = this.mcpManager.getMcpToolDefinitions();
    }
    dispose() {
        const controller = this.activePromptController;
        if (controller && !controller.signal.aborted) {
            controller.abort();
        }
        this.activePromptController = null;
        for (const sessionController of this.sessionControllers.values()) {
            if (!sessionController.signal.aborted) {
                sessionController.abort();
            }
        }
        this.killLiveProcesses();
        this.sessionControllers.clear();
        this.processTimeoutControls.clear();
        this.mcpManager.disconnect();
    }
    estimateStreamTokens(text) {
        let tokens = 0;
        for (const char of text) {
            tokens += /[\u3400-\u9fff\uf900-\ufaff]/u.test(char) ? 0.6 : 0.3;
        }
        return tokens;
    }
    formatEstimatedTokens(tokens) {
        if (tokens <= 0) {
            return "0";
        }
        const roundedTokens = Math.round(tokens);
        if (roundedTokens <= 0) {
            return "0";
        }
        if (roundedTokens < 100) {
            return String(roundedTokens);
        }
        if (roundedTokens < 10000) {
            return `${Number((roundedTokens / 1000).toFixed(1))}k`;
        }
        return `${Math.round(roundedTokens / 1000)}k`;
    }
    emitLlmStreamProgress(requestId, startedAt, estimatedTokens, phase, sessionId) {
        this.onLlmStreamProgress?.({
            requestId,
            sessionId,
            startedAt,
            estimatedTokens: Math.round(estimatedTokens),
            formattedTokens: this.formatEstimatedTokens(estimatedTokens),
            phase,
        });
    }
    isAbortLikeError(error) {
        if (!(error instanceof Error)) {
            return false;
        }
        return error.name === "AbortError" || error.constructor.name === "APIUserAbortError";
    }
    throwIfAborted(signal) {
        if (!signal?.aborted) {
            return;
        }
        const error = new Error("Request was aborted.");
        error.name = "AbortError";
        throw error;
    }
    async createChatCompletionStream(client, request, options, sessionId, debug) {
        const requestId = crypto.randomUUID();
        const startedAt = new Date().toISOString();
        const startedAtMs = Date.now();
        let estimatedTokens = 0;
        this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "start", sessionId);
        const streamRequest = {
            ...request,
            stream: true,
            stream_options: {
                ...(isUsageRecord(request.stream_options) ? request.stream_options : {}),
                include_usage: true,
            },
        };
        let response;
        try {
            response = await client.chat.completions.create(streamRequest, options);
        }
        catch (error) {
            this.logChatCompletionDebug(debug, {
                timestamp: new Date().toISOString(),
                location: debug?.location ?? "SessionManager.createChatCompletionStream:create",
                requestId,
                sessionId,
                model: typeof request.model === "string" ? request.model : undefined,
                baseURL: debug?.baseURL,
                durationMs: Date.now() - startedAtMs,
                params: { ...debug?.params, options: summarizeCompletionOptions(options) },
                request: streamRequest,
                error: normalizeDebugError(error),
            });
            logApiError({
                timestamp: new Date().toISOString(),
                location: "SessionManager.createChatCompletionStream:create",
                requestId,
                sessionId,
                model: typeof request.model === "string" ? request.model : undefined,
                error: {
                    name: error instanceof Error ? error.name : "UnknownError",
                    message: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                },
                request: streamRequest,
            });
            this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "end", sessionId);
            throw error;
        }
        if (!response || typeof response[Symbol.asyncIterator] !== "function") {
            this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "end", sessionId);
            this.logChatCompletionDebug(debug, {
                timestamp: new Date().toISOString(),
                location: debug?.location ?? "SessionManager.createChatCompletionStream",
                requestId,
                sessionId,
                model: typeof request.model === "string" ? request.model : undefined,
                baseURL: debug?.baseURL,
                durationMs: Date.now() - startedAtMs,
                params: { ...debug?.params, options: summarizeCompletionOptions(options) },
                request: streamRequest,
                response,
            });
            return response;
        }
        let content = "";
        let reasoningContent = "";
        let refusal = null;
        let usage = null;
        const responseChunks = [];
        const toolCallsByIndex = new Map();
        const trackText = (value) => {
            if (typeof value !== "string" || value.length === 0) {
                return;
            }
            estimatedTokens += this.estimateStreamTokens(value);
            this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "update", sessionId);
        };
        try {
            for await (const chunk of response) {
                if (debug?.enabled) {
                    responseChunks.push(chunk);
                }
                if ("usage" in chunk && chunk.usage != null) {
                    usage = chunk.usage;
                }
                const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
                for (const choice of choices) {
                    const delta = isUsageRecord(choice) && isUsageRecord(choice.delta) ? choice.delta : null;
                    if (!delta) {
                        continue;
                    }
                    const contentDelta = delta.content;
                    if (typeof contentDelta === "string") {
                        content += contentDelta;
                        trackText(contentDelta);
                    }
                    const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
                    if (typeof reasoningDelta === "string") {
                        reasoningContent += reasoningDelta;
                        trackText(reasoningDelta);
                    }
                    if (typeof delta.refusal === "string") {
                        refusal = `${refusal ?? ""}${delta.refusal}`;
                        trackText(delta.refusal);
                    }
                    const rawToolCalls = delta.tool_calls;
                    if (Array.isArray(rawToolCalls)) {
                        for (const rawToolCall of rawToolCalls) {
                            if (!isUsageRecord(rawToolCall)) {
                                continue;
                            }
                            const index = typeof rawToolCall.index === "number" ? rawToolCall.index : toolCallsByIndex.size;
                            const current = toolCallsByIndex.get(index) ?? {};
                            if (typeof rawToolCall.id === "string") {
                                current.id = rawToolCall.id;
                            }
                            if (typeof rawToolCall.type === "string") {
                                current.type = rawToolCall.type;
                            }
                            const rawFunction = isUsageRecord(rawToolCall.function) ? rawToolCall.function : null;
                            if (rawFunction) {
                                current.function = current.function ?? {};
                                if (typeof rawFunction.name === "string") {
                                    current.function.name = `${current.function.name ?? ""}${rawFunction.name}`;
                                    trackText(rawFunction.name);
                                }
                                if (typeof rawFunction.arguments === "string") {
                                    current.function.arguments = `${current.function.arguments ?? ""}${rawFunction.arguments}`;
                                    trackText(rawFunction.arguments);
                                }
                            }
                            toolCallsByIndex.set(index, current);
                        }
                    }
                }
            }
        }
        catch (error) {
            this.logChatCompletionDebug(debug, {
                timestamp: new Date().toISOString(),
                location: debug?.location ?? "SessionManager.createChatCompletionStream:stream",
                requestId,
                sessionId,
                model: typeof request.model === "string" ? request.model : undefined,
                baseURL: debug?.baseURL,
                durationMs: Date.now() - startedAtMs,
                params: { ...debug?.params, options: summarizeCompletionOptions(options) },
                request: streamRequest,
                responseChunks,
                error: normalizeDebugError(error),
            });
            logApiError({
                timestamp: new Date().toISOString(),
                location: "SessionManager.createChatCompletionStream:stream",
                requestId,
                sessionId,
                model: typeof request.model === "string" ? request.model : undefined,
                error: {
                    name: error instanceof Error ? error.name : "UnknownError",
                    message: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                },
                request: streamRequest,
            });
            throw error;
        }
        finally {
            this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "end", sessionId);
        }
        const toolCalls = Array.from(toolCallsByIndex.entries())
            .sort(([left], [right]) => left - right)
            .map(([, toolCall]) => toolCall);
        const normalizedToolCalls = this.normalizeLlmToolCalls(toolCalls);
        const message = { content };
        if (normalizedToolCalls) {
            message.tool_calls = normalizedToolCalls;
        }
        if (reasoningContent.length > 0) {
            message.reasoning_content = reasoningContent;
        }
        if (refusal != null) {
            message.refusal = refusal;
        }
        const finalResponse = {
            choices: [{ message }],
            usage,
        };
        this.logChatCompletionDebug(debug, {
            timestamp: new Date().toISOString(),
            location: debug?.location ?? "SessionManager.createChatCompletionStream",
            requestId,
            sessionId,
            model: typeof request.model === "string" ? request.model : undefined,
            baseURL: debug?.baseURL,
            durationMs: Date.now() - startedAtMs,
            params: { ...debug?.params, options: summarizeCompletionOptions(options) },
            request: streamRequest,
            responseChunks,
            response: finalResponse,
        });
        return finalResponse;
    }
    logChatCompletionDebug(debug, entry) {
        if (!debug?.enabled) {
            return;
        }
        logOpenAIChatCompletionDebug(entry);
    }
    async identifyMatchingSkillNames(skills, userPrompt, options) {
        this.throwIfAborted(options?.signal);
        let systemPrompt = `When users ask you to perform tasks, check if any of the available skills match the goal and situation. Skills provide specialized capabilities and domain knowledge.\n
Response in JSON format:
\`\`\`
{
  "skillNames": ["", ...]
}
\`\`\`\n
If none of the available skills match, respond with an empty array, i.e. \`{"skillNames": []}\`.\n
`;
        const simpleSkills = skills
            .filter((x) => !x.isLoaded && x.allowImplicitInvocation !== false)
            .map((x) => {
            return { name: x.name, description: x.description };
        });
        if (simpleSkills.length === 0) {
            return [];
        }
        const candidateSkillNames = new Set(simpleSkills.map((skill) => skill.name));
        const { client, model, baseURL, debugLogEnabled } = this.createOpenAIClient();
        if (!client) {
            return [];
        }
        const agentInstructions = this.loadAgentInstructions();
        if (agentInstructions) {
            systemPrompt += `Use the current agent instructions as additional context when deciding which skills match:\n
<agent-instructions>
${agentInstructions}
</agent-instructions>\n
`;
        }
        systemPrompt += "The candidate skills are as follows:\n\n";
        systemPrompt += "```\n" + JSON.stringify(simpleSkills, null, 2) + "\n```";
        try {
            const response = await this.createChatCompletionStream(client, {
                model,
                temperature: 0.1,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                response_format: { type: "json_object" },
            }, options?.signal ? { signal: options.signal } : undefined, options?.sessionId, {
                enabled: debugLogEnabled,
                location: "SessionManager.identifyMatchingSkillNames",
                baseURL,
                params: { purpose: "skill-matching", temperature: 0.1 },
            });
            this.throwIfAborted(options?.signal);
            const rawContent = response.choices?.[0]?.message?.content;
            const content = typeof rawContent === "string" ? rawContent : "";
            if (!content) {
                return [];
            }
            const parsed = JSON.parse(content);
            if (parsed && Array.isArray(parsed.skillNames)) {
                return parsed.skillNames.filter((skillName) => typeof skillName === "string" && candidateSkillNames.has(skillName));
            }
            return [];
        }
        catch (error) {
            if (this.isAbortLikeError(error) || options?.signal?.aborted) {
                throw error;
            }
            return [];
        }
    }
    getSkillScanRoots() {
        const homeDir = os.homedir();
        return [
            { root: path.join(this.projectRoot, ".deepcode", "skills"), displayRoot: "./.deepcode/skills" },
            { root: path.join(this.projectRoot, ".agents", "skills"), displayRoot: "./.agents/skills" },
            { root: path.join(homeDir, ".deepcode", "skills"), displayRoot: "~/.deepcode/skills" },
            { root: path.join(homeDir, ".agents", "skills"), displayRoot: "~/.agents/skills" },
            { root: this.getBundledSkillsRoot(), displayRoot: "bundled:" },
        ];
    }
    getBundledSkillsRoot() {
        const extensionRoot = getExtensionRoot();
        const sourceRoot = path.join(extensionRoot, "templates", "skills", "bundled");
        // Source check keeps local development/tests on the checked-in templates.
        if (fs.existsSync(path.join(extensionRoot, "src", "session.ts")) && fs.existsSync(sourceRoot)) {
            return sourceRoot;
        }
        // In the published bundle, getExtensionRoot() resolves to dist/ and
        // bundled skills are copied to dist/bundled/ (not dist/templates/skills/bundled/).
        const distRoot = path.join(extensionRoot, "bundled");
        return fs.existsSync(distRoot) ? distRoot : sourceRoot;
    }
    async listSkills(sessionId) {
        const skillRoots = this.getSkillScanRoots();
        const enabledSkills = this.getResolvedSettings().enabledSkills ?? {};
        const skillsByName = new Map();
        const collectSkills = (root, displayRoot) => {
            if (!fs.existsSync(root)) {
                return [];
            }
            let entries;
            try {
                entries = fs.readdirSync(root, { withFileTypes: true });
            }
            catch {
                return [];
            }
            const results = [];
            for (const entry of entries) {
                if (!entry.isDirectory() && !entry.isSymbolicLink()) {
                    continue;
                }
                const skillName = entry.name;
                const skillPath = path.join(root, skillName, "SKILL.md");
                try {
                    if (!fs.existsSync(skillPath)) {
                        continue;
                    }
                    const stat = fs.statSync(skillPath);
                    if (!stat.isFile()) {
                        continue;
                    }
                }
                catch {
                    continue;
                }
                const displayPath = displayRoot === "bundled:" ? `bundled:${skillName}/SKILL.md` : `${displayRoot}/${skillName}/SKILL.md`;
                const skill = this.readSkillInfo(skillPath, displayPath, skillName);
                if (enabledSkills[skill.name] === false) {
                    continue;
                }
                results.push(skill);
            }
            return results;
        };
        for (const { root, displayRoot } of skillRoots) {
            for (const skill of collectSkills(root, displayRoot)) {
                if (!skillsByName.has(skill.name)) {
                    skillsByName.set(skill.name, skill);
                }
            }
        }
        if (sessionId) {
            const loadedSkillKeys = this.getLoadedSkillKeys(sessionId);
            for (const skill of skillsByName.values()) {
                if (loadedSkillKeys.has(this.getSkillKey(skill)) || loadedSkillKeys.has(this.getSkillKeyByName(skill.name))) {
                    skill.isLoaded = true;
                }
            }
        }
        return Array.from(skillsByName.values()).sort((a, b) => a.name.localeCompare(b.name));
    }
    resolveSkillPath(skillPath) {
        if (skillPath.startsWith("bundled:")) {
            const relativePath = skillPath.slice("bundled:".length);
            const root = this.getBundledSkillsRoot();
            const resolvedPath = path.resolve(root, relativePath);
            const resolvedRoot = path.resolve(root);
            if (resolvedPath === resolvedRoot || !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
                return path.join(root, "__invalid_bundled_skill__");
            }
            return resolvedPath;
        }
        if (skillPath.startsWith("~/")) {
            return path.join(os.homedir(), skillPath.slice(2));
        }
        if (skillPath.startsWith("~\\")) {
            return path.join(os.homedir(), skillPath.slice(2));
        }
        if (skillPath.startsWith("./")) {
            return path.join(this.projectRoot, skillPath.slice(2));
        }
        if (skillPath.startsWith(".\\")) {
            return path.join(this.projectRoot, skillPath.slice(2));
        }
        if (path.isAbsolute(skillPath)) {
            return skillPath;
        }
        return path.join(os.homedir(), skillPath);
    }
    buildSkillPrompt(skill) {
        const skillPath = this.resolveSkillPath(skill.path);
        return buildSkillDocumentsPrompt([
            {
                name: skill.name,
                content: fs.readFileSync(skillPath, "utf8"),
                path: skillPath,
                skillFilePath: skillPath,
            },
        ]);
    }
    readSkillInfo(skillPath, displayPath, fallbackName) {
        const fallbackSkill = {
            name: fallbackName.replace(/_/g, "-"),
            path: displayPath,
            description: "",
        };
        try {
            const skillMd = fs.readFileSync(skillPath, "utf8");
            const parsed = matter(skillMd);
            const metadata = parsed.data.metadata;
            const allowImplicitInvocation = metadata &&
                typeof metadata === "object" &&
                !Array.isArray(metadata) &&
                metadata["allow-implicit-invocation"] === false
                ? false
                : undefined;
            return {
                name: typeof parsed.data.name === "string" && parsed.data.name.trim()
                    ? parsed.data.name.trim()
                    : fallbackSkill.name,
                path: displayPath,
                description: typeof parsed.data.description === "string" ? parsed.data.description.trim() : "",
                allowImplicitInvocation,
            };
        }
        catch {
            return fallbackSkill;
        }
    }
    getSkillKey(skill) {
        return `path:${skill.path}`;
    }
    getSkillKeyByName(name) {
        return `name:${name}`;
    }
    getLoadedSkillKeys(sessionId) {
        const loadedSkillKeys = new Set();
        for (const message of this.listSessionMessages(sessionId)) {
            if (message.role !== "system" || !message.meta?.skill) {
                continue;
            }
            loadedSkillKeys.add(this.getSkillKey(message.meta.skill));
            loadedSkillKeys.add(this.getSkillKeyByName(message.meta.skill.name));
        }
        return loadedSkillKeys;
    }
    dedupeSkills(skills) {
        if (!skills || skills.length === 0) {
            return undefined;
        }
        const dedupedSkills = new Map();
        for (const skill of skills) {
            if (!skill?.name || !skill?.path) {
                continue;
            }
            const key = this.getSkillKey(skill);
            const existingSkill = dedupedSkills.get(key);
            dedupedSkills.set(key, {
                ...existingSkill,
                ...skill,
                description: skill.description ?? existingSkill?.description ?? "",
                isLoaded: Boolean(existingSkill?.isLoaded || skill.isLoaded),
            });
        }
        return Array.from(dedupedSkills.values());
    }
    async normalizeSkills(skills, sessionId) {
        const dedupedSkills = this.dedupeSkills(skills);
        if (!dedupedSkills || dedupedSkills.length === 0) {
            return undefined;
        }
        const availableSkills = await this.listSkills(sessionId);
        const availableSkillsByKey = new Map();
        for (const skill of availableSkills) {
            availableSkillsByKey.set(this.getSkillKey(skill), skill);
            availableSkillsByKey.set(this.getSkillKeyByName(skill.name), skill);
        }
        return dedupedSkills.map((skill) => {
            const matchedSkill = availableSkillsByKey.get(this.getSkillKey(skill)) ??
                availableSkillsByKey.get(this.getSkillKeyByName(skill.name));
            if (!matchedSkill) {
                return skill;
            }
            return {
                ...matchedSkill,
                ...skill,
                description: matchedSkill.description || skill.description,
                isLoaded: Boolean(matchedSkill.isLoaded || skill.isLoaded),
            };
        });
    }
    appendSkillMessages(sessionId, skills) {
        if (!skills || skills.length === 0) {
            return;
        }
        for (const skill of skills) {
            if (skill.name === "plan") {
                this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, PLAN_MODE_STATUS_MESSAGE));
            }
            if (skill.isLoaded) {
                continue;
            }
            const skillPrompt = this.buildSkillPrompt(skill);
            const skillMessage = this.buildSkillMessage(sessionId, skillPrompt, skill);
            this.appendSessionMessage(sessionId, skillMessage);
            this.onAssistantMessage(skillMessage, true);
        }
    }
    getActiveSessionId() {
        return this.activeSessionId;
    }
    setActiveSessionId(sessionId) {
        this.activeSessionId = sessionId;
    }
    addSessionSystemMessage(sessionId, content, visible, meta) {
        const message = this.buildSystemMessage(sessionId, content, null, visible, meta);
        if (sessionId)
            this.appendSessionMessage(sessionId, message);
        this.onAssistantMessage(message, false);
    }
    async handleUserPrompt(userPrompt) {
        const controller = new AbortController();
        this.activePromptController = controller;
        try {
            if (!this.activeSessionId || !this.getSession(this.activeSessionId)) {
                await this.createSession(userPrompt, controller);
            }
            else {
                await this.replySession(this.activeSessionId, userPrompt, controller);
            }
        }
        catch (error) {
            if (!this.isAbortLikeError(error) && !controller.signal.aborted) {
                throw error;
            }
        }
        finally {
            if (this.activePromptController === controller) {
                this.activePromptController = null;
            }
        }
    }
    async createSession(userPrompt, controller) {
        this.reportNewPrompt();
        const signal = controller?.signal;
        this.throwIfAborted(signal);
        const sessionId = crypto.randomUUID();
        this.ensureFileHistorySession(sessionId);
        const now = new Date().toISOString();
        const index = this.loadSessionsIndex();
        const entry = {
            id: sessionId,
            summary: userPrompt.text ? userPrompt.text.slice(0, 100) : "[Image Prompt]",
            assistantReply: null,
            assistantThinking: null,
            assistantRefusal: null,
            toolCalls: null,
            status: "pending",
            failReason: null,
            usage: null,
            usagePerModel: null,
            activeTokens: 0,
            createTime: now,
            updateTime: now,
            processes: null,
        };
        index.entries.push(entry);
        const sortedEntries = index.entries.slice().sort((a, b) => {
            const aTime = Date.parse(a.updateTime);
            const bTime = Date.parse(b.updateTime);
            if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
                return b.updateTime.localeCompare(a.updateTime);
            }
            return bTime - aTime;
        });
        const keptEntries = sortedEntries.slice(0, MAX_SESSION_ENTRIES);
        const keptIds = new Set(keptEntries.map((item) => item.id));
        const droppedEntries = sortedEntries.filter((item) => !keptIds.has(item.id));
        index.entries = keptEntries;
        this.saveSessionsIndex(index);
        for (const dropped of droppedEntries) {
            this.cleanupSessionResources(dropped.id, {
                removeMessages: true,
                processIds: this.getProcessIds(dropped.processes ?? null),
            });
        }
        const promptToolOptions = this.getPromptToolOptions();
        const systemPrompt = getSystemPrompt(this.projectRoot, promptToolOptions);
        const systemMessage = this.buildSystemMessage(sessionId, systemPrompt);
        this.appendSessionMessage(sessionId, systemMessage);
        const defaultSkillPrompt = getDefaultSkillPrompt({ enabledSkills: this.getResolvedSettings().enabledSkills });
        if (defaultSkillPrompt) {
            const defaultSkillMessage = this.buildSystemMessage(sessionId, defaultSkillPrompt);
            this.appendSessionMessage(sessionId, defaultSkillMessage);
        }
        const runtimeContextMessage = this.buildSystemMessage(sessionId, getRuntimeContext(this.projectRoot, promptToolOptions.model));
        this.appendSessionMessage(sessionId, runtimeContextMessage);
        const agentInstructions = this.loadAgentInstructions();
        if (agentInstructions) {
            const instructionsMessage = this.buildSystemMessage(sessionId, agentInstructions);
            this.appendSessionMessage(sessionId, instructionsMessage);
        }
        // Inject hierarchical project rules (.deepcode/rules/)
        const projectRules = this.loadProjectRules();
        if (projectRules) {
            const rulesMessage = this.buildSystemMessage(sessionId, projectRules);
            this.appendSessionMessage(sessionId, rulesMessage);
        }
        this.recordUserPromptCheckpoint(sessionId);
        const userMessage = this.buildUserMessage(sessionId, userPrompt);
        this.appendSessionMessage(sessionId, userMessage);
        if (userPrompt.text) {
            const skills = await this.listSkills();
            const skillNames = await this.identifyMatchingSkillNames(skills, userPrompt.text, { signal });
            this.throwIfAborted(signal);
            const skillSet = new Set(skillNames);
            const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
            if (Array.isArray(userPrompt.skills)) {
                userPrompt.skills.push(...matchedSkill);
            }
            else if (matchedSkill.length > 0) {
                userPrompt.skills = matchedSkill;
            }
        }
        userPrompt.skills = await this.normalizeSkills(userPrompt.skills);
        this.throwIfAborted(signal);
        this.appendSkillMessages(sessionId, userPrompt.skills);
        this.activeSessionId = sessionId;
        await this.activateSession(sessionId, controller);
        return sessionId;
    }
    async replySession(sessionId, userPrompt, controller) {
        const signal = controller?.signal;
        this.throwIfAborted(signal);
        appendProjectPermissionAllows(this.projectRoot, userPrompt.alwaysAllows, {
            inheritedPermissions: this.getResolvedSettings().permissions,
        });
        const now = new Date().toISOString();
        const updated = this.updateSessionEntry(sessionId, (entry) => ({
            ...entry,
            status: "pending",
            failReason: null,
            askPermissions: undefined,
            updateTime: now,
        }));
        if (!updated) {
            await this.createSession(userPrompt, controller);
            return;
        }
        if (hasUserPermissionReplies(userPrompt) && this.hasTrailingPendingToolCalls(sessionId)) {
            this.activeSessionId = sessionId;
            await this.activateSession(sessionId, controller, userPrompt);
            return;
        }
        if (this.isContinuePrompt(userPrompt)) {
            this.activeSessionId = sessionId;
            await this.activateSession(sessionId, controller, userPrompt);
            return;
        }
        this.reportNewPrompt();
        this.ensureFileHistorySession(sessionId);
        const checkpoint = this.recordUserPromptCheckpoint(sessionId);
        if (checkpoint.changedFilePaths.length) {
            const content = `Note that the user manually modified these files:\n${checkpoint.changedFilePaths.join("\n")}`;
            this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, content));
        }
        const userMessage = this.buildUserMessage(sessionId, userPrompt);
        this.appendSessionMessage(sessionId, userMessage);
        if (userPrompt.text) {
            const skills = await this.listSkills(sessionId);
            const skillNames = await this.identifyMatchingSkillNames(skills, userPrompt.text, { signal, sessionId });
            this.throwIfAborted(signal);
            const skillSet = new Set(skillNames);
            const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
            if (Array.isArray(userPrompt.skills)) {
                userPrompt.skills.push(...matchedSkill);
            }
            else if (matchedSkill.length > 0) {
                userPrompt.skills = matchedSkill;
            }
        }
        userPrompt.skills = await this.normalizeSkills(userPrompt.skills, sessionId);
        this.throwIfAborted(signal);
        this.appendSkillMessages(sessionId, userPrompt.skills);
        this.activeSessionId = sessionId;
        await this.activateSession(sessionId, controller);
    }
    isContinuePrompt(userPrompt) {
        return (typeof userPrompt.text === "string" &&
            userPrompt.text.trim() === "/continue" &&
            (!userPrompt.imageUrls || userPrompt.imageUrls.length === 0) &&
            (!userPrompt.skills || userPrompt.skills.length === 0));
    }
    async activateSession(sessionId, controller, permissionPrompt) {
        const startedAt = Date.now();
        const { client, model, baseURL, temperature, thinkingEnabled, reasoningEffort, debugLogEnabled, notify, env } = this.createOpenAIClient();
        const now = new Date().toISOString();
        rebuildSessionStateFromHistory(sessionId, this.listSessionMessages(sessionId));
        if (!client) {
            this.updateSessionEntry(sessionId, (entry) => ({
                ...entry,
                status: "failed",
                failReason: "API key not found",
                updateTime: now,
            }));
            this.onAssistantMessage(this.buildAssistantMessage(sessionId, "API key not found. Please configure ~/.deepcode/settings.json or ./.deepcode/settings.json.", null), false);
            this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
            return;
        }
        const sessionController = controller ?? new AbortController();
        if (sessionController.signal.aborted) {
            this.updateSessionEntry(sessionId, (entry) => ({
                ...entry,
                status: "interrupted",
                failReason: "interrupted",
                updateTime: now,
            }));
            this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
            return;
        }
        this.updateSessionEntry(sessionId, (entry) => ({
            ...entry,
            status: "processing",
            updateTime: now,
        }));
        this.sessionControllers.set(sessionId, sessionController);
        try {
            const maxIterations = 80000; // about 1K RMB cost
            let toolCalls = null;
            // Track error fix state across iterations
            const errorFixCounts = new Map();
            let lastToolExecutionHadFailures = false;
            for (let iteration = 0; iteration < maxIterations; iteration++) {
                if (this.isInterrupted(sessionId)) {
                    return;
                }
                const session = this.getSession(sessionId);
                if (session == null || session.status === "interrupted" || session.status === "failed") {
                    return;
                }
                const pendingToolCallMessage = this.messageConverter.getTrailingPendingToolCallMessage(this.listSessionMessages(sessionId));
                if (pendingToolCallMessage.toolCalls.length > 0) {
                    const toolAppendResult = await this.appendToolMessages(sessionId, pendingToolCallMessage.toolCalls, {
                        permissionOverrides: permissionPrompt?.permissions,
                        messagePermissions: pendingToolCallMessage.message?.meta?.permissions,
                    });
                    await this.appendDeferredPermissionPrompt(sessionId, permissionPrompt, sessionController);
                    // Permission replies are one-shot: do not reuse decisions or append the deferred user prompt again on later tool-call batches.
                    permissionPrompt = undefined;
                    if (this.isInterrupted(sessionId)) {
                        return;
                    }
                    if (toolAppendResult.waitingForUser) {
                        this.updateSessionEntry(sessionId, (entry) => ({
                            ...entry,
                            toolCalls: pendingToolCallMessage.toolCalls,
                            status: "waiting_for_user",
                            updateTime: new Date().toISOString(),
                        }));
                        return;
                    }
                }
                const compactPromptTokenThreshold = getCompactPromptTokenThreshold(model);
                if (session.activeTokens > compactPromptTokenThreshold) {
                    const message = this.buildAssistantMessage(sessionId, "The conversation is getting long, compacting...", null);
                    message.meta = { asThinking: true };
                    this.onAssistantMessage(message, false);
                    await this.compactSession(sessionId, sessionController.signal);
                }
                const messages = this.messageConverter.buildMessages(this.listSessionMessages(sessionId), thinkingEnabled, model);
                const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort);
                const response = await this.createChatCompletionStream(client, {
                    model,
                    ...(temperature !== undefined ? { temperature } : {}),
                    messages,
                    tools: getTools(this.getPromptToolOptions(), this.mcpToolDefinitions),
                    ...thinkingOptions,
                }, { signal: sessionController.signal }, sessionId, {
                    enabled: debugLogEnabled,
                    location: "SessionManager.activateSession",
                    baseURL,
                    params: { iteration, temperature, thinkingEnabled, reasoningEffort },
                });
                const message = response.choices?.[0]?.message;
                const rawContent = message?.content;
                const content = typeof rawContent === "string" ? rawContent : "";
                const rawToolCalls = message?.tool_calls ?? null;
                toolCalls = this.normalizeLlmToolCalls(rawToolCalls);
                const rawThinking = message?.reasoning_content;
                const thinking = typeof rawThinking === "string" ? rawThinking : null;
                const refusal = message?.refusal ?? null;
                // const html = content ? this.renderMarkdown(content) : "";
                if (this.isInterrupted(sessionId)) {
                    return;
                }
                const assistantMessage = this.buildAssistantMessage(sessionId, content, toolCalls, thinking);
                const permissionPlan = toolCalls
                    ? computeToolCallPermissions({
                        sessionId,
                        projectRoot: this.projectRoot,
                        toolCalls,
                        settings: this.getResolvedSettings().permissions,
                        readPermissionExemptPaths: this.getSkillScanRoots().map((entry) => entry.root),
                        resolveSnippetPath: (id, snippetId) => getSnippet(id, snippetId)?.filePath,
                    })
                    : null;
                if (permissionPlan) {
                    assistantMessage.meta = {
                        ...(assistantMessage.meta ?? {}),
                        permissions: permissionPlan.permissions,
                    };
                }
                this.appendSessionMessage(sessionId, assistantMessage);
                this.onAssistantMessage(assistantMessage, true);
                let waitingForUser = false;
                const responseUsage = response.usage ?? null;
                if (toolCalls) {
                    if (permissionPlan?.askPermissions.length) {
                        this.updateSessionEntry(sessionId, (entry) => ({
                            ...entry,
                            assistantReply: content,
                            assistantThinking: thinking,
                            assistantRefusal: refusal,
                            toolCalls,
                            usage: accumulateUsage(entry.usage, responseUsage),
                            usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
                            activeTokens: getTotalTokens(responseUsage),
                            status: "ask_permission",
                            failReason: null,
                            askPermissions: permissionPlan.askPermissions,
                            updateTime: new Date().toISOString(),
                        }));
                        return;
                    }
                    const toolAppendResult = await this.appendToolMessages(sessionId, toolCalls, {
                        messagePermissions: permissionPlan?.permissions,
                    });
                    waitingForUser = toolAppendResult.waitingForUser;
                    // Auto error fix: check if any tool executions failed
                    lastToolExecutionHadFailures = this.hasRecentToolExecutionFailure(this.listSessionMessages(sessionId));
                    if (lastToolExecutionHadFailures) {
                        // Track retry count across iterations
                        const errorKey = `error_at_iter_${iteration}`;
                        errorFixCounts.set(errorKey, (errorFixCounts.get(errorKey) ?? 0) + 1);
                    }
                }
                if (this.isInterrupted(sessionId)) {
                    return;
                }
                // After LLM response and tool execution: if there were failures and the LLM
                // responds WITHOUT tool calls (giving up), inject a fix reminder
                if (lastToolExecutionHadFailures && !toolCalls) {
                    const failedToolMessages = this.getFailedToolMessages(sessionId);
                    if (failedToolMessages.length > 0 && errorFixCounts.size <= 3) {
                        const fixReminder = this.buildSystemMessage(sessionId, `[Auto Error Fix] The previous command failed. Do NOT move on. Analyze the error above, fix the code, then re-run the command to verify. If you've already tried multiple approaches, explain the issue to the user.`);
                        this.appendSessionMessage(sessionId, fixReminder);
                        lastToolExecutionHadFailures = false;
                        continue; // Retry: let the LLM see the fix reminder and generate a fix
                    }
                }
                this.updateSessionEntry(sessionId, (entry) => ({
                    ...entry,
                    assistantReply: content,
                    assistantThinking: thinking,
                    assistantRefusal: refusal,
                    toolCalls,
                    usage: accumulateUsage(entry.usage, responseUsage),
                    usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
                    activeTokens: getTotalTokens(responseUsage),
                    status: refusal ? "failed" : waitingForUser ? "waiting_for_user" : toolCalls ? "processing" : "completed",
                    failReason: refusal ? refusal : entry.failReason,
                    askPermissions: undefined,
                    updateTime: new Date().toISOString(),
                }));
                if (refusal) {
                    return;
                }
                if (waitingForUser) {
                    return;
                }
                if (!toolCalls) {
                    return;
                }
            }
            this.updateSessionEntry(sessionId, (entry) => ({
                ...entry,
                status: "completed",
                updateTime: new Date().toISOString(),
            }));
            this.onAssistantMessage(this.buildAssistantMessage(sessionId, "The AI agent has taken several steps but hasn't reached a conclusion yet. Do you want to continue?", null), false);
        }
        catch (error) {
            const errMessage = error instanceof Error ? error.message : String(error);
            const aborted = this.isAbortLikeError(error) || sessionController.signal.aborted;
            if (!aborted) {
                fireHook(this.getResolvedSettings().hooks, "onError", { error: errMessage });
            }
            this.updateSessionEntry(sessionId, (entry) => ({
                ...entry,
                status: aborted ? "interrupted" : "failed",
                failReason: aborted ? "interrupted" : errMessage,
                updateTime: new Date().toISOString(),
            }));
            if (!aborted) {
                this.onAssistantMessage(this.buildAssistantMessage(sessionId, `Request failed: ${errMessage}`, null), false);
            }
        }
        finally {
            if (this.sessionControllers.get(sessionId) === sessionController) {
                this.sessionControllers.delete(sessionId);
            }
            this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
        }
    }
    async compactSession(sessionId, signal) {
        this.throwIfAborted(signal);
        const { client, model, baseURL, temperature, thinkingEnabled, reasoningEffort, debugLogEnabled } = this.createOpenAIClient();
        if (!client) {
            return;
        }
        const sessionMessages = this.listSessionMessages(sessionId).filter((message) => !message.compacted);
        if (sessionMessages.length === 0) {
            return;
        }
        const startIndex = sessionMessages.findIndex((message) => message.role !== "system");
        if (startIndex === -1) {
            return;
        }
        const searchStart = Math.floor(startIndex + ((sessionMessages.length - startIndex) * 2) / 3);
        let endIndex = -1;
        for (let i = Math.max(searchStart, startIndex); i < sessionMessages.length; i += 1) {
            if (sessionMessages[i].role !== "tool") {
                endIndex = i;
                break;
            }
        }
        if (endIndex === -1 || endIndex <= startIndex) {
            return;
        }
        const compactPrompt = getCompactPrompt(sessionMessages.slice(startIndex, endIndex));
        const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort);
        const response = await this.createChatCompletionStream(client, {
            model,
            ...(temperature !== undefined ? { temperature } : {}),
            messages: [{ role: "user", content: compactPrompt }],
            ...thinkingOptions,
        }, signal ? { signal } : undefined, sessionId, {
            enabled: debugLogEnabled,
            location: "SessionManager.compactSession",
            baseURL,
            params: { temperature, thinkingEnabled, reasoningEffort },
        });
        this.throwIfAborted(signal);
        const rawLlmResponse = response.choices?.[0]?.message?.content;
        const llmResponse = typeof rawLlmResponse === "string" ? rawLlmResponse : "";
        const compactedSummary = llmResponse.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim();
        const now = new Date().toISOString();
        const responseUsage = response.usage ?? null;
        this.updateSessionEntry(sessionId, (entry) => ({
            ...entry,
            usage: accumulateUsage(entry.usage, responseUsage),
            usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
            activeTokens: getTotalTokens(responseUsage),
            updateTime: now,
        }));
        for (let i = startIndex; i < endIndex; i += 1) {
            sessionMessages[i] = { ...sessionMessages[i], compacted: true, updateTime: now };
        }
        const summaryMessage = {
            id: crypto.randomUUID(),
            sessionId,
            role: "system",
            content: `There are earlier parts of the conversation. Here is a summary: \n\n${compactedSummary}`,
            contentParams: null,
            messageParams: null,
            compacted: false,
            visible: false,
            createTime: now,
            updateTime: now,
            meta: {
                isSummary: true,
            },
        };
        sessionMessages.splice(endIndex, 0, summaryMessage);
        this.saveSessionMessages(sessionId, sessionMessages);
    }
    getPromptToolOptions() {
        return {
            model: this.getResolvedSettings().model,
            webSearchEnabled: true,
        };
    }
    reportNewPrompt() {
        const { machineId, telemetryEnabled } = this.createOpenAIClient();
        reportNewPrompt({ enabled: telemetryEnabled ?? true, machineId });
    }
    interruptActiveSession() {
        const controller = this.activePromptController;
        if (controller && !controller.signal.aborted) {
            controller.abort();
        }
        const sessionId = this.activeSessionId;
        if (sessionId) {
            this.interruptSession(sessionId);
        }
    }
    interruptSession(sessionId) {
        const session = this.getSession(sessionId);
        const processIds = this.getProcessIds(session?.processes ?? null);
        const killedPids = [];
        const failedPids = [];
        for (const pid of processIds) {
            const processControlKey = this.getProcessControlKey(sessionId, pid);
            this.processTimeoutControls.delete(processControlKey);
            this.liveProcessKeys.delete(processControlKey);
            if (killProcessTree(pid, "SIGKILL")) {
                killedPids.push(pid);
                continue;
            }
            failedPids.push(pid);
        }
        const controller = this.sessionControllers.get(sessionId);
        if (controller) {
            controller.abort();
            this.sessionControllers.delete(sessionId);
        }
        const now = new Date().toISOString();
        this.updateSessionEntry(sessionId, (entry) => ({
            ...entry,
            status: "interrupted",
            failReason: "interrupted",
            processes: null,
            updateTime: now,
        }));
        const contentParts = ["Interrupted."];
        if (killedPids.length > 0) {
            contentParts.push(`Killed processes: ${killedPids.join(", ")}.`);
        }
        if (failedPids.length > 0) {
            contentParts.push(`Failed to kill processes: ${failedPids.join(", ")}.`);
        }
        this.onAssistantMessage(this.buildUserMessage(sessionId, { text: contentParts.join(" ") }), false);
    }
    isInterrupted(sessionId) {
        return !this.sessionControllers.has(sessionId);
    }
    /**
     * Mark a session's permission as denied by the user.
     * Updates the session entry status and failReason so the denial is visible in the session list.
     */
    denySessionPermission(sessionId, reason) {
        const now = new Date().toISOString();
        this.updateSessionEntry(sessionId, (entry) => ({
            ...entry,
            status: "permission_denied",
            failReason: reason ?? "Permission denied by user",
            updateTime: now,
        }));
    }
    adjustActiveBashTimeout(deltaMs) {
        const sessionId = this.activeSessionId;
        if (!sessionId || !Number.isFinite(deltaMs)) {
            return null;
        }
        const session = this.getSession(sessionId);
        if (!session?.processes) {
            return null;
        }
        let selectedPid = null;
        for (const pid of session.processes.keys()) {
            if (this.processTimeoutControls.has(this.getProcessControlKey(sessionId, pid))) {
                selectedPid = pid;
            }
        }
        if (!selectedPid) {
            return null;
        }
        const control = this.processTimeoutControls.get(this.getProcessControlKey(sessionId, selectedPid));
        if (!control) {
            return null;
        }
        const current = control.getInfo();
        const next = control.setTimeoutMs(current.timeoutMs + deltaMs);
        this.updateSessionProcessTimeout(sessionId, selectedPid, next);
        return this.buildBashTimeoutAdjustment(selectedPid, next);
    }
    listSessions() {
        const index = this.loadSessionsIndex();
        return index.entries;
    }
    getSession(sessionId) {
        const index = this.loadSessionsIndex();
        return index.entries.find((entry) => entry.id === sessionId) ?? null;
    }
    /**
     * Delete a session by its ID.
     * Removes the session entry from the index and cleans up associated resources
     * such as message files, in-memory state caches, working directory state,
     * session controllers, and tracked process timeout controls.
     * Returns true if the session was found and deleted, false otherwise.
     */
    deleteSession(sessionId) {
        const index = this.loadSessionsIndex();
        const targetEntry = index.entries.find((entry) => entry.id === sessionId) ?? null;
        const nextEntries = index.entries.filter((entry) => entry.id !== sessionId);
        if (nextEntries.length === index.entries.length) {
            return false;
        }
        index.entries = nextEntries;
        this.saveSessionsIndex(index);
        this.cleanupSessionResources(sessionId, {
            removeMessages: true,
            processIds: this.getProcessIds(targetEntry?.processes ?? null),
        });
        return true;
    }
    /**
     * Rename a session by updating its summary (display title).
     * Returns true if the session was found and renamed, false otherwise.
     */
    renameSession(sessionId, summary) {
        const trimmed = summary.trim();
        if (!trimmed) {
            return false;
        }
        const entry = this.getSession(sessionId);
        if (!entry) {
            return false;
        }
        this.updateSessionEntry(sessionId, (existing) => ({
            ...existing,
            summary: trimmed,
            updateTime: new Date().toISOString(),
        }));
        return true;
    }
    listSessionMessages(sessionId) {
        const messagePath = this.getSessionMessagesPath(sessionId);
        if (!fs.existsSync(messagePath)) {
            return [];
        }
        const raw = fs.readFileSync(messagePath, "utf8");
        const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
        const messages = [];
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line);
                messages.push(this.normalizeSessionMessage(parsed));
            }
            catch {
                // ignore malformed line
            }
        }
        return messages;
    }
    listUndoTargets(sessionId) {
        return this.listSessionMessages(sessionId)
            .map((message, index) => ({ message, index }))
            .filter(({ message }) => this.isUndoTargetMessage(message))
            .map(({ message, index }) => ({
            message,
            index,
            canRestoreCode: Boolean(message.checkpointHash && this.canRestoreCheckpointHash(sessionId, message.checkpointHash)),
        }));
    }
    restoreSessionConversation(sessionId, messageId) {
        const messages = this.listSessionMessages(sessionId);
        const targetIndex = messages.findIndex((message) => message.id === messageId);
        if (targetIndex === -1) {
            throw new Error("Selected message was not found in this session.");
        }
        const keptMessages = messages.slice(0, targetIndex);
        this.saveSessionMessages(sessionId, keptMessages);
        const now = new Date().toISOString();
        const latestAssistant = [...keptMessages].reverse().find((message) => message.role === "assistant");
        const latestAssistantParams = latestAssistant?.messageParams;
        this.updateSessionEntry(sessionId, (entry) => ({
            ...entry,
            assistantReply: latestAssistant?.content ?? null,
            assistantThinking: typeof latestAssistantParams?.reasoning_content === "string" ? latestAssistantParams.reasoning_content : null,
            assistantRefusal: null,
            toolCalls: null,
            status: "completed",
            failReason: null,
            processes: null,
            updateTime: now,
        }));
        return keptMessages;
    }
    restoreSessionCode(sessionId, messageId) {
        const message = this.listSessionMessages(sessionId).find((item) => item.id === messageId);
        if (!message) {
            throw new Error("Selected message was not found in this session.");
        }
        if (!message.checkpointHash) {
            throw new Error("Selected message has no code checkpoint.");
        }
        this.restoreCheckpointHash(sessionId, message.checkpointHash);
    }
    normalizeSessionMessage(message) {
        if (message.role !== "tool") {
            return message;
        }
        const nextMeta = message.meta ? { ...message.meta } : undefined;
        const normalizedParamsMd = this.buildToolParamsSnippet(nextMeta?.function ?? null);
        if (nextMeta && normalizedParamsMd) {
            nextMeta.paramsMd = normalizedParamsMd;
        }
        const normalizedResultMd = typeof message.content === "string" ? this.buildToolResultSnippet(message.content) : "";
        if (nextMeta && normalizedResultMd) {
            nextMeta.resultMd = normalizedResultMd;
        }
        return {
            ...message,
            visible: typeof message.content === "string" ? !this.isInvisibleExecution(message.content) : message.visible,
            meta: nextMeta,
        };
    }
    getProjectStorage() {
        const projectCode = getProjectCode(this.projectRoot);
        const projectDir = path.join(os.homedir(), ".deepcode", "projects", projectCode);
        const sessionsIndexPath = path.join(projectDir, "sessions-index.json");
        return { projectCode, projectDir, sessionsIndexPath };
    }
    getFileHistory() {
        return new GitFileHistory(this.projectRoot, this.getFileHistoryGitDir());
    }
    getFileHistoryGitDir() {
        const { projectDir } = this.getProjectStorage();
        return path.join(projectDir, "file-history", ".git");
    }
    ensureFileHistorySession(sessionId) {
        return this.getFileHistory().ensureSession(sessionId);
    }
    getCurrentCheckpointHash(sessionId) {
        return this.getFileHistory().getCurrentCheckpointHash(sessionId);
    }
    recordUserPromptCheckpoint(sessionId) {
        return this.getFileHistory().recordTrackedFilesCheckpoint(sessionId, "User prompt checkpoint");
    }
    prepareFileMutationCheckpoint(sessionId, filePath) {
        const fileHistory = this.getFileHistory();
        const previousHash = fileHistory.ensureSession(sessionId);
        if (!previousHash) {
            return;
        }
        this.updateLatestUserCheckpointHash(sessionId, undefined, previousHash);
        const nextHash = fileHistory.recordCheckpoint(sessionId, [filePath], "Pre-mutation checkpoint");
        if (nextHash && nextHash !== previousHash) {
            this.updateLatestUserCheckpointHash(sessionId, previousHash, nextHash);
        }
    }
    recordFileMutationCheckpoint(sessionId, filePath) {
        const fileHistory = this.getFileHistory();
        fileHistory.ensureSession(sessionId);
        fileHistory.recordCheckpoint(sessionId, [filePath], "File mutation checkpoint");
    }
    updateLatestUserCheckpointHash(sessionId, previousHash, nextHash) {
        const messages = this.listSessionMessages(sessionId);
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            if (!message || !this.isUndoTargetMessage(message)) {
                continue;
            }
            if (message.checkpointHash && message.checkpointHash !== previousHash) {
                return;
            }
            messages[index] = {
                ...message,
                checkpointHash: nextHash,
                updateTime: new Date().toISOString(),
            };
            this.saveSessionMessages(sessionId, messages);
            return;
        }
    }
    canRestoreCheckpointHash(sessionId, checkpointHash) {
        return this.getFileHistory().canRestore(sessionId, checkpointHash);
    }
    restoreCheckpointHash(sessionId, checkpointHash) {
        this.getFileHistory().restore(sessionId, checkpointHash);
    }
    isUndoTargetMessage(message) {
        return message.role === "user" && message.visible && !message.compacted;
    }
    ensureProjectDir() {
        const { projectDir } = this.getProjectStorage();
        fs.mkdirSync(projectDir, { recursive: true });
        return projectDir;
    }
    loadSessionsIndex() {
        const { sessionsIndexPath } = this.getProjectStorage();
        this.ensureProjectDir();
        if (!fs.existsSync(sessionsIndexPath)) {
            return { version: 1, entries: [], originalPath: this.projectRoot };
        }
        try {
            const raw = fs.readFileSync(sessionsIndexPath, "utf8");
            const parsed = JSON.parse(raw);
            const entries = Array.isArray(parsed.entries)
                ? parsed.entries.map((entry) => this.normalizeSessionEntry(entry))
                : [];
            return {
                version: 1,
                entries,
                originalPath: parsed.originalPath || this.projectRoot,
            };
        }
        catch {
            return { version: 1, entries: [], originalPath: this.projectRoot };
        }
    }
    saveSessionsIndex(index) {
        const { sessionsIndexPath } = this.getProjectStorage();
        this.ensureProjectDir();
        const normalized = {
            version: 1,
            entries: index.entries.map((entry) => ({
                ...entry,
                processes: this.serializeProcesses(entry.processes),
            })),
            originalPath: this.projectRoot,
        };
        fs.writeFileSync(sessionsIndexPath, JSON.stringify(normalized, null, 2), "utf8");
    }
    getSessionMessagesPath(sessionId) {
        const { projectDir } = this.getProjectStorage();
        return path.join(projectDir, `${sessionId}.jsonl`);
    }
    removeSessionMessages(sessionIds) {
        for (const sessionId of sessionIds) {
            const messagePath = this.getSessionMessagesPath(sessionId);
            try {
                if (fs.existsSync(messagePath)) {
                    fs.unlinkSync(messagePath);
                }
            }
            catch {
                // ignore delete failures
            }
        }
    }
    cleanupSessionResources(sessionId, options) {
        const processIds = options.processIds ?? [];
        for (const pid of processIds) {
            const processControlKey = this.getProcessControlKey(sessionId, pid);
            if (!this.processTimeoutControls.has(processControlKey) && !this.liveProcessKeys.has(processControlKey)) {
                continue;
            }
            this.killTrackedProcess(processControlKey, pid);
        }
        clearSessionState(sessionId);
        clearSessionWorkingDir(sessionId);
        const controller = this.sessionControllers.get(sessionId);
        if (controller && !controller.signal.aborted) {
            controller.abort();
        }
        this.sessionControllers.delete(sessionId);
        if (options.removeMessages) {
            this.removeSessionMessages([sessionId]);
        }
    }
    appendSessionMessage(sessionId, message) {
        this.ensureProjectDir();
        const messagePath = this.getSessionMessagesPath(sessionId);
        fs.appendFileSync(messagePath, `${JSON.stringify(message)}\n`, "utf8");
    }
    saveSessionMessages(sessionId, messages) {
        this.ensureProjectDir();
        const messagePath = this.getSessionMessagesPath(sessionId);
        const payload = messages.map((message) => JSON.stringify(message)).join("\n");
        fs.writeFileSync(messagePath, payload ? `${payload}\n` : "", "utf8");
    }
    updateSessionEntry(sessionId, updater) {
        const index = this.loadSessionsIndex();
        const entryIndex = index.entries.findIndex((entry) => entry.id === sessionId);
        if (entryIndex === -1) {
            return null;
        }
        const updated = updater({ ...index.entries[entryIndex] });
        index.entries[entryIndex] = updated;
        this.saveSessionsIndex(index);
        this.onSessionEntryUpdated?.(updated);
        return updated;
    }
    buildUserMessage(sessionId, prompt) {
        const now = new Date().toISOString();
        const imageParams = prompt.imageUrls
            ?.filter((url) => Boolean(url))
            .map((url) => ({
            type: "image_url",
            image_url: { url },
        })) ?? [];
        return {
            id: crypto.randomUUID(),
            sessionId,
            role: "user",
            content: prompt.text ?? "",
            contentParams: imageParams.length > 0 ? imageParams : null,
            messageParams: null,
            compacted: false,
            visible: true,
            createTime: now,
            updateTime: now,
            meta: { userPrompt: this.cloneUserPromptForMeta(prompt) },
            checkpointHash: this.getCurrentCheckpointHash(sessionId),
        };
    }
    renderInitCommandPrompt() {
        const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "init_command.md.ejs");
        const template = fs.readFileSync(templatePath, "utf8");
        return ejs.render(template, {
            agentsMdFile: this.getEffectiveProjectAgentsMdFile(),
        });
    }
    getEffectiveProjectAgentsMdFile() {
        return this.loadProjectAgentInstructions()?.displayPath ?? null;
    }
    loadProjectAgentInstructions() {
        const candidatePaths = [
            {
                absolutePath: path.join(this.projectRoot, ".deepcode", "AGENTS.md"),
                displayPath: "./.deepcode/AGENTS.md",
            },
            {
                absolutePath: path.join(this.projectRoot, "AGENTS.md"),
                displayPath: "./AGENTS.md",
            },
        ];
        for (const candidatePath of candidatePaths) {
            const content = this.readNonEmptyFile(candidatePath.absolutePath);
            if (content) {
                return {
                    content,
                    displayPath: candidatePath.displayPath,
                };
            }
        }
        return null;
    }
    readNonEmptyFile(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                return null;
            }
            const content = fs.readFileSync(filePath, "utf8").trim();
            return content || null;
        }
        catch {
            return null;
        }
    }
    loadAgentInstructions() {
        const projectInstructions = this.loadProjectAgentInstructions();
        if (projectInstructions) {
            return projectInstructions.content;
        }
        return this.readNonEmptyFile(path.join(os.homedir(), ".deepcode", "AGENTS.md"));
    }
    /**
     * Load hierarchical rules from .deepcode/rules/ directory.
     * Each .md file becomes a named rule section injected into system context.
     * Supports subdirectory-based scoping (e.g., rules/api/*.md, rules/db/*.md).
     */
    loadProjectRules() {
        const rulesDir = path.join(this.projectRoot, ".deepcode", "rules");
        if (!fs.existsSync(rulesDir)) {
            return null;
        }
        const sections = [];
        const collectRules = (dir, scope) => {
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            }
            catch {
                return;
            }
            // Sort: files first, then directories, alphabetical
            entries.sort((a, b) => {
                if (a.isDirectory() !== b.isDirectory()) {
                    return a.isDirectory() ? 1 : -1;
                }
                return a.name.localeCompare(b.name);
            });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    collectRules(fullPath, path.join(scope, entry.name));
                    continue;
                }
                if (!entry.name.endsWith(".md")) {
                    continue;
                }
                const content = this.readNonEmptyFile(fullPath);
                if (!content) {
                    continue;
                }
                const ruleName = entry.name.replace(/\.md$/, "");
                const ruleHeader = scope ? `${scope}/${ruleName}` : ruleName;
                sections.push(`### Rule: ${ruleHeader}\n\n${content}`);
            }
        };
        collectRules(rulesDir, "");
        if (sections.length === 0) {
            return null;
        }
        return `# Project Rules\n\n${sections.join("\n\n")}`;
    }
    buildSystemMessage(sessionId, content, contentParams = null, visible = false, meta) {
        const now = new Date().toISOString();
        return {
            id: crypto.randomUUID(),
            sessionId,
            role: "system",
            content,
            contentParams,
            messageParams: null,
            compacted: false,
            visible,
            createTime: now,
            updateTime: now,
            meta,
        };
    }
    buildSkillMessage(sessionId, content, skill) {
        const now = new Date().toISOString();
        return {
            id: crypto.randomUUID(),
            sessionId,
            role: "system",
            content,
            contentParams: null,
            messageParams: null,
            compacted: false,
            visible: true,
            createTime: now,
            updateTime: now,
            meta: { skill: { ...skill, isLoaded: true } },
        };
    }
    buildAssistantMessage(sessionId, content, toolCalls, reasoningContent) {
        const now = new Date().toISOString();
        const hasReasoningContent = reasoningContent != null;
        const messageParams = toolCalls || hasReasoningContent ? {} : null;
        if (toolCalls) {
            messageParams.tool_calls = toolCalls;
        }
        if (hasReasoningContent) {
            messageParams.reasoning_content = reasoningContent;
        }
        return {
            id: crypto.randomUUID(),
            sessionId,
            role: "assistant",
            content,
            contentParams: null,
            messageParams,
            compacted: false,
            visible: (content || reasoningContent || "").trim() ? true : false,
            createTime: now,
            updateTime: now,
            meta: toolCalls ? { asThinking: true } : undefined,
        };
    }
    generateToolCallId() {
        return crypto.randomBytes(16).toString("hex");
    }
    normalizeLlmToolCalls(rawToolCalls) {
        if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) {
            return null;
        }
        return rawToolCalls.map((toolCall) => {
            if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
                return toolCall;
            }
            const record = toolCall;
            const id = typeof record.id === "string" ? record.id.trim() : "";
            if (id) {
                return toolCall;
            }
            return {
                ...record,
                id: this.generateToolCallId(),
            };
        });
    }
    buildToolMessage(sessionId, toolCallId, content, toolFunction) {
        const now = new Date().toISOString();
        const paramsMd = this.buildToolParamsSnippet(toolFunction);
        const resultMd = this.buildToolResultSnippet(content);
        const isInvisibleExecution = this.isInvisibleExecution(content);
        return {
            id: crypto.randomUUID(),
            sessionId,
            role: "tool",
            content,
            contentParams: null,
            messageParams: { tool_call_id: toolCallId },
            compacted: false,
            visible: !isInvisibleExecution,
            createTime: now,
            updateTime: now,
            meta: {
                function: toolFunction ?? undefined,
                paramsMd,
                resultMd,
            },
        };
    }
    async appendToolMessages(sessionId, toolCalls, options = {}) {
        const settings = this.getResolvedSettings();
        const hooks = {
            onProcessStart: (pid, command) => {
                this.addSessionProcess(sessionId, pid, command);
                fireHook(settings.hooks, "beforeCommand", { command });
            },
            onProcessExit: (pid) => this.removeSessionProcess(sessionId, pid),
            onProcessStdout: (pid, chunk) => this.onProcessStdout?.(Number(pid), chunk),
            onProcessTimeoutControl: (pid, control) => this.setSessionProcessTimeoutControl(sessionId, pid, control),
            onBackgroundProcessComplete: (completion) => this.addBackgroundProcessCompletionMessage(sessionId, completion),
            onBeforeFileMutation: (filePath) => {
                this.prepareFileMutationCheckpoint(sessionId, filePath);
                fireHook(settings.hooks, "beforeWrite", { filePath });
            },
            onAfterFileMutation: (filePath) => {
                this.recordFileMutationCheckpoint(sessionId, filePath);
                fireHook(settings.hooks, "afterWrite", { filePath });
            },
            shouldStop: () => this.isInterrupted(sessionId),
        };
        const parsedToolCalls = toolCalls
            .map((toolCall) => parseToolCallForPermissions(toolCall))
            .filter((toolCall) => Boolean(toolCall));
        const toolExecutions = [];
        for (const toolCall of parsedToolCalls) {
            if (hooks.shouldStop?.()) {
                break;
            }
            const blockedResult = buildPermissionToolExecution(toolCall, options);
            if (blockedResult) {
                toolExecutions.push(blockedResult);
                continue;
            }
            const executions = await this.toolExecutor.executeToolCalls(sessionId, [toolCall], hooks);
            toolExecutions.push(...executions);
        }
        if (this.isInterrupted(sessionId)) {
            return { waitingForUser: false };
        }
        let waitingForUser = false;
        const followUpMessages = [];
        for (const execution of toolExecutions) {
            if (execution.result.awaitUserResponse === true) {
                waitingForUser = true;
            }
            const toolFunction = this.messageConverter.findToolFunction(toolCalls, execution.toolCallId);
            const toolMessage = this.buildToolMessage(sessionId, execution.toolCallId, execution.content, toolFunction);
            this.appendSessionMessage(sessionId, toolMessage);
            this.onAssistantMessage(toolMessage, true);
            for (const followUpMessage of execution.result.followUpMessages ?? []) {
                if (followUpMessage.role !== "system") {
                    continue;
                }
                followUpMessages.push(this.buildSystemMessage(sessionId, followUpMessage.content, followUpMessage.contentParams ?? null));
            }
        }
        for (const followUpMessage of followUpMessages) {
            this.appendSessionMessage(sessionId, followUpMessage);
        }
        return { waitingForUser };
    }
    cloneUserPromptForMeta(prompt) {
        return {
            text: prompt.text,
            imageUrls: prompt.imageUrls ? [...prompt.imageUrls] : undefined,
            skills: prompt.skills ? prompt.skills.map((skill) => ({ ...skill })) : undefined,
            permissions: prompt.permissions ? prompt.permissions.map((permission) => ({ ...permission })) : undefined,
            alwaysAllows: prompt.alwaysAllows ? [...prompt.alwaysAllows] : undefined,
        };
    }
    hasTrailingPendingToolCalls(sessionId) {
        return (this.messageConverter.getTrailingPendingToolCallMessage(this.listSessionMessages(sessionId)).toolCalls.length > 0);
    }
    async appendDeferredPermissionPrompt(sessionId, userPrompt, controller) {
        if (!userPrompt || this.isContinuePrompt(userPrompt)) {
            return;
        }
        const text = userPrompt.text ?? "";
        const hasUserContent = text.trim().length > 0 ||
            (Array.isArray(userPrompt.imageUrls) && userPrompt.imageUrls.length > 0) ||
            (Array.isArray(userPrompt.skills) && userPrompt.skills.length > 0);
        if (!hasUserContent) {
            return;
        }
        this.reportNewPrompt();
        const signal = controller.signal;
        const userMessage = this.buildUserMessage(sessionId, userPrompt);
        this.appendSessionMessage(sessionId, userMessage);
        if (userPrompt.text) {
            const skills = await this.listSkills(sessionId);
            const skillNames = await this.identifyMatchingSkillNames(skills, userPrompt.text, { signal, sessionId });
            this.throwIfAborted(signal);
            const skillSet = new Set(skillNames);
            const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
            if (Array.isArray(userPrompt.skills)) {
                userPrompt.skills.push(...matchedSkill);
            }
            else if (matchedSkill.length > 0) {
                userPrompt.skills = matchedSkill;
            }
        }
        userPrompt.skills = await this.normalizeSkills(userPrompt.skills, sessionId);
        this.throwIfAborted(signal);
        this.appendSkillMessages(sessionId, userPrompt.skills);
    }
    /**
     * Check if the most recent tool execution messages contain failures.
     * Looks at the last batch of tool-call result messages for any with ok:false.
     */
    hasRecentToolExecutionFailure(messages) {
        // Only check the most recent tool messages (after the last non-tool message)
        let foundToolMessages = false;
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role !== "tool") {
                break; // Stop at the first non-tool message from the end
            }
            foundToolMessages = true;
            if (msg.content) {
                try {
                    const parsed = JSON.parse(msg.content);
                    if (parsed && typeof parsed === "object" && parsed.ok === false) {
                        return true;
                    }
                }
                catch {
                    // Not JSON, skip
                }
            }
        }
        return foundToolMessages; // false if no tool messages at all
    }
    /**
     * Get the list of failed tool messages for error reporting.
     */
    getFailedToolMessages(sessionId) {
        const messages = this.listSessionMessages(sessionId);
        const failed = [];
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role !== "tool") {
                break;
            }
            if (msg.content) {
                try {
                    const parsed = JSON.parse(msg.content);
                    if (parsed && typeof parsed === "object" && parsed.ok === false) {
                        const errorMsg = parsed.error ?? parsed.output ?? "Unknown error";
                        const name = parsed.name ?? "unknown";
                        failed.push(`${name}: ${String(errorMsg).slice(0, 200)}`);
                    }
                }
                catch {
                    // skip
                }
            }
        }
        return failed;
    }
    buildToolParamsSnippet(toolFunction) {
        if (!toolFunction || typeof toolFunction !== "object") {
            return "";
        }
        const args = toolFunction.arguments;
        const toolName = toolFunction.name;
        if (typeof args !== "string") {
            return "";
        }
        const trimmed = args.trim();
        if (!trimmed) {
            return "";
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return this.formatToolParamsSnippet(typeof toolName === "string" ? toolName : null, parsed);
            }
        }
        catch {
            // fall back to raw string
        }
        return trimmed;
    }
    formatToolParamsSnippet(toolName, args) {
        if (toolName === "bash") {
            const command = typeof args.command === "string" ? args.command.trim() : "";
            const description = typeof args.description === "string" ? args.description.trim() : "";
            if (command && description) {
                return `${command}  # ${description}`;
            }
            if (command) {
                return command;
            }
            if (description) {
                return description;
            }
        }
        else if (toolName === "UpdatePlan") {
            return typeof args.explanation === "string" ? args.explanation.trim() : "";
        }
        else if (toolName === "write") {
            return typeof args.file_path === "string" ? args.file_path.trim() : "";
        }
        else if (toolName === "edit") {
            const filePath = typeof args.file_path === "string" ? args.file_path.trim() : "";
            if (filePath) {
                return filePath;
            }
            return typeof args.snippet_id === "string" ? args.snippet_id.trim() : "";
        }
        const firstKey = Object.keys(args)[0];
        if (!firstKey) {
            return "";
        }
        const value = args[firstKey];
        const text = typeof value === "string" ? value : JSON.stringify(value);
        if (toolName === "read" && text.startsWith(this.projectRoot)) {
            return text.slice(this.projectRoot.length).replace(/^[\\/]/, "");
        }
        return text;
    }
    buildToolResultSnippet(content) {
        const trimmed = content.trim();
        if (!trimmed) {
            return "";
        }
        const maxLength = 2000;
        try {
            const parsed = JSON.parse(content);
            if (parsed.output !== undefined) {
                if (typeof parsed.output === "string") {
                    return this.formatToolResultSnippet(parsed.output, maxLength);
                }
                return this.formatToolResultSnippet(JSON.stringify(parsed.output), maxLength);
            }
        }
        catch {
            // fall back to raw content
        }
        return this.formatToolResultSnippet(content, maxLength);
    }
    formatToolResultSnippet(value, maxLength) {
        if (value.length <= maxLength) {
            return value;
        }
        return `${value.slice(0, maxLength)}... (total ${value.length} chars)`;
    }
    isInvisibleExecution(content) {
        if (!content.trim()) {
            return false;
        }
        try {
            const parsed = JSON.parse(content);
            return parsed.name === "bash" && parsed.ok !== true;
        }
        catch {
            return false;
        }
    }
    maybeNotifyTaskCompletion(sessionId, notifyCommand, startedAt, configuredEnv = {}) {
        if (!notifyCommand) {
            return;
        }
        const session = this.getSession(sessionId);
        if (!session || (session.status !== "completed" && session.status !== "failed")) {
            return;
        }
        // Find the last assistant message body for the BODY env variable.
        let body;
        const messages = this.listSessionMessages(sessionId);
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg && msg.role === "assistant" && msg.content) {
                body = msg.content;
                break;
            }
        }
        launchNotifyScript(notifyCommand, Date.now() - startedAt, this.projectRoot, undefined, configuredEnv, {
            status: session.status,
            failReason: session.failReason ?? undefined,
            body,
            title: session.summary ?? undefined,
        });
    }
    addSessionProcess(sessionId, processId, command) {
        const now = new Date().toISOString();
        this.liveProcessKeys.add(this.getProcessControlKey(sessionId, processId));
        this.updateSessionEntry(sessionId, (entry) => {
            const processes = new Map(entry.processes ?? []);
            processes.set(String(processId), { startTime: now, command });
            return {
                ...entry,
                processes,
                updateTime: now,
            };
        });
    }
    addBackgroundProcessCompletionMessage(sessionId, completion) {
        const status = completion.ok ? "completed" : "failed";
        const exitText = completion.exitCode !== null
            ? `exit code ${completion.exitCode}`
            : completion.signal
                ? `signal ${completion.signal}`
                : completion.error || "unknown status";
        const durationMs = Math.max(0, completion.completedAtMs - completion.startedAtMs);
        const baseContent = `Background command "${completion.command}" ${status} with ${exitText} ` +
            `after ${this.formatBackgroundDuration(durationMs)}. Output: ${completion.outputPath}`;
        const logTail = completion.ok ? null : this.buildBackgroundFailureLogTailSlice(completion.outputPath);
        const content = logTail ? `${baseContent}\n${logTail}` : baseContent;
        this.addSessionSystemMessage(sessionId, content, true);
    }
    buildBackgroundFailureLogTailSlice(outputPath) {
        const tail = this.readTextFileTail(outputPath, BACKGROUND_FAILURE_LOG_TAIL_CHARS);
        if (!tail || !tail.content) {
            return null;
        }
        const prefix = tail.truncated ? `(${tail.totalBytes} bytes)...\n` : "";
        return [
            `<background_task_failure_log path="${outputPath}">`,
            `${prefix}${tail.content}`,
            "</background_task_failure_log>",
        ].join("\n");
    }
    readTextFileTail(filePath, maxChars) {
        try {
            const stat = fs.statSync(filePath);
            if (!stat.isFile() || stat.size <= 0) {
                return null;
            }
            const content = readTextFileWithMetadata(filePath).content;
            return {
                content: content.slice(-maxChars).trimEnd(),
                totalBytes: stat.size,
                truncated: content.length > maxChars,
            };
        }
        catch {
            return null;
        }
    }
    formatBackgroundDuration(durationMs) {
        if (durationMs < 1000) {
            return `${durationMs}ms`;
        }
        const seconds = Math.round(durationMs / 1000);
        if (seconds < 60) {
            return `${seconds}s`;
        }
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    removeSessionProcess(sessionId, processId) {
        const now = new Date().toISOString();
        const processControlKey = this.getProcessControlKey(sessionId, processId);
        this.processTimeoutControls.delete(processControlKey);
        this.liveProcessKeys.delete(processControlKey);
        this.updateSessionEntry(sessionId, (entry) => {
            const processes = new Map(entry.processes ?? []);
            processes.delete(String(processId));
            return {
                ...entry,
                processes: processes.size > 0 ? processes : null,
                updateTime: now,
            };
        });
    }
    setSessionProcessTimeoutControl(sessionId, processId, control) {
        const key = this.getProcessControlKey(sessionId, processId);
        if (!control) {
            this.processTimeoutControls.delete(key);
            return;
        }
        this.processTimeoutControls.set(key, control);
        this.updateSessionProcessTimeout(sessionId, processId, control.getInfo());
    }
    updateSessionProcessTimeout(sessionId, processId, info) {
        const now = new Date().toISOString();
        this.updateSessionEntry(sessionId, (entry) => {
            const processes = new Map(entry.processes ?? []);
            const pid = String(processId);
            const processInfo = processes.get(pid);
            if (!processInfo) {
                return entry;
            }
            processes.set(pid, {
                ...processInfo,
                timeoutMs: info.timeoutMs,
                deadlineAt: new Date(info.deadlineAtMs).toISOString(),
                timedOut: info.timedOut,
            });
            return {
                ...entry,
                processes,
                updateTime: now,
            };
        });
    }
    buildBashTimeoutAdjustment(processId, info) {
        return {
            processId,
            timeoutMs: info.timeoutMs,
            deadlineAt: new Date(info.deadlineAtMs).toISOString(),
            timedOut: info.timedOut,
        };
    }
    getProcessControlKey(sessionId, processId) {
        return `${sessionId}:${String(processId)}`;
    }
    killLiveProcesses() {
        for (const processControlKey of Array.from(this.liveProcessKeys)) {
            const processId = this.getProcessIdFromControlKey(processControlKey);
            if (processId === null) {
                this.liveProcessKeys.delete(processControlKey);
                continue;
            }
            this.killTrackedProcess(processControlKey, processId);
        }
    }
    killTrackedProcess(processControlKey, processId) {
        const killedGroup = killProcessTree(processId, "SIGKILL");
        if (!killedGroup) {
            try {
                process.kill(processId, "SIGKILL");
            }
            catch {
                // Ignore process-kill failures during cleanup.
            }
        }
        this.processTimeoutControls.delete(processControlKey);
        this.liveProcessKeys.delete(processControlKey);
    }
    getProcessIdFromControlKey(processControlKey) {
        const separatorIndex = processControlKey.lastIndexOf(":");
        const rawProcessId = separatorIndex >= 0 ? processControlKey.slice(separatorIndex + 1) : processControlKey;
        const processId = Number(rawProcessId);
        return Number.isInteger(processId) && processId > 0 ? processId : null;
    }
    getProcessIds(processes) {
        if (!processes) {
            return [];
        }
        const ids = [];
        for (const pid of processes.keys()) {
            const parsed = Number(pid);
            if (Number.isInteger(parsed) && parsed > 0) {
                ids.push(parsed);
            }
        }
        return ids;
    }
    normalizeSessionEntry(entry) {
        const value = entry && typeof entry === "object" ? entry : {};
        return {
            id: typeof value.id === "string" ? value.id : crypto.randomUUID(),
            summary: typeof value.summary === "string" ? value.summary : null,
            assistantReply: typeof value.assistantReply === "string" ? value.assistantReply : null,
            assistantThinking: typeof value.assistantThinking === "string" ? value.assistantThinking : null,
            assistantRefusal: typeof value.assistantRefusal === "string" ? value.assistantRefusal : null,
            toolCalls: Array.isArray(value.toolCalls) ? value.toolCalls : null,
            status: this.normalizeSessionStatus(value.status),
            failReason: typeof value.failReason === "string" ? value.failReason : null,
            usage: value.usage ?? null,
            usagePerModel: this.normalizeUsagePerModel(value),
            activeTokens: typeof value.activeTokens === "number" ? value.activeTokens : 0,
            createTime: typeof value.createTime === "string" ? value.createTime : new Date().toISOString(),
            updateTime: typeof value.updateTime === "string" ? value.updateTime : new Date().toISOString(),
            processes: this.deserializeProcesses(value.processes),
            askPermissions: normalizeAskPermissions(value.askPermissions),
        };
    }
    normalizeSessionStatus(status) {
        if (status === "failed" ||
            status === "pending" ||
            status === "processing" ||
            status === "waiting_for_user" ||
            status === "completed" ||
            status === "interrupted" ||
            status === "ask_permission" ||
            status === "permission_denied") {
            return status;
        }
        return "pending";
    }
    normalizeUsagePerModel(entry) {
        if (!Object.prototype.hasOwnProperty.call(entry, "usagePerModel")) {
            return null;
        }
        if (!isUsageRecord(entry.usagePerModel)) {
            return null;
        }
        const usagePerModel = {};
        for (const [model, usage] of Object.entries(entry.usagePerModel)) {
            if (!model || !isUsageRecord(usage)) {
                continue;
            }
            usagePerModel[model] = usage;
        }
        return usagePerModel;
    }
    deserializeProcesses(value) {
        if (!value || typeof value !== "object") {
            return null;
        }
        const processes = new Map();
        for (const [pid, entry] of Object.entries(value)) {
            if (!pid) {
                continue;
            }
            if (typeof entry === "string") {
                // Backward compatibility for old format where just stored start time
                processes.set(pid, { startTime: entry, command: "Running process..." });
            }
            else if (typeof entry === "object" && entry !== null) {
                const obj = entry;
                const startTime = typeof obj.startTime === "string" ? obj.startTime : new Date().toISOString();
                const command = typeof obj.command === "string" ? obj.command : "Running process...";
                processes.set(pid, {
                    startTime,
                    command,
                    timeoutMs: typeof obj.timeoutMs === "number" ? obj.timeoutMs : undefined,
                    deadlineAt: typeof obj.deadlineAt === "string" ? obj.deadlineAt : undefined,
                    timedOut: typeof obj.timedOut === "boolean" ? obj.timedOut : undefined,
                });
            }
        }
        return processes.size > 0 ? processes : null;
    }
    serializeProcesses(processes) {
        if (!processes || processes.size === 0) {
            return null;
        }
        const serialized = {};
        for (const [pid, entry] of processes.entries()) {
            serialized[pid] = entry;
        }
        return serialized;
    }
}
