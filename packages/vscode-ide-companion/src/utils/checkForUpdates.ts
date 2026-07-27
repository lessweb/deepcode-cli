import * as vscode from "vscode";
import semver from "semver";

interface MarketplaceExtension {
  versions?: Array<{ version: string }>;
}

interface MarketplaceResponse {
  results?: Array<{ extensions?: MarketplaceExtension[] }>;
}

interface CheckForUpdatesContext {
  extension: {
    id: string;
    packageJSON: { version: string };
  };
}

export async function checkForUpdates(context: CheckForUpdatesContext, log: (message: string) => void): Promise<void> {
  try {
    const extensionId = context.extension.id;
    const currentVersion = context.extension.packageJSON.version;

    const response = await fetch("https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json;api-version=7.1-preview.1",
      },
      body: JSON.stringify({
        filters: [
          {
            criteria: [{ filterType: 7, value: extensionId }],
          },
        ],
        flags: 946,
      }),
    });

    if (!response.ok) {
      log(`Failed to fetch latest version info: ${response.statusText}`);
      return;
    }

    const data = (await response.json()) as MarketplaceResponse;
    const extension = data?.results?.[0]?.extensions?.[0];
    const latestVersion = extension?.versions?.[0]?.version;

    if (latestVersion && semver.gt(latestVersion, currentVersion)) {
      const selection = await vscode.window.showInformationMessage(
        `A new version (${latestVersion}) of this extension is available.`,
        "Update"
      );
      if (selection === "Update") {
        await vscode.commands.executeCommand("workbench.extensions.installExtension", extensionId);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error checking for extension updates: ${message}`);
  }
}
