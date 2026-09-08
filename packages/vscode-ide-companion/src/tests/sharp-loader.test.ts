import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import sharp from "sharp";
import { TENCENT_MIRROR_REGISTRY } from "@vegamo/deepcode-core";
import { buildSharpInstallArgs, createSharpLoader, type SharpInstallProgress } from "../sharp-loader.js";

const tempDirs: string[] = [];
const SHARP_VERSION = "0.35.3";

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Sharp loader reuses a CLI installation without notifying or installing", async () => {
  const storageRoot = createTempDir("deepcode-sharp-loader-cli-");
  let notificationCount = 0;
  let installCount = 0;
  const loader = createSharpLoader(
    {
      workspaceRoot: storageRoot,
      storageRoot,
      sharpVersion: SHARP_VERSION,
      notifyInstalling: async (task) => {
        notificationCount += 1;
        return await task(() => {});
      },
    },
    {
      findCliAnchors: () => ["cli-package.json"],
      loadSharpFromAnchor: (anchor) => (anchor === "cli-package.json" ? sharp : null),
      installSharp: async () => {
        installCount += 1;
      },
    }
  );

  assert.equal(await loader(), sharp);
  assert.equal(notificationCount, 0);
  assert.equal(installCount, 0);
});

test("Sharp loader installs once for concurrent first calls and reuses the cache", async () => {
  const storageRoot = createTempDir("deepcode-sharp-loader-cache-");
  let installed = false;
  let notificationCount = 0;
  let installCount = 0;
  const progressUpdates: SharpInstallProgress[] = [];
  const loader = createSharpLoader(
    {
      workspaceRoot: storageRoot,
      storageRoot,
      sharpVersion: SHARP_VERSION,
      notifyInstalling: async (task) => {
        notificationCount += 1;
        return await task((progress) => progressUpdates.push(progress));
      },
    },
    {
      findCliAnchors: () => [],
      loadSharpFromAnchor: () => (installed ? sharp : null),
      installSharp: async (_installRoot, _version, report) => {
        installCount += 1;
        report({ percent: 20, message: "Downloading..." });
        report({ percent: 90, message: "Installing..." });
        installed = true;
      },
    }
  );

  const [first, second] = await Promise.all([loader(), loader()]);
  const third = await loader();

  assert.equal(first, sharp);
  assert.equal(second, sharp);
  assert.equal(third, sharp);
  assert.equal(notificationCount, 1);
  assert.equal(installCount, 1);
  assert.deepEqual(
    progressUpdates.map(({ percent }) => percent),
    [10, 20, 90, 95, 100]
  );
});

test("Sharp loader retries installation after a failure", async () => {
  const storageRoot = createTempDir("deepcode-sharp-loader-retry-");
  let installed = false;
  let installCount = 0;
  const loader = createSharpLoader(
    {
      workspaceRoot: storageRoot,
      storageRoot,
      sharpVersion: SHARP_VERSION,
      notifyInstalling: async (task) => await task(() => {}),
    },
    {
      findCliAnchors: () => [],
      loadSharpFromAnchor: () => (installed ? sharp : null),
      installSharp: async () => {
        installCount += 1;
        if (installCount === 1) {
          throw new Error("offline");
        }
        installed = true;
      },
    }
  );

  await assert.rejects(loader(), /offline/);
  assert.equal(await loader(), sharp);
  assert.equal(installCount, 2);
});

test("Sharp install uses the npm mirror", () => {
  const args = buildSharpInstallArgs("/tmp/sharp", SHARP_VERSION);

  assert.deepEqual(args.slice(-5), [
    "--registry",
    TENCENT_MIRROR_REGISTRY,
    "--prefix",
    "/tmp/sharp",
    `sharp@${SHARP_VERSION}`,
  ]);
});

test("Sharp tests run against the declared dependency version", () => {
  assert.equal(sharp.versions.sharp, SHARP_VERSION);
});

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
