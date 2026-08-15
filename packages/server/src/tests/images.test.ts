import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { normalizeImageList } from "../services/images";

test("normalizeImageList keeps remote and data image URLs", async () => {
  const result = await normalizeImageList(process.cwd(), [
    "https://example.com/image.png",
    "data:image/png;base64,AAAA",
  ]);
  assert.deepEqual(result, { ok: true, data: ["https://example.com/image.png", "data:image/png;base64,AAAA"] });
});

test("normalizeImageList rejects blob URLs", async () => {
  const result = await normalizeImageList(process.cwd(), "blob:https://example.com/image");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /blob image URLs/u);
  }
});

test("normalizeImageList reads project-local files asynchronously", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepcode-server-images-"));
  try {
    await fs.writeFile(path.join(root, "pixel.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = await normalizeImageList(root, { path: "pixel.png" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.data[0] ?? "", /^data:image\/png;base64,/u);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("normalizeImageList rejects paths outside project root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepcode-server-images-"));
  try {
    const result = await normalizeImageList(root, "../outside.png");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /inside the project root/u);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
