import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  buildSkillDocumentsPrompt,
  getDefaultSkillPrompt,
  getPlanModePrompt,
  getRuntimeContext,
  getSystemPrompt,
  getTools,
} from "../prompt";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

test("getTools always includes WebSearch", () => {
  const names = getTools().map((tool) => tool.function.name);
  assert.equal(names.includes("WebSearch"), true);
});

test("getTools includes UpdatePlan with string plan schema", () => {
  const tool = getTools().find((candidate) => candidate.function.name === "UpdatePlan");
  assert.ok(tool);
  assert.deepEqual(tool.function.parameters.required, ["plan"]);
  assert.equal((tool.function.parameters.properties.plan as { type?: unknown }).type, "string");
});

test("getTools requires bash sideEffects permission scopes", () => {
  const tool = getTools().find((candidate) => candidate.function.name === "bash");
  assert.ok(tool);
  assert.deepEqual(tool.function.parameters.required, ["command", "sideEffects"]);
  const sideEffects = tool.function.parameters.properties.sideEffects as {
    type?: unknown;
    items?: { enum?: unknown[] };
  };
  assert.equal(sideEffects.type, "array");
  assert.equal(sideEffects.items?.enum?.includes("write-out-cwd"), true);
  assert.equal(sideEffects.items?.enum?.includes("unknown"), true);
  const runInBackground = tool.function.parameters.properties.run_in_background as { type?: unknown };
  assert.equal(runInBackground.type, "boolean");
});

test("getSystemPrompt always includes WebSearch docs", () => {
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes("## WebSearch"), true);
});

test("getSystemPrompt includes UpdatePlan docs", () => {
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes("## UpdatePlan"), true);
  assert.equal(prompt.includes("The `plan` argument is a markdown string, not an array of step objects."), true);
});

test("getSystemPrompt includes Bash background guidance", () => {
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes("run_in_background: true"), true);
  assert.equal(prompt.includes("do NOT add `&`"), true);
  assert.equal(prompt.includes("use the `stopCommand` returned in the tool result metadata"), true);
  assert.equal(prompt.includes("stop background tasks that has not reported a completed state"), true);
});

test("getSystemPrompt does not include runtime context", () => {
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes("# Local Workspace Environment"), false);
  assert.equal(prompt.includes('"root path": "/tmp/project"'), false);
});

test("getDefaultSkillPrompt loads the default skill template", () => {
  const prompt = getDefaultSkillPrompt();

  assert.equal(prompt.includes("<karpathy-guidelines-skill>"), true);
  assert.equal(prompt.includes("# Karpathy Guidelines"), true);
  assert.equal(prompt.includes("Use the skill documents below to assist the user:"), true);
  assert.equal(prompt.includes('path="templates/skills/'), false);
});

test("getDefaultSkillPrompt skips disabled default skills", () => {
  const prompt = getDefaultSkillPrompt({ enabledSkills: { "karpathy-guidelines": false } });

  assert.equal(prompt, "");
});

test("getPlanModePrompt loads the dedicated Plan Mode template", () => {
  const prompt = getPlanModePrompt();
  assert.equal(prompt.includes("# Plan Mode (Conversational)"), true);
  assert.equal(prompt.includes("<proposed_plan>"), true);
});

test("buildSkillDocumentsPrompt excludes SKILL.md frontmatter metadata", () => {
  const prompt = buildSkillDocumentsPrompt([
    {
      name: "example",
      content:
        "---\nname: example\ndescription: Example skill\nlicense: MIT\ncompatibility: Node.js\nallowed-tools: Read Bash\nmetadata:\n  author: test\n  allow-implicit-invocation: false\n---\n# Example Skill\n\nUse these instructions.\n",
    },
  ]);

  assert.equal(prompt.includes("name: example"), true);
  assert.equal(prompt.includes("description: Example skill"), true);
  assert.equal(prompt.includes("license: MIT"), true);
  assert.equal(prompt.includes("compatibility: Node.js"), true);
  assert.equal(prompt.includes("allowed-tools: Read Bash"), true);
  assert.equal(prompt.includes("# Example Skill"), true);
  assert.equal(prompt.includes("Use these instructions."), true);
  assert.equal(prompt.includes("metadata:"), false);
  assert.equal(prompt.includes("author: test"), false);
  assert.equal(prompt.includes("allow-implicit-invocation"), false);
});

test("buildSkillDocumentsPrompt lists skill resources", () => {
  const skillDir = createTempDir("deepcode-skill-resources-");
  fs.mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
  const skillPath = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(skillPath, "# PDF Skill\n", "utf8");
  fs.writeFileSync(path.join(skillDir, "scripts", "extract.py"), "print('extract')\n", "utf8");
  fs.writeFileSync(path.join(skillDir, "scripts", "merge.py"), "print('merge')\n", "utf8");
  fs.writeFileSync(path.join(skillDir, "references", "pdf-spec-summary.md"), "# PDF Spec\n", "utf8");

  const prompt = buildSkillDocumentsPrompt([
    { name: "pdf", content: "# PDF Skill", path: skillPath, skillFilePath: skillPath },
  ]);

  assert.equal(prompt.includes(`<pdf-skill path="${skillPath}">`), true);
  assert.equal(prompt.includes("<skill_resources>"), true);
  assert.equal(prompt.includes("<file>scripts/extract.py</file>"), true);
  assert.equal(prompt.includes("<file>scripts/merge.py</file>"), true);
  assert.equal(prompt.includes("<file>references/pdf-spec-summary.md</file>"), true);
  assert.equal(prompt.includes("<file>SKILL.md</file>"), false);
});

test("buildSkillDocumentsPrompt caps large skill resource listings", () => {
  const skillDir = createTempDir("deepcode-skill-resource-cap-");
  const skillPath = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(skillPath, "# Large Skill\n", "utf8");
  for (let index = 0; index < 55; index += 1) {
    fs.writeFileSync(path.join(skillDir, `file-${String(index).padStart(2, "0")}.txt`), "resource\n", "utf8");
  }

  const prompt = buildSkillDocumentsPrompt([
    { name: "large", content: "# Large Skill", path: skillPath, skillFilePath: skillPath },
  ]);

  assert.equal((prompt.match(/<file>/g) ?? []).length, 50);
  assert.equal(prompt.includes("<file>file-49.txt</file>"), true);
  assert.equal(prompt.includes("<file>file-50.txt</file>"), false);
  assert.equal(prompt.includes("Listing capped at 50 files and may be incomplete."), true);
});

test("buildSkillDocumentsPrompt excludes hidden and generated skill resources", () => {
  const skillDir = createTempDir("deepcode-skill-resource-exclusions-");
  fs.mkdirSync(path.join(skillDir, ".hidden"), { recursive: true });
  fs.mkdirSync(path.join(skillDir, "node_modules", "pkg"), { recursive: true });
  fs.mkdirSync(path.join(skillDir, "dist"), { recursive: true });
  const skillPath = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(skillPath, "# Clean Skill\n", "utf8");
  fs.writeFileSync(path.join(skillDir, ".secret.txt"), "hidden\n", "utf8");
  fs.writeFileSync(path.join(skillDir, ".hidden", "file.txt"), "hidden\n", "utf8");
  fs.writeFileSync(path.join(skillDir, "node_modules", "pkg", "index.js"), "module.exports = {}\n", "utf8");
  fs.writeFileSync(path.join(skillDir, "dist", "bundle.js"), "bundle\n", "utf8");
  fs.writeFileSync(path.join(skillDir, "README.md"), "# Resource\n", "utf8");

  const prompt = buildSkillDocumentsPrompt([
    { name: "clean", content: "# Clean Skill", path: skillPath, skillFilePath: skillPath },
  ]);

  assert.equal(prompt.includes("<file>README.md</file>"), true);
  assert.equal(prompt.includes(".secret.txt"), false);
  assert.equal(prompt.includes(".hidden/file.txt"), false);
  assert.equal(prompt.includes("node_modules/pkg/index.js"), false);
  assert.equal(prompt.includes("dist/bundle.js"), false);
});

test("getSystemPrompt does not include current date guidance", () => {
  const now = new Date();
  const expected = `今天是${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日。随着对话的进行，时间在流逝。`;
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes(expected), false);
});

test("getRuntimeContext includes current date and model guidance", () => {
  const now = new Date();
  const expectedDate = `今天是${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日。随着对话的进行，时间在流逝。`;
  const prompt = getRuntimeContext("/tmp/project", "deepseek-v4-pro");
  assert.equal(prompt.includes(expectedDate), true);
  assert.equal(prompt.includes("当前LLM模型为deepseek-v4-pro，对话中可通过/model命令切换模型。"), true);
  assert.equal(prompt.includes("# Local Workspace Environment"), true);
  assert.equal(prompt.includes('"root path": "/tmp/project"'), true);
});

test("getSystemPrompt renders Read docs for non-multimodal models", () => {
  const prompt = getSystemPrompt("/tmp/project", { model: "deepseek-chat" });
  assert.equal(prompt.includes("the current model is not multimodal"), true);
  assert.equal(prompt.includes("the contents are presented visually"), false);
});

test("runtime prompt assets live under templates", () => {
  assert.equal(fs.existsSync(path.join(repoRoot, "templates", "tools", "web-search.md")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "templates", "tools", "read.md.ejs")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "templates", "prompts", "init_command.md.ejs")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "templates", "skills", "karpathy-guidelines.md")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "templates", "tools", "read.md")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "docs", "tools")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "docs", "prompts")), false);
});
