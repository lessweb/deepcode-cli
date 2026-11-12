import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// RFC 9562 UUIDs (versions 1–8), including the special Nil and Max values.
const SESSION_ID_REGEX =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

export function isValidSessionId(value: string): boolean {
  return SESSION_ID_REGEX.test(value);
}

/** Check every project's persisted records without modifying storage. */
export function assertSessionIdAvailable(sessionId: string): void {
  let exists: boolean;
  try {
    exists = hasPersistedSession(sessionId.toLowerCase());
  } catch (error) {
    throw new Error("Unable to verify session ID availability.", { cause: error });
  }
  if (exists) {
    throw new Error(`Session ID "${sessionId}" is already in use.`);
  }
}

function hasPersistedSession(sessionId: string): boolean {
  const projectsDir = path.join(os.homedir(), ".deepcode", "projects");
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }

  for (const project of projects) {
    if (!project.isDirectory() && !project.isSymbolicLink()) continue;
    const projectDir = path.join(projectsDir, project.name);
    const files = fs.readdirSync(projectDir);
    if (files.some((name) => name.toLowerCase() === `${sessionId}.jsonl`)) return true;
    if (!files.includes("sessions-index.json")) continue;

    const index = JSON.parse(fs.readFileSync(path.join(projectDir, "sessions-index.json"), "utf8"));
    if (!Array.isArray(index?.entries)) throw new Error("Invalid session index.");
    for (const entry of index.entries) {
      if (typeof entry?.id !== "string") throw new Error("Invalid session index entry.");
      if (entry.id.toLowerCase() === sessionId) return true;
    }
  }
  return false;
}
