import { readPackageUp, type PackageJson as BasePackageJson } from "read-package-up";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CLI_VERSION } from "../generated/git-commit";

export type PackageJson = BasePackageJson;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let packageJson: PackageJson;

export async function getPackageJson(): Promise<PackageJson> {
  if (packageJson) {
    return packageJson;
  }

  const result = await readPackageUp({ cwd: __dirname });
  if (!result) {
    return { name: "@vegamo/deepcode-cli", version: CLI_VERSION ?? "" };
  }

  packageJson = result.packageJson;
  return packageJson;
}
