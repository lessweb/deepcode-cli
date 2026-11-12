import { parseArguments } from "./cli-args";
import { getPackageJson } from "./utils/package";

async function main(): Promise<void> {
  const parsed = await parseArguments();
  if (parsed.version || parsed.help) return;
  if (parsed.doctor) {
    const { runDoctor } = await import("./doctor");
    process.exitCode = await runDoctor({ settingsFile: parsed.settingsFile });
    return;
  }
  if (parsed.plus) {
    const { runPlusSetup } = await import("./plus-setup");
    process.exitCode = await runPlusSetup();
    return;
  }
  const { runCliApp } = await import("./cli-app");
  await runCliApp(parsed, await getPackageJson());
}

void main();
