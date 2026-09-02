import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "ink";
import { formatSessionTitle, filterSessions, formatSessionStatus, getSessionBadges } from "../ui/views/SessionList";
import { SessionList } from "../ui/views/SessionList";
import { claimPlanImplementation, isActiveSessionEvent } from "../ui/core/session-events";
import type { SessionEntry } from "@vegamo/deepcode-core";

test("formatSessionTitle replaces newlines with spaces", () => {
  assert.equal(formatSessionTitle("first line\nsecond line\r\nthird"), "first line second line third");
});

test("formatSessionTitle truncates after normalizing whitespace", () => {
  assert.equal(formatSessionTitle("one\n two   three", 10), "one two th…");
});

test("plan derivation badges remain separate from long truncated titles", () => {
  const [source, implementation, fork] = buildSessions([
    { id: "source", summary: "A very long plan title that must be independently truncated" },
    {
      id: "implementation",
      summary: "A very long plan title that must be independently truncated",
      derivedFrom: { kind: "plan-implementation", sessionId: "source", messageId: "plan-message" },
    },
    { id: "fork", forkedFrom: { sessionId: "source", messageId: "plan-message" } },
  ]);

  assert.equal(formatSessionTitle(source!.summary!, 20), "A very long plan tit…");
  assert.deepEqual(getSessionBadges(source!, [source!, implementation!, fork!]), ["planned"]);
  assert.deepEqual(getSessionBadges(implementation!, [source!, implementation!, fork!]), ["implementation"]);
  assert.deepEqual(getSessionBadges(fork!, [source!, implementation!, fork!]), []);
});

test("session callbacks ignore events from inactive sessions", () => {
  assert.equal(isActiveSessionEvent("implementation", "source"), false);
  assert.equal(isActiveSessionEvent("implementation", "implementation"), true);
  assert.equal(isActiveSessionEvent("implementation", undefined), false);
  assert.equal(isActiveSessionEvent(null, "source"), false);
  assert.equal(isActiveSessionEvent(null, undefined), false);
});

test("plan implementation can only be claimed once while preparation is in flight", () => {
  const inFlight = { current: false };

  assert.equal(claimPlanImplementation(inFlight), true);
  assert.equal(claimPlanImplementation(inFlight), false);
});

test("long session titles keep lineage badges and status on the first line at 80 columns", () => {
  const sessions = buildSessions([
    { id: "source", summary: "A very long plan title ".repeat(8) },
    {
      id: "implementation",
      summary: "A very long implementation title ".repeat(8),
      derivedFrom: { kind: "plan-implementation", sessionId: "source", messageId: "plan-message" },
    },
  ]);
  const output = renderToString(
    React.createElement(SessionList, {
      sessions,
      onSelect: () => {},
      onCancel: () => {},
    }),
    { columns: 80 }
  );
  const lines = output.split("\n");
  const titleLine = lines.find((line) => line.includes("[planned]"));
  const implementationLine = lines.find((line) => line.includes("[implementation]"));

  assert.match(titleLine ?? "", /… +\[planned\] \(done\) │$/);
  assert.match(implementationLine ?? "", /… +\[implementation\] \(done\) │$/);
  const plannedTimeLine = lines[lines.indexOf(titleLine ?? "") + 1] ?? "";
  const implementationTimeLine = lines[lines.indexOf(implementationLine ?? "") + 1] ?? "";
  assert.match(plannedTimeLine, /2026/);
  assert.doesNotMatch(plannedTimeLine, /\[planned\]|\(done\)/);
  assert.match(implementationTimeLine, /2026/);
  assert.doesNotMatch(implementationTimeLine, /\[implementation\]|\(done\)/);
});

test("formatSessionStatus maps status values to display labels", () => {
  assert.equal(formatSessionStatus("completed"), "done");
  assert.equal(formatSessionStatus("processing"), "running");
  assert.equal(formatSessionStatus("pending"), "pending");
  assert.equal(formatSessionStatus("waiting_for_user"), "waiting");
  assert.equal(formatSessionStatus("failed"), "failed");
  assert.equal(formatSessionStatus("interrupted"), "stopped");
  assert.equal(formatSessionStatus("ask_permission"), "waiting");
  assert.equal(formatSessionStatus("permission_denied"), "denied");
  assert.equal(formatSessionStatus("unknown_status" as any), "unknown_status");
});

test("filterSessions returns all sessions when query is empty", () => {
  const sessions = buildSessions([{ summary: "Fix login bug" }, { summary: "Add dark mode" }]);
  assert.equal(filterSessions(sessions, "").length, 2);
  assert.equal(filterSessions(sessions, "   ").length, 2);
});

test("filterSessions matches by summary (case-insensitive)", () => {
  const sessions = buildSessions([
    { summary: "Fix login bug" },
    { summary: "Add dark mode" },
    { summary: "Refactor auth module" },
  ]);

  assert.equal(filterSessions(sessions, "login").length, 1);
  assert.equal(filterSessions(sessions, "LOGIN").length, 1);
  assert.equal(filterSessions(sessions, "Login").length, 1);
});

test("filterSessions matches by status (case-insensitive)", () => {
  const sessions = buildSessions([
    { summary: "Task 1", status: "completed" },
    { summary: "Task 2", status: "failed" },
    { summary: "Task 3", status: "completed" },
  ]);

  assert.equal(filterSessions(sessions, "failed").length, 1);
  assert.equal(filterSessions(sessions, "completed").length, 2);
});

test("filterSessions matches by failReason", () => {
  const sessions = buildSessions([
    { summary: "Task 1", status: "failed", failReason: "API key not found" },
    { summary: "Task 2", status: "completed" },
  ]);

  assert.equal(filterSessions(sessions, "API key").length, 1);
  assert.equal(filterSessions(sessions, "not found").length, 1);
});

test("filterSessions matches by assistantReply", () => {
  const sessions = buildSessions([
    { summary: "Task 1", assistantReply: "The bug was fixed by updating the config." },
    { summary: "Task 2", assistantReply: "Dark mode has been added successfully." },
  ]);

  assert.equal(filterSessions(sessions, "dark mode").length, 1);
  assert.equal(filterSessions(sessions, "config").length, 1);
});

test("filterSessions returns empty array when no match", () => {
  const sessions = buildSessions([{ summary: "Fix login bug" }, { summary: "Add dark mode" }]);

  assert.equal(filterSessions(sessions, "nonexistent").length, 0);
});

test("filterSessions matches across multiple fields on same session", () => {
  const sessions = buildSessions([
    { summary: "Fix login bug", status: "failed", failReason: "Timeout error" },
    { summary: "Add dark mode", status: "completed" },
  ]);

  // Should match the first session via status
  assert.equal(filterSessions(sessions, "failed").length, 1);
  // Should match the first session via failReason
  assert.equal(filterSessions(sessions, "timeout").length, 1);
  // Partial summary match
  assert.equal(filterSessions(sessions, "login").length, 1);
});

test("filterSessions handles sessions with null fields", () => {
  const sessions = buildSessions([{ summary: null }, { summary: "Valid summary" }]);

  assert.equal(filterSessions(sessions, "valid").length, 1);
  assert.equal(filterSessions(sessions, "summary").length, 1);
});

function buildSessions(overrides: Array<Partial<SessionEntry>>): SessionEntry[] {
  return overrides.map((override, i) => ({
    id: override.id ?? `session-${i}`,
    summary: override.summary ?? null,
    assistantReply: override.assistantReply ?? null,
    assistantThinking: null,
    assistantRefusal: null,
    toolCalls: null,
    status: override.status ?? "completed",
    failReason: override.failReason ?? null,
    usage: null,
    usagePerModel: null,
    activeTokens: 0,
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString(),
    processes: null,
    forkedFrom: override.forkedFrom,
    derivedFrom: override.derivedFrom,
  }));
}
