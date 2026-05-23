import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { getDefaultSkillPrompt, getRuntimeContext, getSystemPrompt, getTools } from "../prompt";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

test("getSystemPrompt always includes WebSearch docs", () => {
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes("## WebSearch"), true);
});

test("getSystemPrompt includes UpdatePlan docs", () => {
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes("## UpdatePlan"), true);
  assert.equal(prompt.includes("The `plan` argument is a markdown string, not an array of step objects."), true);
});

test("getSystemPrompt does not include runtime context", () => {
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes("# Local Workspace Environment"), false);
  assert.equal(prompt.includes('"root path": "/tmp/project"'), false);
});

test("getDefaultSkillPrompt loads default skill templates in order", () => {
  const prompt = getDefaultSkillPrompt();
  const agentDriftIndex = prompt.indexOf("<agent-drift-guard-skill>");
  const planIndex = prompt.indexOf("<plan-and-execute-skill>");

  assert.notEqual(agentDriftIndex, -1);
  assert.notEqual(planIndex, -1);
  assert.equal(agentDriftIndex < planIndex, true);
  assert.equal(prompt.includes("Use the skill documents below to assist the user:"), true);
  assert.equal(prompt.includes('path="templates/skills/'), false);
});

test("getSystemPrompt does not include current date guidance", () => {
  const now = new Date();
  const expected = `今天是${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日。随着对话的进行，时间在流逝。`;
  const prompt = getSystemPrompt("/tmp/project");
  assert.equal(prompt.includes(expected), false);
});

test("getRuntimeContext includes current date and model guidance", async () => {
  const now = new Date();
  const expectedDate = `今天是${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日。随着对话的进行，时间在流逝。`;
  const prompt = await getRuntimeContext("/tmp/project", "deepseek-v4-pro");
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
  assert.equal(fs.existsSync(path.join(repoRoot, "templates", "skills", "agent-drift-guard.md")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "templates", "skills", "plan-and-execute.md")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "templates", "tools", "read.md")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "docs", "tools")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "docs", "prompts")), false);
});
