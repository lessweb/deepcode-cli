import { getPackageJson } from "./package.js";

export async function getCliVersion(): Promise<string> {
  const pkgJson = await getPackageJson();
  return process.env["CLI_VERSION"] || pkgJson?.version || "unknown";
}
