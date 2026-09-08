import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  appendProjectPermissionAllows,
  computeToolCallPermissions,
  classifyFilePermissionScope,
  evaluatePermissionScopes,
  getPermissionScopesRequiringAsk,
  hasUserPermissionReplies,
  isPathInAnyDirectory,
  parseBashSideEffects,
} from "../common/permissions";
import type { PermissionScope, PermissionSettings } from "../settings";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("parseBashSideEffects accepts valid scopes and normalizes unsafe values to unknown", () => {
  assert.deepEqual(parseBashSideEffects(["read-in-tmp", "write-in-tmp", "read-in-tmp"]), [
    "read-in-tmp",
    "write-in-tmp",
  ]);
  assert.deepEqual(parseBashSideEffects(undefined), ["unknown"]);
  assert.deepEqual(parseBashSideEffects(["read-in-cwd", "unknown"]), ["unknown"]);
  assert.deepEqual(parseBashSideEffects(["mcp"]), ["unknown"]);
});

test("evaluatePermissionScopes applies deny, ask, allow, and default mode precedence", () => {
  const settings: Required<PermissionSettings> = {
    allow: ["read-in-cwd"] as PermissionScope[],
    deny: ["write-out-cwd"] as PermissionScope[],
    ask: ["network"] as PermissionScope[],
    defaultMode: "askAll",
    addWorkingDirs: [],
  };

  assert.equal(evaluatePermissionScopes(["write-out-cwd"], settings), "deny");
  assert.equal(evaluatePermissionScopes(["network"], settings), "ask");
  assert.equal(evaluatePermissionScopes(["read-in-cwd"], settings), "allow");
  assert.equal(evaluatePermissionScopes(["write-in-cwd"], settings), "ask");
  assert.equal(evaluatePermissionScopes([], settings), "allow");
  assert.equal(evaluatePermissionScopes(["unknown"], settings), "ask");
});

test("evaluatePermissionScopes allows unknown when defaultMode is allowAll", () => {
  const allowAllSettings: Required<PermissionSettings> = {
    allow: [] as PermissionScope[],
    deny: [] as PermissionScope[],
    ask: [] as PermissionScope[],
    defaultMode: "allowAll",
    addWorkingDirs: [],
  };
  assert.equal(evaluatePermissionScopes(["unknown"], allowAllSettings), "allow");

  // unknown + other scopes that would otherwise trigger ask should still ask for those scopes
  const askNetworkSettings: Required<PermissionSettings> = {
    allow: [] as PermissionScope[],
    deny: [] as PermissionScope[],
    ask: ["network"] as PermissionScope[],
    defaultMode: "allowAll",
    addWorkingDirs: [],
  };
  assert.equal(evaluatePermissionScopes(["unknown", "network"], askNetworkSettings), "ask");
});

test("evaluatePermissionScopes applies configured policies to temporary directory scopes", () => {
  assert.equal(evaluatePermissionScopes(["read-in-tmp"]), "allow");
  assert.equal(
    evaluatePermissionScopes(["write-in-tmp"], {
      allow: [],
      deny: [],
      ask: [],
      defaultMode: "askAll",
      addWorkingDirs: [],
    }),
    "ask"
  );
  assert.equal(
    evaluatePermissionScopes(["write-in-tmp"], {
      allow: [],
      deny: ["write-in-tmp"],
      ask: [],
      defaultMode: "allowAll",
      addWorkingDirs: [],
    }),
    "deny"
  );
});

test("getPermissionScopesRequiringAsk excludes unknown when defaultMode is allowAll", () => {
  const allowAllSettings: Required<PermissionSettings> = {
    allow: [] as PermissionScope[],
    deny: [] as PermissionScope[],
    ask: ["network"] as PermissionScope[],
    defaultMode: "allowAll",
    addWorkingDirs: [],
  };
  const result = getPermissionScopesRequiringAsk(["unknown", "network"], allowAllSettings);
  assert.deepEqual(result, ["network"]);
});

test("getPermissionScopesRequiringAsk includes unknown when defaultMode is askAll", () => {
  const askAllSettings: Required<PermissionSettings> = {
    allow: [] as PermissionScope[],
    deny: [] as PermissionScope[],
    ask: ["network"] as PermissionScope[],
    defaultMode: "askAll",
    addWorkingDirs: [],
  };
  const result = getPermissionScopesRequiringAsk(["unknown", "network"], askAllSettings);
  assert.deepEqual(result, ["unknown", "network"]);
});

test("computeToolCallPermissions maps tool calls to permission requests", () => {
  const projectRoot = createTempDir("deepcode-permissions-workspace-");
  const plan = computeToolCallPermissions({
    sessionId: "session-1",
    projectRoot,
    settings: {
      allow: [] as PermissionScope[],
      deny: [] as PermissionScope[],
      ask: ["write-in-tmp", "network"] as PermissionScope[],
      defaultMode: "allowAll" as const,
    },
    resolveSnippetPath: () => path.join(projectRoot, "src", "file.ts"),
    toolCalls: [
      {
        id: "call-write",
        type: "function",
        function: { name: "write", arguments: JSON.stringify({ file_path: "/tmp/out.txt", content: "x" }) },
      },
      {
        id: "call-bash",
        type: "function",
        function: {
          name: "bash",
          arguments: JSON.stringify({ command: "curl https://example.com", sideEffects: ["network"] }),
        },
      },
      {
        id: "call-edit",
        type: "function",
        function: { name: "edit", arguments: JSON.stringify({ snippet_id: "snippet_1" }) },
      },
    ],
  });

  assert.deepEqual(plan.permissions, [
    { toolCallId: "call-write", permission: "ask" },
    { toolCallId: "call-bash", permission: "ask" },
    { toolCallId: "call-edit", permission: "allow" },
  ]);
  assert.deepEqual(
    plan.askPermissions.map((item) => ({ id: item.toolCallId, scopes: item.scopes })),
    [
      { id: "call-write", scopes: ["write-in-tmp"] },
      { id: "call-bash", scopes: ["network"] },
    ]
  );
});

test("computeToolCallPermissions only asks for scopes not already allowed", () => {
  const projectRoot = createTempDir("deepcode-permissions-filter-workspace-");
  const plan = computeToolCallPermissions({
    sessionId: "session-1",
    projectRoot,
    settings: {
      allow: ["read-in-cwd"] as PermissionScope[],
      deny: [] as PermissionScope[],
      ask: [] as PermissionScope[],
      defaultMode: "askAll" as const,
    },
    toolCalls: [
      {
        id: "call-bash",
        type: "function",
        function: {
          name: "bash",
          arguments: JSON.stringify({
            command: "curl -s http://localhost:8899/ && ls index.html",
            sideEffects: ["network", "read-in-cwd"],
          }),
        },
      },
    ],
  });

  assert.deepEqual(plan.permissions, [{ toolCallId: "call-bash", permission: "ask" }]);
  assert.deepEqual(
    plan.askPermissions.map((item) => ({ id: item.toolCallId, scopes: item.scopes })),
    [{ id: "call-bash", scopes: ["network"] }]
  );
});

test("computeToolCallPermissions temporarily upgrades allowed forced scopes to ask", () => {
  const projectRoot = createTempDir("deepcode-permissions-force-ask-workspace-");
  const forcedScopes: PermissionScope[] = [
    "write-in-cwd",
    "write-out-cwd",
    "delete-in-cwd",
    "delete-out-cwd",
    "mutate-git-log",
  ];
  const plan = computeToolCallPermissions({
    sessionId: "session-1",
    projectRoot,
    forceAskScopes: forcedScopes,
    settings: {
      allow: ["write-in-cwd", "write-out-cwd", "delete-out-cwd", "mutate-git-log"] as PermissionScope[],
      deny: ["delete-in-cwd"] as PermissionScope[],
      ask: [] as PermissionScope[],
      defaultMode: "allowAll" as const,
    },
    toolCalls: [
      {
        id: "call-write-in",
        type: "function",
        function: { name: "write", arguments: JSON.stringify({ file_path: path.join(projectRoot, "file.txt") }) },
      },
      {
        id: "call-write-out",
        type: "function",
        function: { name: "write", arguments: JSON.stringify({ file_path: "/var/tmp/file.txt" }) },
      },
      {
        id: "call-delete-out",
        type: "function",
        function: {
          name: "bash",
          arguments: JSON.stringify({
            command: "rm /tmp/file.txt",
            sideEffects: ["delete-out-cwd"],
          }),
        },
      },
      {
        id: "call-mutate-git",
        type: "function",
        function: {
          name: "bash",
          arguments: JSON.stringify({ command: "git commit --allow-empty -m test", sideEffects: ["mutate-git-log"] }),
        },
      },
      {
        id: "call-delete-in",
        type: "function",
        function: {
          name: "bash",
          arguments: JSON.stringify({ command: "rm file.txt", sideEffects: ["delete-in-cwd"] }),
        },
      },
    ],
  });

  assert.deepEqual(plan.permissions, [
    { toolCallId: "call-write-in", permission: "ask" },
    { toolCallId: "call-write-out", permission: "ask" },
    { toolCallId: "call-delete-out", permission: "ask" },
    { toolCallId: "call-mutate-git", permission: "ask" },
    { toolCallId: "call-delete-in", permission: "deny" },
  ]);
  assert.deepEqual(
    plan.askPermissions.map((item) => ({ id: item.toolCallId, scopes: item.scopes })),
    [
      { id: "call-write-in", scopes: ["write-in-cwd"] },
      { id: "call-write-out", scopes: ["write-out-cwd"] },
      { id: "call-delete-out", scopes: ["delete-out-cwd"] },
      { id: "call-mutate-git", scopes: ["mutate-git-log"] },
    ]
  );

  const defaultPlan = computeToolCallPermissions({
    sessionId: "session-1",
    projectRoot,
    settings: {
      allow: ["write-in-cwd"] as PermissionScope[],
      deny: [] as PermissionScope[],
      ask: [] as PermissionScope[],
      defaultMode: "allowAll" as const,
    },
    toolCalls: [
      {
        id: "call-default",
        type: "function",
        function: { name: "write", arguments: JSON.stringify({ file_path: path.join(projectRoot, "file.txt") }) },
      },
    ],
  });
  assert.deepEqual(defaultPlan.permissions, [{ toolCallId: "call-default", permission: "allow" }]);
});

test("computeToolCallPermissions allows read tool calls under skill scan paths", () => {
  const projectRoot = createTempDir("deepcode-permissions-skill-read-workspace-");
  const home = createTempDir("deepcode-permissions-skill-read-home-", process.cwd());
  const skillRoot = path.join(home, ".agents", "skills");
  const skillResourcePath = path.join(skillRoot, "pdf", "scripts", "extract.py");
  const outsidePath = path.join(home, "notes.txt");
  const plan = computeToolCallPermissions({
    sessionId: "session-1",
    projectRoot,
    readPermissionExemptPaths: [skillRoot],
    settings: {
      allow: [] as PermissionScope[],
      deny: [] as PermissionScope[],
      ask: [] as PermissionScope[],
      defaultMode: "askAll" as const,
    },
    toolCalls: [
      {
        id: "call-skill-read",
        type: "function",
        function: { name: "read", arguments: JSON.stringify({ file_path: skillResourcePath }) },
      },
      {
        id: "call-outside-read",
        type: "function",
        function: { name: "read", arguments: JSON.stringify({ file_path: outsidePath }) },
      },
    ],
  });

  assert.deepEqual(plan.permissions, [
    { toolCallId: "call-skill-read", permission: "allow" },
    { toolCallId: "call-outside-read", permission: "ask" },
  ]);
  assert.deepEqual(
    plan.askPermissions.map((item) => ({ id: item.toolCallId, scopes: item.scopes })),
    [{ id: "call-outside-read", scopes: ["read-out-cwd"] }]
  );
});

test("UnderstandImage requires network and exempts only configured image directories from read scope", () => {
  const projectRoot = createTempDir("deepcode-permissions-image-workspace-");
  const home = createTempDir("deepcode-permissions-image-home-", process.cwd());
  const sessionImages = path.join(home, ".deepcode", "projects", "project", "images", "session-1");
  const currentImage = path.join(sessionImages, "current.png");
  const projectImage = path.join(projectRoot, "project.png");
  const outsideImage = path.join(home, "outside.png");
  const plan = computeToolCallPermissions({
    sessionId: "session-1",
    projectRoot,
    readPermissionExemptPaths: [sessionImages],
    settings: {
      allow: [] as PermissionScope[],
      deny: [] as PermissionScope[],
      ask: [] as PermissionScope[],
      defaultMode: "askAll" as const,
    },
    toolCalls: [
      {
        id: "call-current",
        type: "function",
        function: { name: "UnderstandImage", arguments: JSON.stringify({ image_path: currentImage }) },
      },
      {
        id: "call-project",
        type: "function",
        function: { name: "UnderstandImage", arguments: JSON.stringify({ image_path: projectImage }) },
      },
      {
        id: "call-outside",
        type: "function",
        function: { name: "UnderstandImage", arguments: JSON.stringify({ image_path: outsideImage }) },
      },
    ],
  });

  assert.deepEqual(
    plan.askPermissions.map((item) => ({ id: item.toolCallId, scopes: item.scopes })),
    [
      { id: "call-current", scopes: ["network"] },
      { id: "call-project", scopes: ["read-in-cwd", "network"] },
      { id: "call-outside", scopes: ["read-out-cwd", "network"] },
    ]
  );
});

test("ReadImage uses filesystem read permissions without network access", () => {
  const projectRoot = createTempDir("deepcode-permissions-read-image-workspace-");
  const home = createTempDir("deepcode-permissions-read-image-home-", process.cwd());
  const projectImage = path.join(projectRoot, "project.png");
  const outsideImage = path.join(home, "outside.png");
  const plan = computeToolCallPermissions({
    sessionId: "session-1",
    projectRoot,
    settings: {
      allow: [] as PermissionScope[],
      deny: [] as PermissionScope[],
      ask: [] as PermissionScope[],
      defaultMode: "askAll" as const,
    },
    toolCalls: [
      {
        id: "call-project",
        type: "function",
        function: { name: "ReadImage", arguments: JSON.stringify({ file_path: projectImage }) },
      },
      {
        id: "call-outside",
        type: "function",
        function: { name: "ReadImage", arguments: JSON.stringify({ file_path: outsideImage }) },
      },
    ],
  });

  assert.deepEqual(
    plan.askPermissions.map((item) => ({ id: item.toolCallId, scopes: item.scopes })),
    [
      { id: "call-project", scopes: ["read-in-cwd"] },
      { id: "call-outside", scopes: ["read-out-cwd"] },
    ]
  );
});

test("isPathInAnyDirectory matches absolute and project-relative directories without sibling leaks", () => {
  const projectRoot = createTempDir("deepcode-permissions-directory-match-workspace-");
  const home = createTempDir("deepcode-permissions-directory-match-home-");
  const absoluteSkillRoot = path.join(home, ".agents", "skills");
  const relativeSkillRoot = path.join(".deepcode", "skills");

  assert.equal(
    isPathInAnyDirectory(projectRoot, path.join(absoluteSkillRoot, "pdf", "scripts", "extract.py"), [
      absoluteSkillRoot,
    ]),
    true
  );
  assert.equal(
    isPathInAnyDirectory(projectRoot, path.join(projectRoot, relativeSkillRoot, "local", "SKILL.md"), [
      relativeSkillRoot,
    ]),
    true
  );
  assert.equal(
    isPathInAnyDirectory(projectRoot, path.join(`${absoluteSkillRoot}-backup`, "extract.py"), [absoluteSkillRoot]),
    false
  );
  assert.equal(
    isPathInAnyDirectory(projectRoot, path.join(projectRoot, ".deepcode", "skills-extra", "file.md"), [
      relativeSkillRoot,
    ]),
    false
  );
  assert.equal(isPathInAnyDirectory(projectRoot, path.join(home, "notes.txt"), undefined), false);
});

test("classifyFilePermissionScope prioritizes working directories over temporary directories", () => {
  const projectRoot = createTempDir("deepcode-permissions-classify-workspace-");
  const siblingRoot = path.join(path.dirname(projectRoot), "shared-workspace");

  assert.equal(classifyFilePermissionScope(projectRoot, path.join(projectRoot, "file.txt"), "write"), "write-in-cwd");
  assert.equal(
    classifyFilePermissionScope(projectRoot, path.join(siblingRoot, "file.txt"), "read", [siblingRoot]),
    "read-in-cwd"
  );
  assert.equal(classifyFilePermissionScope(projectRoot, "/tmp/shared/file.txt", "read"), "read-in-tmp");
  assert.equal(classifyFilePermissionScope(projectRoot, "/private/tmp/shared/file.txt", "write"), "write-in-tmp");
  assert.equal(classifyFilePermissionScope(projectRoot, "/tmp-backup/file.txt", "read"), "read-out-cwd");
  assert.equal(classifyFilePermissionScope(projectRoot, "/opt/project/file.txt", "write"), "write-out-cwd");
});

test("computeToolCallPermissions applies temporary and additional working directory scopes to file tools", () => {
  const projectRoot = createTempDir("deepcode-permissions-file-scopes-");
  const additionalRoot = "../shared-project";
  const plan = computeToolCallPermissions({
    sessionId: "session-1",
    projectRoot,
    settings: {
      allow: [],
      deny: [],
      ask: [],
      defaultMode: "askAll",
      addWorkingDirs: [additionalRoot],
    },
    resolveSnippetPath: () => path.resolve(projectRoot, additionalRoot, "edited.ts"),
    toolCalls: [
      {
        id: "call-read",
        type: "function",
        function: { name: "read", arguments: JSON.stringify({ file_path: "/tmp/input.txt" }) },
      },
      {
        id: "call-write",
        type: "function",
        function: { name: "write", arguments: JSON.stringify({ file_path: "/private/tmp/output.txt" }) },
      },
      {
        id: "call-edit",
        type: "function",
        function: { name: "edit", arguments: JSON.stringify({ snippet_id: "snippet-1" }) },
      },
      {
        id: "call-read-image",
        type: "function",
        function: { name: "ReadImage", arguments: JSON.stringify({ file_path: "/tmp/image.png" }) },
      },
      {
        id: "call-understand-image",
        type: "function",
        function: { name: "UnderstandImage", arguments: JSON.stringify({ image_path: "/tmp/image.png" }) },
      },
    ],
  });

  assert.deepEqual(
    plan.askPermissions.map((item) => ({ id: item.toolCallId, scopes: item.scopes })),
    [
      { id: "call-read", scopes: ["read-in-tmp"] },
      { id: "call-write", scopes: ["write-in-tmp"] },
      { id: "call-edit", scopes: ["write-in-cwd"] },
      { id: "call-read-image", scopes: ["read-in-tmp"] },
      { id: "call-understand-image", scopes: ["read-in-tmp", "network"] },
    ]
  );
});

test("appendProjectPermissionAllows writes unique project-level allow scopes", () => {
  const projectRoot = createTempDir("deepcode-permission-settings-");
  const settingsPath = path.join(projectRoot, ".deepcode", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({ permissions: { allow: ["read-in-cwd"] } }), "utf8");

  appendProjectPermissionAllows(projectRoot, ["read-in-cwd", "write-in-cwd"]);
  appendProjectPermissionAllows(projectRoot, ["write-in-cwd"]);

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.permissions.allow, ["read-in-cwd", "write-in-cwd"]);
});

test("appendProjectPermissionAllows seeds inherited permissions before adding allow scopes", () => {
  const projectRoot = createTempDir("deepcode-permission-settings-default-");

  appendProjectPermissionAllows(projectRoot, ["query-git-log"], {
    inheritedPermissions: {
      allow: ["read-in-cwd"],
      deny: ["write-out-cwd"],
      ask: ["network"],
      defaultMode: "askAll",
      addWorkingDirs: ["../shared-project"],
    },
  });

  const settingsPath = path.join(projectRoot, ".deepcode", "settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.permissions, {
    allow: ["read-in-cwd", "query-git-log"],
    deny: ["write-out-cwd"],
    ask: ["network"],
    defaultMode: "askAll",
    addWorkingDirs: ["../shared-project"],
  });
});

test("appendProjectPermissionAllows moves inherited ask and deny scopes into allow", () => {
  const projectRoot = createTempDir("deepcode-permission-settings-move-inherited-");

  appendProjectPermissionAllows(projectRoot, ["network", "write-out-cwd"], {
    inheritedPermissions: {
      allow: ["read-in-cwd"],
      deny: ["write-out-cwd"],
      ask: ["network", "mcp"],
      defaultMode: "askAll",
    },
  });

  const settingsPath = path.join(projectRoot, ".deepcode", "settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.permissions, {
    allow: ["read-in-cwd", "network", "write-out-cwd"],
    deny: [],
    ask: ["mcp"],
    defaultMode: "askAll",
  });
});

test("appendProjectPermissionAllows writes inherited permissions even when scope is already allowed", () => {
  const projectRoot = createTempDir("deepcode-permission-settings-inherited-existing-");

  appendProjectPermissionAllows(projectRoot, ["read-in-cwd"], {
    inheritedPermissions: {
      allow: ["read-in-cwd"],
      deny: [],
      ask: ["network"],
      defaultMode: "askAll",
    },
  });

  const settingsPath = path.join(projectRoot, ".deepcode", "settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.permissions, {
    allow: ["read-in-cwd"],
    deny: [],
    ask: ["network"],
    defaultMode: "askAll",
  });
});

test("appendProjectPermissionAllows preserves existing project permissions", () => {
  const projectRoot = createTempDir("deepcode-permission-settings-explicit-default-");
  const settingsPath = path.join(projectRoot, ".deepcode", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ permissions: { allow: ["read-in-cwd"], defaultMode: "allowAll" } }),
    "utf8"
  );

  appendProjectPermissionAllows(projectRoot, ["query-git-log"], {
    inheritedPermissions: {
      allow: ["write-in-cwd"],
      deny: ["write-out-cwd"],
      ask: ["network"],
      defaultMode: "askAll",
    },
  });

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.permissions, {
    allow: ["read-in-cwd", "query-git-log"],
    defaultMode: "allowAll",
  });
});

test("appendProjectPermissionAllows removes existing ask and deny conflicts", () => {
  const projectRoot = createTempDir("deepcode-permission-settings-existing-conflict-");
  const settingsPath = path.join(projectRoot, ".deepcode", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      permissions: {
        allow: ["read-in-cwd"],
        deny: ["network", "write-out-cwd"],
        ask: ["network", "mcp"],
        defaultMode: "askAll",
      },
    }),
    "utf8"
  );

  appendProjectPermissionAllows(projectRoot, ["network"]);

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.permissions, {
    allow: ["read-in-cwd", "network"],
    deny: ["write-out-cwd"],
    ask: ["mcp"],
    defaultMode: "askAll",
  });
});

test("hasUserPermissionReplies detects permission reply payloads", () => {
  assert.equal(hasUserPermissionReplies({}), false);
  assert.equal(hasUserPermissionReplies({ permissions: [] }), false);
  assert.equal(hasUserPermissionReplies({ permissions: [{ toolCallId: "call-1", permission: "allow" }] }), true);
  assert.equal(hasUserPermissionReplies({ alwaysAllows: ["network"] }), true);
});

function createTempDir(prefix: string, parentDir = os.tmpdir()): string {
  const dir = fs.mkdtempSync(path.join(parentDir, prefix));
  tempDirs.push(dir);
  return dir;
}
