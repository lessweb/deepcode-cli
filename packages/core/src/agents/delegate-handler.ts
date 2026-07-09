import type { AgentRegistry } from "./agent-registry";
import { SubAgentSession } from "./sub-agent-session";
import type { SubAgentProgressCallback } from "./sub-agent-session";
import { resolveAgentSkills } from "./skill-resolver";
import type { CreateOpenAIClient } from "../common/tool-types";
import type { ToolExecutor } from "../tools/executor";

export type DelegateToAgentArgs = {
  agent_name: string;
  task: string;
};

export type DelegateToAgentResult = {
  ok: boolean;
  output?: string;
  error?: string;
};

export type DelegateHandlerOptions = {
  agentRegistry: AgentRegistry;
  projectRoot: string;
  parentModel: string;
  createOpenAIClient: CreateOpenAIClient;
  toolExecutor: ToolExecutor;
  globalSkillRoots: string[];
  onProgress?: SubAgentProgressCallback;
};

export function createDelegateToAgentHandler(options: DelegateHandlerOptions) {
  return async function handleDelegateToAgent(args: Record<string, unknown>): Promise<DelegateToAgentResult> {
    const agentName = typeof args.agent_name === "string" ? args.agent_name : "";
    const task = typeof args.task === "string" ? args.task : "";

    if (!agentName) {
      return { ok: false, error: "Missing required parameter: agent_name" };
    }

    const manifest = options.agentRegistry.getAgent(agentName);
    if (!manifest) {
      const available = options.agentRegistry
        .listAgents()
        .map((a) => a.name)
        .join(", ");
      return { ok: false, error: `Agent "${agentName}" not found. Available agents: ${available}` };
    }

    if (!task) {
      return { ok: false, error: "Missing required parameter: task" };
    }

    // Resolve skills for the agent
    const resolvedSkills = resolveAgentSkills({
      manifest,
      globalSkillRoots: options.globalSkillRoots,
    });
    const resolvedSkillPrompts = resolvedSkills.map((s) => s.content);

    const session = new SubAgentSession({
      manifest,
      task,
      projectRoot: options.projectRoot,
      parentModel: options.parentModel,
      createOpenAIClient: options.createOpenAIClient,
      resolvedSkillPrompts,
      toolExecutor: options.toolExecutor,
      onProgress: options.onProgress,
    });

    const result = await session.execute();

    if (!result.ok) {
      return { ok: false, error: result.error ?? "Sub-agent execution failed" };
    }

    return { ok: true, output: result.response };
  };
}
