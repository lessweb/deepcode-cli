import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";
import type { AgentManifest } from "./agent-registry";

export type ResolvedSkill = {
  name: string;
  content: string;
  path: string;
};

export type SkillResolverOptions = {
  manifest: AgentManifest;
  globalSkillRoots: string[];
};

/**
 * Resolves skills for a sub-agent.
 * Priority: agent-local skills/ dir > global skill roots.
 * If manifest.skills lists specific names, only those are loaded.
 * If manifest.skills is empty, all local skills are loaded.
 */
export function resolveAgentSkills(options: SkillResolverOptions): ResolvedSkill[] {
  const { manifest, globalSkillRoots } = options;
  const agentDir = path.dirname(manifest.sourcePath);
  const localSkillsDir = path.join(agentDir, "skills");

  const resolved = new Map<string, ResolvedSkill>();

  // Determine which skills to load
  const targetNames = manifest.skills.length > 0 ? manifest.skills : null;

  // Scan local skills directory first (highest priority)
  if (fs.existsSync(localSkillsDir)) {
    const localSkills = scanSkillDirectory(localSkillsDir);
    for (const skill of localSkills) {
      if (targetNames === null || targetNames.includes(skill.name)) {
        resolved.set(skill.name, skill);
      }
    }
  }

  // If specific skills are requested and not all found locally,
  // search global roots
  if (targetNames !== null) {
    for (const skillName of targetNames) {
      if (resolved.has(skillName)) {
        continue;
      }

      let found = false;
      for (const globalRoot of globalSkillRoots) {
        const skillPath = path.join(globalRoot, skillName, "SKILL.md");
        if (fs.existsSync(skillPath)) {
          const skill = readSkillFile(skillPath, skillName);
          if (skill) {
            resolved.set(skillName, skill);
            found = true;
            break;
          }
        }
      }

      if (!found) {
        console.warn(`[skill-resolver] Skill "${skillName}" not found in any scan root`);
      }
    }
  }

  return Array.from(resolved.values());
}

function scanSkillDirectory(dir: string): ResolvedSkill[] {
  const skills: ResolvedSkill[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      const skillPath = path.join(dir, entry.name, "SKILL.md");
      if (fs.existsSync(skillPath)) {
        const skill = readSkillFile(skillPath, entry.name);
        if (skill) {
          skills.push(skill);
        }
      }
    }
  } catch {
    // skip unreadable directories
  }
  return skills;
}

function readSkillFile(skillPath: string, name: string): ResolvedSkill | null {
  try {
    const raw = fs.readFileSync(skillPath, "utf8");
    const parsed = matter(raw);
    return {
      name: typeof parsed.data?.name === "string" ? parsed.data.name : name,
      content: raw,
      path: skillPath,
    };
  } catch {
    return null;
  }
}
