import pkg from "../../package.json" with { type: "json" };
export const APP_NAME: string = pkg.name || "@vegamo/deepcode-cli";
export const APP_VERSION: string = pkg.version || "unknown";
