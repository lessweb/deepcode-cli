import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const skillSource = fileURLToPath(new URL("../../templates/skills/bundled/skill-digester/", import.meta.url));

for (const type of ["module", "commonjs"]) {
  test(`skill-digester's documented helper finds skills inside a ${type} package`, () => {
    const root = mkdtempSync(join(tmpdir(), "deepcode-skill-digester-"));
    try {
      const project = join(root, "project");
      const home = join(root, "home");
      const installed = join(project, ".agents", "skills", "skill-digester");
      cpSync(skillSource, installed, { recursive: true });
      mkdirSync(home);
      writeFileSync(join(project, "package.json"), JSON.stringify({ type }));
      const target = join(project, ".agents", "skills", "work-log", "SKILL.md");
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, '---\nname: worklog\ndescription: "Project work log"\n---\n# Work Log\n');
      const instructions = readFileSync(join(installed, "SKILL.md"), "utf8");
      const documentedScript = instructions.match(/scripts\/find-skill\.(?:cjs|js)/)?.[0];
      assert.ok(documentedScript, "the skill must document its helper entry point");

      const result = spawnSync(process.execPath, [join(installed, documentedScript), "worklog", project], {
        cwd: project,
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, HOME: home, USERPROFILE: home, NODE_PATH: "" },
      });

      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.found, true);
      assert.equal(output.activeMatches.length, 1);
      assert.equal(output.activeMatches[0].path, target);
      assert.equal(output.activeMatches[0].description, "Project work log");
      assert.equal(
        output.activeMatches[0].digestTarget.path,
        join(project, ".deepcode", "skills", "work-log", "SKILL.md")
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
