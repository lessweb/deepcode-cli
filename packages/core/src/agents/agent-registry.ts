import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import matter from "gray-matter";

export type AgentManifest = {
  name: string;
  description: string;
  model: string;
  skills: string[];
  instructions: string;
  sourcePath: string;
  sourceRoot: string;
};

export type AgentScanRoot = {
  root: string;
  displayRoot: string;
};

export class AgentRegistry {
  private agents = new Map<string, AgentManifest>();
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Scan all agent roots in priority order.
   * First-found wins for deduplication by agent name.
   */
  scan(): void {
    this.agents.clear();
    const roots = this.getScanRoots();

    for (const { root, displayRoot } of roots) {
      if (!fs.existsSync(root)) {
        continue;
      }

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) {
          continue;
        }

        const agentDir = path.join(root, entry.name);
        const manifestPath = path.join(agentDir, "AGENT.md");

        if (!fs.existsSync(manifestPath)) {
          continue;
        }

        const manifest = this.parseManifest(manifestPath, entry.name, displayRoot);
        if (manifest && !this.agents.has(manifest.name)) {
          this.agents.set(manifest.name, manifest);
        }
      }
    }
  }

  listAgents(): AgentManifest[] {
    return Array.from(this.agents.values());
  }

  getAgent(name: string): AgentManifest | undefined {
    return this.agents.get(name);
  }

  hasAgents(): boolean {
    return this.agents.size > 0;
  }

  private getScanRoots(): AgentScanRoot[] {
    const homeDir = os.homedir();
    return [
      { root: path.join(this.projectRoot, ".deepcode", "agents"), displayRoot: "./.deepcode/agents" },
      { root: path.join(homeDir, ".deepcode", "agents"), displayRoot: "~/.deepcode/agents" },
    ];
  }

  private parseManifest(manifestPath: string, dirName: string, sourceRoot: string): AgentManifest | null {
    try {
      const raw = fs.readFileSync(manifestPath, "utf8");
      const parsed = matter(raw);
      const data = parsed.data as Record<string, unknown>;
      // A document is treated as YAML frontmatter if it actually starts with
      // a frontmatter delimiter (gray-matter's own detection), even if the
      // frontmatter block is empty (e.g. "---\n---\n"). Plain-markdown files
      // that don't start with "---" fall back to parsePlainMetadata below.
      const hasFrontmatter = matter.test(raw);

      if (hasFrontmatter) {
        return {
          name: typeof data.name === "string" ? data.name : dirName,
          description: typeof data.description === "string" ? data.description : "",
          model: typeof data.model === "string" ? data.model : "default",
          skills: Array.isArray(data.skills) ? data.skills.filter((s): s is string => typeof s === "string") : [],
          instructions: parsed.content.trim(),
          sourcePath: manifestPath,
          sourceRoot,
        };
      }

      const plain = parsePlainMetadata(raw);
      return {
        name: plain.name ?? dirName,
        description: plain.description,
        model: plain.model,
        skills: plain.skills,
        instructions: plain.instructions,
        sourcePath: manifestPath,
        sourceRoot,
      };
    } catch {
      // Invalid YAML frontmatter — skip with warning
      return null;
    }
  }
}

/**
 * Fallback parser for AGENT.md files that don't use YAML frontmatter.
 * Extracts metadata from plain-markdown conventions:
 * - `# <name>` heading
 * - `> <description>` blockquote or `**Description**: <description>` bold-label line
 * - `**Model**: <model>` bold-label line
 * - `**Skills**: <a, b, c>` bold-label line
 * - Instructions are everything after the first bare `---` line following metadata.
 */
function parsePlainMetadata(raw: string): {
  name: string | null;
  description: string;
  model: string;
  skills: string[];
  instructions: string;
} {
  const lines = raw.split(/\r?\n/);
  let description = "";
  let model = "default";
  let skills: string[] = [];
  let name: string | null = null;
  let foundMetadata = false;
  let bodyStartIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    if (name === null) {
      const headingMatch = line.match(/^#\s+(.+)$/);
      if (headingMatch) {
        name = headingMatch[1]!.trim();
        continue;
      }
    }

    const descBoldMatch = line.match(/^-?\s*\*\*Description\*\*\s*:\s*(.+)$/i);
    if (descBoldMatch) {
      description = descBoldMatch[1]!.trim();
      foundMetadata = true;
      continue;
    }

    if (!description) {
      const blockquoteMatch = line.match(/^>\s*(.+)$/);
      if (blockquoteMatch) {
        description = blockquoteMatch[1]!.trim();
        foundMetadata = true;
        continue;
      }
    }

    const modelMatch = line.match(/^-?\s*\*\*Model\*\*\s*:\s*(.+)$/i);
    if (modelMatch) {
      model = modelMatch[1]!.trim();
      foundMetadata = true;
      continue;
    }

    const skillsMatch = line.match(/^-?\s*\*\*Skills\*\*\s*:\s*(.+)$/i);
    if (skillsMatch) {
      skills = skillsMatch[1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      foundMetadata = true;
      continue;
    }

    if (foundMetadata && line === "---") {
      bodyStartIndex = i + 1;
      break;
    }
  }

  const instructions = bodyStartIndex >= 0 ? lines.slice(bodyStartIndex).join("\n").trim() : raw.trim();

  return { name, description, model, skills, instructions };
}
