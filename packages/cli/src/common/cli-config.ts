import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type PersistedRawMode = "lite" | "normal";

function getCliConfigPath(): string {
  return path.join(os.homedir(), ".deepcode", "cli.json");
}

function readCliConfig(): Record<string, unknown> {
  let content: string;
  try {
    content = fs.readFileSync(getCliConfigPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const config: unknown = JSON.parse(content);
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Invalid CLI configuration.");
  }
  return config as Record<string, unknown>;
}

export function readRawMode(): PersistedRawMode {
  try {
    return readCliConfig().rawMode === "normal" ? "normal" : "lite";
  } catch {
    return "lite";
  }
}

export function writeRawMode(rawMode: PersistedRawMode): void {
  const config = { ...readCliConfig(), rawMode };
  const configPath = getCliConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporaryPath, configPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}
