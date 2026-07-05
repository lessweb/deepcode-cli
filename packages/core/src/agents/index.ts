// Agent subsystem — discovery, delegation, and isolated execution.

// AgentRegistry
export type { AgentManifest, AgentScanRoot } from "./agent-registry";
export { AgentRegistry } from "./agent-registry";

// SubAgentSession
export type {
  SubAgentOptions,
  SubAgentResult,
  SubAgentProgressEvent,
  SubAgentProgressCallback,
} from "./sub-agent-session";
export { SubAgentSession } from "./sub-agent-session";

// DelegateToAgent tool handler
export type { DelegateToAgentArgs, DelegateToAgentResult, DelegateHandlerOptions } from "./delegate-handler";
export { createDelegateToAgentHandler } from "./delegate-handler";

// Skill resolver
export type { ResolvedSkill, SkillResolverOptions } from "./skill-resolver";
export { resolveAgentSkills } from "./skill-resolver";

// Format helpers
export { formatAgentsList } from "./format-agents";
