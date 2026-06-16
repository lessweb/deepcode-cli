#!/usr/bin/env node
/* global __dirname, console, process, require */

const fs = require("fs");
const os = require("os");
const path = require("path");

function usage() {
  return "Usage: node scripts/find-skill.js <skill-name-or-path> [project-root]";
}

function loadMatter() {
  for (const base of [process.cwd(), __dirname]) {
    try {
      const resolved = require.resolve("gray-matter", { paths: [base] });
      return require(resolved);
    } catch {
      // Try the next lookup base, then fall back to the local parser.
    }
  }
  return null;
}

function parseFrontmatter(content) {
  const matter = loadMatter();
  if (matter) {
    try {
      return matter(content).data || {};
    } catch {
      // Fall back to the minimal frontmatter parser below.
    }
  }

  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return {};
  }
  const newline = content.startsWith("---\r\n") ? "\r\n" : "\n";
  const end = content.indexOf(`${newline}---${newline}`, 4);
  if (end === -1) {
    return {};
  }
  const raw = content.slice(4, end).split(/\r?\n/);
  const data = {};
  for (const line of raw) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    data[match[1]] = value;
  }
  return data;
}

function readSkillInfo(skillPath, displayPath, folderName) {
  const fallbackName = folderName.replace(/_/g, "-");
  try {
    const content = fs.readFileSync(skillPath, "utf8");
    const data = parseFrontmatter(content);
    const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : fallbackName;
    const description = typeof data.description === "string" ? data.description.trim() : "";
    return { name, folderName, path: skillPath, displayPath, description };
  } catch (error) {
    return { name: fallbackName, folderName, path: skillPath, displayPath, description: "", error: error.message };
  }
}

function isSkillFile(candidatePath) {
  try {
    return fs.statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

function collect(rootInfo) {
  let entries;
  try {
    entries = fs.readdirSync(rootInfo.root, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const folderName = entry.name;
    const skillPath = path.join(rootInfo.root, folderName, "SKILL.md");
    if (!isSkillFile(skillPath)) continue;
    const skill = readSkillInfo(skillPath, `${rootInfo.displayRoot}/${folderName}/SKILL.md`, folderName);
    const digestTargetPath = path.join(rootInfo.digestRoot, folderName, "SKILL.md");
    skill.digestTarget = {
      path: digestTargetPath,
      displayPath: `${rootInfo.digestDisplayRoot}/${folderName}/SKILL.md`,
      root: rootInfo.digestDisplayRoot,
      exists: isSkillFile(digestTargetPath),
      sameAsSource: path.resolve(digestTargetPath) === path.resolve(skillPath),
    };
    skills.push(skill);
  }
  return skills;
}

function expandInputPath(input, projectRoot) {
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  if (input.startsWith("~\\")) return path.join(os.homedir(), input.slice(2));
  if (input.startsWith("./")) return path.join(projectRoot, input.slice(2));
  if (input.startsWith(".\\")) return path.join(projectRoot, input.slice(2));
  if (path.isAbsolute(input)) return input;
  return null;
}

function main() {
  const query = process.argv[2];
  const projectRoot = process.argv[3] ? path.resolve(process.argv[3]) : process.cwd();
  if (!query) {
    console.error(usage());
    process.exit(2);
  }

  const projectNativeRoot = path.join(projectRoot, ".deepcode", "skills");
  const userNativeRoot = path.join(os.homedir(), ".deepcode", "skills");
  const roots = [
    {
      root: projectNativeRoot,
      displayRoot: "./.deepcode/skills",
      scope: "project",
      kind: "native",
      digestRoot: projectNativeRoot,
      digestDisplayRoot: "./.deepcode/skills",
    },
    {
      root: path.join(projectRoot, ".agents", "skills"),
      displayRoot: "./.agents/skills",
      scope: "project",
      kind: "interoperable",
      digestRoot: projectNativeRoot,
      digestDisplayRoot: "./.deepcode/skills",
    },
    {
      root: userNativeRoot,
      displayRoot: "~/.deepcode/skills",
      scope: "user",
      kind: "native",
      digestRoot: userNativeRoot,
      digestDisplayRoot: "~/.deepcode/skills",
    },
    {
      root: path.join(os.homedir(), ".agents", "skills"),
      displayRoot: "~/.agents/skills",
      scope: "user",
      kind: "interoperable",
      digestRoot: userNativeRoot,
      digestDisplayRoot: "~/.deepcode/skills",
    },
  ];

  const scanned = [];
  for (const rootInfo of roots) {
    for (const skill of collect(rootInfo)) {
      scanned.push({ ...skill, root: rootInfo.displayRoot, scope: rootInfo.scope, kind: rootInfo.kind });
    }
  }

  const activeByName = new Map();
  const shadowed = [];
  for (const skill of scanned) {
    if (activeByName.has(skill.name)) {
      shadowed.push({ ...skill, shadowedBy: activeByName.get(skill.name).displayPath });
    } else {
      activeByName.set(skill.name, skill);
    }
  }

  const inputPath = expandInputPath(query, projectRoot);
  const matches = [];
  for (const skill of scanned) {
    if (skill.name === query || skill.folderName === query) {
      matches.push(skill);
      continue;
    }
    if (inputPath) {
      const normalized = path.resolve(inputPath);
      if (path.resolve(skill.path) === normalized || path.resolve(path.dirname(skill.path)) === normalized) {
        matches.push(skill);
      }
    }
  }

  const activeMatches = matches.filter((skill) => activeByName.get(skill.name)?.path === skill.path);
  const shadowedMatches = matches.filter((skill) => activeByName.get(skill.name)?.path !== skill.path);

  process.stdout.write(
    JSON.stringify(
      {
        query,
        projectRoot,
        roots,
        found: matches.length > 0,
        activeMatches,
        shadowedMatches: shadowedMatches.map((skill) => ({
          ...skill,
          shadowedBy: activeByName.get(skill.name)?.displayPath,
        })),
        duplicateNames: shadowed,
      },
      null,
      2
    )
  );
  process.stdout.write("\n");
}

main();
