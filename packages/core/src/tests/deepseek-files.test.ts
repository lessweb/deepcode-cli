import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  decodeDeepSeekImageDataUrl,
  DEEPSEEK_FILES_BASE_URL,
  DeepSeekFilesClient,
  DeepSeekFileStore,
  MAX_DEEPSEEK_FILE_BYTES,
  validateDeepSeekFileSize,
} from "../common/deepseek-files";

const POLICY = {
  timeoutMs: 60_000,
  expiresAfterSeconds: 604_800,
  refreshMarginSeconds: 3_600,
  quotaCleanupBatch: 100,
};

function uploadedFile(id: string, nowSeconds = 1_800_000_000): Record<string, unknown> {
  return {
    id,
    object: "file",
    bytes: 5,
    created_at: nowSeconds,
    filename: "deepcode-image.png",
    purpose: "user_data",
    expires_at: nowSeconds + POLICY.expiresAfterSeconds,
  };
}

test("DeepSeekFilesClient uploads multipart data to the fixed official endpoint", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const client = new DeepSeekFilesClient("sk-secret", async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return Response.json(uploadedFile("file-1"));
  });
  const image = decodeDeepSeekImageDataUrl("data:image/png;base64,aGVsbG8=");

  const result = await client.upload(image, POLICY.expiresAfterSeconds);

  assert.equal(requestUrl, `${DEEPSEEK_FILES_BASE_URL}/files`);
  assert.equal(requestInit?.method, "POST");
  assert.equal((requestInit?.headers as Record<string, string>).authorization, "Bearer sk-secret");
  assert.ok(requestInit?.body instanceof FormData);
  const form = requestInit.body as FormData;
  assert.equal(form.get("purpose"), "user_data");
  assert.equal(form.get("expires_after[anchor]"), "created_at");
  assert.equal(form.get("expires_after[seconds]"), "604800");
  assert.equal(result.id, "file-1");
});

test("DeepSeekFileStore reuses cached uploads without persisting the API key", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-files-cache-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cachePath = path.join(dir, "files.json");
  let uploads = 0;
  const store = new DeepSeekFileStore(
    cachePath,
    async (_input, init) => {
      assert.equal(init?.method, "POST");
      uploads += 1;
      return Response.json(uploadedFile(`file-${uploads}`));
    },
    () => 1_800_000_000 * 1000
  );
  const image = decodeDeepSeekImageDataUrl("data:image/png;base64,aGVsbG8=");

  const first = await store.ensureUploaded(image, "sk-cache-secret", POLICY);
  const second = await store.ensureUploaded(image, "sk-cache-secret", POLICY);

  assert.equal(first.fileId, "file-1");
  assert.equal(second.fileId, "file-1");
  assert.equal(uploads, 1);
  assert.equal(fs.readFileSync(cachePath, "utf8").includes("sk-cache-secret"), false);
});

test("DeepSeekFileStore cleans only owned files before one quota retry", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-files-quota-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const methods: string[] = [];
  let uploads = 0;
  const store = new DeepSeekFileStore(path.join(dir, "files.json"), async (input, init) => {
    const url = String(input);
    methods.push(`${init?.method} ${url}`);
    if (init?.method === "POST") {
      uploads += 1;
      if (uploads === 1) {
        return Response.json(
          { error: { code: "storage_quota_exceeded", message: "storage quota exceeded" } },
          { status: 400 }
        );
      }
      return Response.json(uploadedFile("file-retry"));
    }
    if (init?.method === "GET") {
      return Response.json({
        object: "list",
        data: [
          { ...uploadedFile("foreign"), filename: "other-client.png" },
          { ...uploadedFile("owned"), filename: "deepcode-old.png" },
        ],
        has_more: false,
      });
    }
    return Response.json({ id: "owned", object: "file", deleted: true });
  });

  const result = await store.ensureUploaded(
    decodeDeepSeekImageDataUrl("data:image/png;base64,aGVsbG8="),
    "sk-quota",
    POLICY
  );

  assert.equal(result.fileId, "file-retry");
  assert.equal(uploads, 2);
  assert.equal(
    methods.some((entry) => entry.includes("/files/owned")),
    true
  );
  assert.equal(
    methods.some((entry) => entry.includes("/files/foreign")),
    false
  );
});

test("DeepSeek Files API exposes the documented 64 MiB per-file limit", () => {
  assert.equal(MAX_DEEPSEEK_FILE_BYTES, 64 * 1024 * 1024);
  assert.doesNotThrow(() => validateDeepSeekFileSize(MAX_DEEPSEEK_FILE_BYTES));
  assert.throws(() => validateDeepSeekFileSize(MAX_DEEPSEEK_FILE_BYTES + 1), /64 MiB/);
});
