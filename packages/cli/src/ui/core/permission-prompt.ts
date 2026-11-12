import type {
  AskPermissionRequest,
  AskPermissionScope,
  PermissionReply,
  PermissionScope,
  UserToolPermission,
} from "@vegamo/deepcode-core";

export type PermissionChoice = "allow" | "session" | "always" | "deny";
export type PermissionAnswers = Partial<Record<number, PermissionChoice>>;
export type PermissionPromptResult = Required<PermissionReply>;
export type ScopePrompt = { request: AskPermissionRequest; scope: AskPermissionScope };

export function buildScopePrompts(requests: AskPermissionRequest[]): ScopePrompt[] {
  return requests.flatMap((request) =>
    (request.scopes.length ? request.scopes : ["unknown" as const]).map((scope) => ({ request, scope }))
  );
}

/** Derive the next question and reply from the choices made in this batch. */
export function resolvePermissionPrompt(
  prompts: ScopePrompt[],
  answers: PermissionAnswers
): {
  index: number;
  result: PermissionPromptResult;
} {
  const permissions = new Map<string, UserToolPermission["permission"]>();
  const sessionAllows = new Set<PermissionScope>();
  const alwaysAllows = new Set<PermissionScope>();
  for (const [index, { request, scope }] of prompts.entries()) {
    const choice = answers[index];
    const previous = permissions.get(request.toolCallId);
    permissions.set(request.toolCallId, choice === "deny" || previous === "deny" ? "deny" : "allow");
    if (scope !== "unknown") {
      if (choice === "session") sessionAllows.add(scope);
      if (choice === "always") alwaysAllows.add(scope);
    }
  }
  const index = prompts.findIndex(
    ({ scope }, index) =>
      answers[index] === undefined && (scope === "unknown" || (!sessionAllows.has(scope) && !alwaysAllows.has(scope)))
  );
  return {
    index,
    result: {
      permissions: [...permissions].map(([toolCallId, permission]) => ({ toolCallId, permission })),
      sessionAllows: [...sessionAllows],
      alwaysAllows: [...alwaysAllows],
    },
  };
}
