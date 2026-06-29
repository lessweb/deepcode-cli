import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categorize,
  isNoiseEntry,
  parseReleaseEntries,
  formatEntry,
  formatRelease,
  buildChangelog,
  toReleaseModel,
  selectStableReleases,
  parseJsonl,
} from "../generate-changelog.js";

// ── categorize ───────────────────────────────────────────────────────────────

test("categorize extracts type, scope, and description", () => {
  const result = categorize("feat(core): add new feature");
  assert.deepEqual(result, {
    type: "feat",
    scope: "core",
    description: "add new feature",
    breaking: false,
  });
});

test("categorize handles no scope", () => {
  const result = categorize("fix: resolve crash on startup");
  assert.deepEqual(result, {
    type: "fix",
    scope: null,
    description: "resolve crash on startup",
    breaking: false,
  });
});

test("categorize detects breaking change marker", () => {
  const result = categorize("feat(api)!: change response format");
  assert.deepEqual(result, {
    type: "feat",
    scope: "api",
    description: "change response format",
    breaking: true,
  });
});

test("categorize returns raw description for non-conventional titles", () => {
  const result = categorize("update readme");
  assert.deepEqual(result, {
    type: null,
    scope: null,
    description: "update readme",
    breaking: false,
  });
});

// ── isNoiseEntry ─────────────────────────────────────────────────────────────

test("isNoiseEntry identifies release commits", () => {
  assert.equal(isNoiseEntry({ type: "chore", scope: "release" }), true);
});

test("isNoiseEntry ignores non-release chores", () => {
  assert.equal(isNoiseEntry({ type: "chore", scope: "deps" }), false);
});

test("isNoiseEntry ignores other types", () => {
  assert.equal(isNoiseEntry({ type: "feat", scope: null }), false);
});

// ── parseReleaseEntries ──────────────────────────────────────────────────────

test("parseReleaseEntries extracts entries from GitHub body", () => {
  const body = [
    "* feat(ui): add dark mode by @alice in https://github.com/o/r/pull/42",
    "* fix(core): resolve crash by @bob in https://github.com/o/r/pull/43",
    "",
    "**Full Changelog**: https://github.com/o/r/compare/v1.0.0...v1.1.0",
  ].join("\n");

  const entries = parseReleaseEntries(body);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].title, "feat(ui): add dark mode");
  assert.equal(entries[0].author, "alice");
  assert.equal(entries[0].prNumber, "42");
  assert.equal(entries[1].title, "fix(core): resolve crash");
  assert.equal(entries[1].author, "bob");
});

test("parseReleaseEntries handles entries without PR links (manual release notes)", () => {
  const body = [
    "* chore(deps-dev): bump esbuild and tsx by @dependabot[bot] in https://github.com/o/r/pull/174",
    "* chore: 优化deepcode-self-refer skill",
    "* chore: 优化skill-digester skill",
  ].join("\n");

  const entries = parseReleaseEntries(body);
  assert.equal(entries.length, 3);
  // entry with PR link
  assert.equal(entries[0].title, "chore(deps-dev): bump esbuild and tsx");
  assert.equal(entries[0].author, "dependabot[bot]");
  assert.equal(entries[0].prNumber, "174");
  // entries without PR link
  assert.equal(entries[1].title, "chore: 优化deepcode-self-refer skill");
  assert.equal(entries[1].author, null);
  assert.equal(entries[1].prUrl, null);
  assert.equal(entries[1].prNumber, null);
  assert.equal(entries[2].title, "chore: 优化skill-digester skill");
  assert.equal(entries[2].author, null);
});

test("parseReleaseEntries handles empty body", () => {
  assert.deepEqual(parseReleaseEntries(""), []);
  assert.deepEqual(parseReleaseEntries(null), []);
});

test("parseReleaseEntries handles bot authors", () => {
  const body = "* chore(deps): bump x by @dependabot[bot] in https://github.com/o/r/pull/1";
  const entries = parseReleaseEntries(body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].author, "dependabot[bot]");
});

// ── formatEntry ──────────────────────────────────────────────────────────────

test("formatEntry renders known type with scope", () => {
  const entry = { title: "feat(ui): add dark mode", prNumber: "42", prUrl: "https://github.com/o/r/pull/42" };
  assert.equal(formatEntry(entry), "- ui: add dark mode ([#42](https://github.com/o/r/pull/42))");
});

test("formatEntry renders known type without scope", () => {
  const entry = { title: "fix: resolve crash", prNumber: "10", prUrl: "https://github.com/o/r/pull/10" };
  assert.equal(formatEntry(entry), "- resolve crash ([#10](https://github.com/o/r/pull/10))");
});

test("formatEntry renders unknown type verbatim", () => {
  const entry = { title: "update readme", prNumber: "5", prUrl: "https://github.com/o/r/pull/5" };
  assert.equal(formatEntry(entry), "- update readme ([#5](https://github.com/o/r/pull/5))");
});

test("formatEntry marks breaking changes", () => {
  const entry = { title: "feat(api)!: change format", prNumber: "99", prUrl: "https://github.com/o/r/pull/99" };
  assert.match(formatEntry(entry), /\*\*BREAKING\*\*/);
});

test("formatEntry renders entry without PR link", () => {
  const entry = { title: "chore: optimize skill", prNumber: null, prUrl: null };
  assert.equal(formatEntry(entry), "- chore: optimize skill");
});

// ── formatRelease ────────────────────────────────────────────────────────────

test("formatRelease groups entries by section", () => {
  const release = {
    version: "1.1.0",
    date: "2026-01-15",
    htmlUrl: "https://github.com/o/r/releases/tag/v1.1.0",
    entries: [
      { title: "feat(ui): add dark mode", author: "alice", prUrl: "https://github.com/o/r/pull/1", prNumber: "1" },
      { title: "fix: crash on start", author: "bob", prUrl: "https://github.com/o/r/pull/2", prNumber: "2" },
      { title: "chore(release): v1.1.0", author: "bot", prUrl: "https://github.com/o/r/pull/3", prNumber: "3" },
    ],
  };

  const md = formatRelease(release);
  assert.match(md, /## \[1\.1\.0\]/);
  assert.match(md, /### Added/);
  assert.match(md, /### Fixed/);
  assert.doesNotMatch(md, /chore\(release\)/);
});

// ── buildChangelog ───────────────────────────────────────────────────────────

test("buildChangelog produces valid markdown with header", () => {
  const releases = [
    {
      version: "1.0.0",
      date: "2026-01-01",
      htmlUrl: "https://github.com/o/r/releases/tag/v1.0.0",
      entries: [
        { title: "feat: initial release", author: "dev", prUrl: "https://github.com/o/r/pull/1", prNumber: "1" },
      ],
    },
  ];

  const changelog = buildChangelog(releases);
  assert.match(changelog, /# Changelog/);
  assert.match(changelog, /## \[1\.0\.0\]/);
  assert.match(changelog, /### Added/);
  assert.ok(changelog.endsWith("\n"));
});

// ── toReleaseModel ───────────────────────────────────────────────────────────

test("toReleaseModel parses stable tag", () => {
  const raw = {
    tag: "v1.2.3",
    date: "2026-03-15T10:00:00Z",
    url: "https://github.com/o/r/releases/tag/v1.2.3",
    body: "* feat: new thing by @user in https://github.com/o/r/pull/1",
  };
  const model = toReleaseModel(raw);
  assert.equal(model.version, "1.2.3");
  assert.equal(model.date, "2026-03-15");
  assert.equal(model.entries.length, 1);
});

test("toReleaseModel returns null version for unstable tag", () => {
  const raw = { tag: "v1.0.0-beta.1", date: "2026-01-01", url: "", body: "" };
  const model = toReleaseModel(raw);
  assert.equal(model.version, null);
});

// ── selectStableReleases ─────────────────────────────────────────────────────

test("selectStableReleases filters out pre-releases and drafts", () => {
  const raw = [
    { tag: "v1.2.0", date: "2026-03-01", prerelease: false, draft: false, url: "", body: "" },
    { tag: "v1.1.0-beta.1", date: "2026-02-01", prerelease: true, draft: false, url: "", body: "" },
    { tag: "v1.0.0", date: "2026-01-01", prerelease: false, draft: false, url: "", body: "" },
    { tag: "v2.0.0-draft", date: "2026-04-01", prerelease: false, draft: true, url: "", body: "" },
  ];
  const stable = selectStableReleases(raw);
  assert.equal(stable.length, 2);
  assert.equal(stable[0].version, "1.2.0");
  assert.equal(stable[1].version, "1.0.0");
});

// ── parseJsonl ───────────────────────────────────────────────────────────────

test("parseJsonl parses newline-delimited JSON", () => {
  const jsonl = '{"a":1}\n{"b":2}\n';
  const result = parseJsonl(jsonl);
  assert.deepEqual(result, [{ a: 1 }, { b: 2 }]);
});

test("parseJsonl skips empty lines", () => {
  const jsonl = '{"a":1}\n\n  \n{"b":2}\n';
  const result = parseJsonl(jsonl);
  assert.equal(result.length, 2);
});
