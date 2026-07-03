import pkg from "../../package.json" with { type: "json" };
export const APP_NAME: string = pkg.name || "@vegamo/deepcode-core";
export const APP_VERSION: string = pkg.version || "unknown";
