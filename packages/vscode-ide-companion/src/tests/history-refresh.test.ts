import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const html = fs.readFileSync(new URL("../../resources/webview.html", import.meta.url), "utf8");
const refreshStart = html.indexOf('        if (message.type === "refreshSessionHistory")');
const refreshEnd = html.indexOf('        if (message.type === "initializeEmpty"', refreshStart);
assert.ok(refreshStart > 0 && refreshEnd > refreshStart);
const refreshHandler = `(function () { ${html.slice(refreshStart, refreshEnd)} })()`;
const historyRenderer = html.slice(
  html.indexOf("      function clearMessages()"),
  html.indexOf("      function updateSessionDropdown(")
);

function setup(editing: boolean) {
  const rendered: unknown[] = [];
  const context = {
    message: {
      type: "refreshSessionHistory",
      sessionId: "s1",
      summary: "Edited history",
      status: "ask_permission",
      askPermissions: [{ toolCallId: "new-call", command: "Write B" }],
      messages: [
        { role: "assistant", content: "updated" },
        { role: "tool", content: "manual result" },
      ],
      sessions: [],
    },
    currentSessionId: "s1",
    currentSessionStatus: "permission_denied",
    currentAskPermissions: [{ toolCallId: "old-call", command: "Write A" }],
    currentPluginRateLimitedTool: null,
    permissionPromptState: { old: true } as unknown,
    pendingPermissionReply: { permissions: [{ toolCallId: "old-call", permission: "allow" }] } as unknown,
    reviewingDeniedPermission: true,
    promptInput: { value: "unfinished draft", selectionStart: 3, selectionEnd: 7 },
    selectedSkills: [{ name: "skill" }],
    attachmentManager: { imageUrls: ["file:///draft.png"], clear: () => assert.fail("attachments cleared") },
    editingQueue: editing ? { id: "q1", sessionId: "s1" } : null,
    savedQueueDraft: { text: "original composer draft", imageUrls: ["file:///original.png"] },
    queueEditBar: { hidden: !editing },
    composerState: { planMode: true, load: () => assert.fail("composer reloaded") },
    endQueueEdit: () => assert.fail("queue edit ended"),
    commandBusy: false,
    currentThinkingBubble: null,
    lastMessageRole: "user",
    messages: { innerHTML: "old history", scrollTop: 48, querySelectorAll: () => [] },
    sessionSelectorTitleText: { textContent: "Old title" },
    normalizeAskPermissions: (value: unknown) => value,
    normalizePluginRateLimitedTool: () => null,
    addMessageBubble: (message: unknown, connected: boolean) => rendered.push({ message, connected }),
    requestAnimationFrame: (callback: () => void) => callback(),
    updateAllConnectionLines: () => {},
    renderPluginRateLimitNotice: () => {},
    updateSessionDropdown: () => {},
    isBusyStatus: () => false,
    setLoading: (_busy: boolean, status: string) => {
      context.currentSessionStatus = status;
    },
  };
  vm.createContext(context);
  vm.runInContext(historyRenderer, context);
  return { context, rendered };
}

for (const editing of [false, true]) {
  test(`history refresh preserves ${editing ? "queue editing" : "composer draft"}, attachments, skills and selection`, () => {
    const { context, rendered } = setup(editing);
    const before = JSON.stringify([
      context.promptInput,
      context.selectedSkills,
      context.attachmentManager,
      context.editingQueue,
      context.savedQueueDraft,
      context.queueEditBar,
      context.composerState,
    ]);
    vm.runInContext(refreshHandler, context);
    assert.equal(
      JSON.stringify([
        context.promptInput,
        context.selectedSkills,
        context.attachmentManager,
        context.editingQueue,
        context.savedQueueDraft,
        context.queueEditBar,
        context.composerState,
      ]),
      before
    );
    assert.deepEqual(
      rendered,
      context.message.messages.map((message, index) => ({ message, connected: index > 0 }))
    );
    assert.equal(context.messages.scrollTop, 48);
    assert.equal(context.currentSessionStatus, "ask_permission");
    assert.deepEqual(context.currentAskPermissions, context.message.askPermissions);
    assert.equal(context.pendingPermissionReply, null);
    assert.equal(context.permissionPromptState, null);
    assert.equal(context.reviewingDeniedPermission, false);
    assert.equal(context.sessionSelectorTitleText.textContent, "Edited history");
  });
}

test("a history refresh for another session leaves the active page untouched", () => {
  const { context, rendered } = setup(true);
  context.message.sessionId = "other";
  vm.runInContext(refreshHandler, context);
  assert.deepEqual(rendered, []);
  assert.equal(context.messages.innerHTML, "old history");
  assert.equal(context.currentAskPermissions[0].toolCallId, "old-call");
  assert.notEqual(context.pendingPermissionReply, null);
});
