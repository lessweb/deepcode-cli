import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const html = fs.readFileSync(new URL("../../resources/webview.html", import.meta.url), "utf8");
class Element {
  hidden = true;
  className = "";
  children: Element[] = [];
  listeners = new Map<string, () => void>();
  private markup = "";
  private matches = new Map<string, Element>();
  get innerHTML() {
    return this.markup;
  }
  set innerHTML(value: string) {
    this.markup = value;
    this.children = [];
    this.matches.clear();
  }
  querySelector(selector: string): Element | null {
    if (!this.markup.includes(selector.slice(1)))
      return this.children.map((child) => child.querySelector(selector)).find(Boolean) ?? null;
    if (!this.matches.has(selector)) this.matches.set(selector, new Element());
    return this.matches.get(selector)!;
  }
  addEventListener(event: string, listener: () => void) {
    this.listeners.set(event, listener);
  }
  click() {
    this.listeners.get("click")?.();
  }
  appendChild(child: Element) {
    this.children.push(child);
  }
}
function renderer(status = "permission_denied") {
  const decisions: string[] = [];
  const context = {
    permissionPromptHost: new Element(),
    currentSessionStatus: status,
    currentAskPermissions: [{ toolCallId: "c1", name: "WebSearch", command: "weather", scopes: ["network"] }],
    pendingPermissionReply: null as unknown,
    permissionPromptState: null as unknown,
    reviewingDeniedPermission: false,
    document: { createElement: () => new Element() },
    ensurePermissionPromptState: (requests: unknown[]) => ({
      prompts: requests.map((request) => ({ request, scope: "network" })),
    }),
    findNextPermissionPromptIndex: () => 0,
    describePermissionScope: () => "network access",
    getPermissionRiskClass: () => "risk-medium",
    isAlwaysAllowedScope: () => true,
    escapeHtml: (value: string) => value,
    cancelPermissionPrompt: () => {},
    commitPermissionDecision: (kind: string) => decisions.push(kind),
    renderPermissionPrompt: undefined as unknown as () => void,
  };
  vm.runInNewContext(
    html.slice(
      html.indexOf("      function renderPermissionDeniedNotice()"),
      html.indexOf("      function renderStructuredToolResult(")
    ),
    context
  );
  return { context, decisions };
}

test("a persisted denial displays a reason after load without a temporary permission reply", () => {
  const { context } = renderer();
  const start = html.indexOf('} else if (message.type === "loadSession")');
  const end = html.indexOf("          updateContextMeter", start);
  const body = html.slice(html.indexOf("\n", start), end);
  vm.runInNewContext(
    body,
    Object.assign(context, {
      message: { sessionId: "s1", status: "permission_denied", askPermissions: context.currentAskPermissions },
      currentSessionId: null,
      currentPluginRateLimitedTool: null,
      normalizePluginRateLimitedTool: () => null,
      normalizeAskPermissions: (value: unknown) => value,
    })
  );
  context.renderPermissionPrompt();
  assert.equal(context.pendingPermissionReply, null);
  assert.equal(context.permissionPromptHost.hidden, false);
  assert.match(context.permissionPromptHost.innerHTML, /Permission denied/);
  assert.match(context.permissionPromptHost.innerHTML, /Review the permission request/);
  assert.ok(context.permissionPromptHost.querySelector(".permission-review"));
});

test("review restores the permission controls without implicitly granting permission", () => {
  const { context, decisions } = renderer();
  context.renderPermissionPrompt();
  context.permissionPromptHost.querySelector(".permission-review")!.click();
  assert.equal(context.reviewingDeniedPermission, true);
  assert.equal(context.pendingPermissionReply, null);
  const card = context.permissionPromptHost.children[0];
  assert.match(card.innerHTML, /Permission required/);
  assert.match(card.innerHTML, /WebSearch/);
  assert.match(card.innerHTML, /weather/);
  assert.deepEqual(decisions, []);
  card.querySelector(".permission-deny")!.click();
  assert.deepEqual(decisions, ["deny"]);
});

test("live denials retain reply instructions and missing requests still show a reason", () => {
  const { context } = renderer();
  context.pendingPermissionReply = { permissions: [{ toolCallId: "c1", permission: "deny" }] };
  context.renderPermissionPrompt();
  assert.match(context.permissionPromptHost.innerHTML, /Add a reply/);
  context.pendingPermissionReply = null;
  context.currentAskPermissions = [];
  context.renderPermissionPrompt();
  assert.match(context.permissionPromptHost.innerHTML, /no longer available/);
  assert.equal(context.permissionPromptHost.hidden, false);
  assert.equal(context.permissionPromptHost.querySelector(".permission-review"), null);
});

test("pending permissions still render and completed sessions clear denial controls", () => {
  const { context, decisions } = renderer("ask_permission");
  context.renderPermissionPrompt();
  assert.match(context.permissionPromptHost.children[0].innerHTML, /Permission required/);
  context.permissionPromptHost.querySelector(".permission-allow")!.click();
  assert.deepEqual(decisions, ["allow"]);
  context.currentSessionStatus = "completed";
  context.reviewingDeniedPermission = true;
  context.renderPermissionPrompt();
  assert.equal(context.permissionPromptHost.hidden, true);
  assert.equal(context.reviewingDeniedPermission, false);
});
