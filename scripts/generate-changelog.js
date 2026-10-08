#!/usr/bin/env node

/**
 * Generate `CHANGELOG.md` from the project's GitHub Releases.
 *
 * The changelog only lists *stable* releases (`vX.Y.Z`); nightly and preview
 * pre-releases are intentionally omitted. Each release's auto-generated
 * "What's Changed" list is re-grouped into Keep a Changelog sections
 * (Added / Changed / Fixed / ...) by the conventional-commit prefix used
 * in PR titles.
 *
 * The file is fully derived from the GitHub Releases API, so it is safe to
 * regenerate at any time and should not be edited by hand.
 *
 * Usage:
 *   node scripts/generate-changelog.js                # write ./CHANGELOG.md
 *   node scripts/generate-changelog.js --dry-run      # print to stdout instead
 *   node scripts/generate-changelog.js --repo=owner/name --output=path.md
 *
 * Requires the GitHub CLI (`gh`) to be installed and authenticated.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// ── Keep a Changelog sections ────────────────────────────────────────────────

const SECTIONS = [
  { name: "Added", types: ["feat"] },
  { name: "Changed", types: ["refactor", "revert"] },
  { name: "Fixed", types: ["fix"] },
  { name: "Performance", types: ["perf"] },
  { name: "Documentation", types: ["docs"] },
  { name: "Other", types: [] },
];

const TYPE_TO_SECTION = Object.fromEntries(
  SECTIONS.flatMap((section) => section.types.map((type) => [type, section.name]))
);

const SECTION_ORDER = SECTIONS.map((section) => section.name);

// ── Regex patterns ───────────────────────────────────────────────────────────

/** Matches a stable `vX.Y.Z` tag (no `-preview` / `-nightly` suffix). */
const STABLE_TAG_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

/**
 * Matches a GitHub "What's Changed" bullet with a PR link, e.g.
 *
 * fix(core): do a thing by @octocat in https://github.com/o/r/pull/42
 */
const ENTRY_RE = /^[*-]\s+(.+)\s+by\s+@([A-Za-z0-9-]+(?:\[bot\])?)\s+in\s+(https?:\/\/\S+\/pull\/(\d+))\s*$/;

/**
 * Matches a bullet without a PR link (manually added release entries), e.g.
 *
 * chore: optimize skill
 */
const SIMPLE_ENTRY_RE = /^[*-]\s+(.+?)\s*$/;

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/**
 * Split a conventional-commit subject into
 * `{ type, scope, description, breaking }`.
 */
export function categorize(title) {
  const match = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/.exec(title.trim());
  if (!match) {
    return { type: null, scope: null, description: title.trim(), breaking: false };
  }
  return {
    type: match[1].toLowerCase(),
    scope: match[2] || null,
    description: match[4],
    breaking: Boolean(match[3]),
  };
}

/** Version-bump commits (`chore(release): …`) are noise in a user-facing changelog. */
export function isNoiseEntry({ type, scope }) {
  return type === "chore" && scope === "release";
}

/** Parse the "What's Changed" bullets out of a release body. */
export function parseReleaseEntries(body) {
  const entries = [];
  for (const line of (body || "").split(/\r?\n/)) {
    const match = ENTRY_RE.exec(line);
    if (match) {
      entries.push({
        title: match[1].trim(),
        author: match[2],
        prUrl: match[3],
        prNumber: match[4],
      });
      continue;
    }
    const simpleMatch = SIMPLE_ENTRY_RE.exec(line);
    if (simpleMatch) {
      entries.push({
        title: simpleMatch[1].trim(),
        author: null,
        prUrl: null,
        prNumber: null,
      });
    }
  }
  return entries;
}

/** Render a single entry as a changelog list item. */
export function formatEntry(entry, cat = categorize(entry.title)) {
  const { type, scope, description, breaking } = cat;
  let text;
  if (TYPE_TO_SECTION[type]) {
    text = scope ? `${scope}: ${description}` : description;
  } else {
    text = entry.title;
  }
  if (breaking) {
    text = `**BREAKING** ${text}`;
  }
  if (entry.prNumber && entry.prUrl) {
    return `- ${text} ([#${entry.prNumber}](${entry.prUrl}))`;
  }
  return `- ${text}`;
}

/** Render one release as a Markdown block. */
export function formatRelease(release) {
  const lines = [];
  const heading = release.htmlUrl ? `## [${release.version}](${release.htmlUrl})` : `## [${release.version}]`;
  lines.push(heading, "", "`" + release.date + "`", "");

  const buckets = new Map();
  for (const entry of release.entries) {
    const cat = categorize(entry.title);
    if (isNoiseEntry(cat)) continue;
    const section = TYPE_TO_SECTION[cat.type] || "Other";
    if (!buckets.has(section)) buckets.set(section, []);
    buckets.get(section).push(formatEntry(entry, cat));
  }

  let rendered = false;
  for (const section of SECTION_ORDER) {
    const items = buckets.get(section);
    if (!items || items.length === 0) continue;
    rendered = true;
    lines.push(`### ${section}`, "", ...items, "");
  }

  if (!rendered) {
    const link = release.htmlUrl ? `[GitHub release](${release.htmlUrl})` : "the GitHub release";
    lines.push(`_See ${link} for details._`, "");
  }

  return lines.join("\n");
}

// ── Changelog builder ────────────────────────────────────────────────────────

const HEADER = `# Changelog

All notable changes to [Deep Code](https://github.com/lessweb/deepcode-cli) are
documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Only stable releases
are listed; pre-releases are intentionally omitted.

> **This file is generated automatically** from
> [GitHub Releases](https://github.com/lessweb/deepcode-cli/releases). Do not
> edit it by hand — run \`npm run changelog\` to regenerate.
`;

/** Build the full CHANGELOG.md contents from an ordered list of releases. */
export function buildChangelog(releases) {
  const blocks = releases.map((release) => formatRelease(release));
  const body = `${HEADER}\n${blocks.join("\n")}`;
  return `${body.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "")}\n`;
}

// ── GitHub Releases fetching ─────────────────────────────────────────────────

/** Convert a raw GitHub Releases API object into our release model. */
export function toReleaseModel(raw) {
  const match = STABLE_TAG_RE.exec(raw.tag || "");
  return {
    tag: raw.tag,
    version: match ? `${match[1]}.${match[2]}.${match[3]}` : null,
    date: (raw.date || "").slice(0, 10),
    htmlUrl: raw.url || "",
    entries: parseReleaseEntries(raw.body),
  };
}

/** Keep only stable releases, newest first. */
export function selectStableReleases(rawReleases) {
  return rawReleases
    .filter((raw) => !raw.prerelease && !raw.draft)
    .map(toReleaseModel)
    .filter((release) => release.version)
    .sort((a, b) => {
      const x = a.version.split(".").map(Number);
      const y = b.version.split(".").map(Number);
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    });
}

/** Fetch every release (paginated) as newline-delimited JSON via the gh CLI. */
function fetchReleasesJsonl(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`Invalid repository "${repo}"; expected "owner/name".`);
  }
  return execFileSync(
    "gh",
    [
      "api",
      `repos/${repo}/releases?per_page=100`,
      "--paginate",
      "--jq",
      ".[] | {tag: .tag_name, date: .published_at, prerelease: .prerelease, draft: .draft, url: .html_url, body: .body}",
    ],
    { encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 }
  );
}

/** Parse newline-delimited JSON (one release object per line). */
export function parseJsonl(jsonl) {
  return jsonl
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

/** Resolve the default `owner/repo` from $GITHUB_REPOSITORY or package.json. */
function getDefaultRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = readJson(path.join(REPO_ROOT, "package.json"))?.repository?.url;
  const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(url || "");
  return match ? match[1] : "lessweb/deepcode-cli";
}

/** Minimal arg parser — no external dependencies. */
function parseArgs(argv) {
  const result = { values: {}, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      result.help = true;
    } else if (arg === "--dry-run") {
      result.values["dry-run"] = true;
    } else if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        result.values[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        result.values[arg.slice(2)] = true;
      }
    } else {
      result.positional.push(arg);
    }
  }
  return result;
}

const HELP = `Generate CHANGELOG.md from GitHub Releases.

Usage:
  node scripts/generate-changelog.js [options]

Options:
  --repo=<owner/name>  Source repository (default: $GITHUB_REPOSITORY or package.json).
  --output=<path>      Output file (default: ./CHANGELOG.md).
  --dry-run            Print to stdout instead of writing the file.
  -h, --help           Show this help.
`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const repo = args.values.repo || getDefaultRepo();
  const output = args.values.output || path.join(REPO_ROOT, "CHANGELOG.md");

  let rawReleases;
  try {
    rawReleases = parseJsonl(fetchReleasesJsonl(repo));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT") || message.includes("gh: not found")) {
      console.error("ERROR: GitHub CLI (`gh`) is not installed. Install it from https://cli.github.com/");
    } else {
      console.error(`ERROR: Failed to fetch releases: ${message}`);
    }
    process.exit(1);
  }
  const releases = selectStableReleases(rawReleases);
  if (releases.length === 0) {
    console.error(`ERROR: no stable releases found for ${repo}; refusing to overwrite ${path.basename(output)}.`);
    process.exit(1);
  }
  const changelog = buildChangelog(releases);

  if (args.values["dry-run"]) {
    process.stdout.write(changelog);
    return;
  }

  writeFileSync(output, changelog);
  console.error(`Wrote ${releases.length} stable releases to ${path.relative(process.cwd(), output)}`);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main();
}
