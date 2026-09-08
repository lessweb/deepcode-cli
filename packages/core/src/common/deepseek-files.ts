import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const DEEPSEEK_FILES_BASE_URL = "https://api.deepseek.com";
export const MAX_DEEPSEEK_FILE_BYTES = 64 * 1024 * 1024;

export type DeepSeekFilesPolicy = {
  timeoutMs: number;
  expiresAfterSeconds: number;
  refreshMarginSeconds: number;
  quotaCleanupBatch: number;
};

export type DeepSeekImage = {
  buffer: Buffer;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  hash: string;
};

export type DeepSeekFileReference = {
  fileId: string;
  imageHash: string;
  bytes: number;
};

type CachedFile = DeepSeekFileReference & {
  scope: string;
  createdAt: number;
  expiresAt: number;
};

type CacheFile = {
  version: 1;
  files: CachedFile[];
};

type RemoteFile = {
  id: string;
  bytes: number;
  filename: string;
  createdAt: number;
  expiresAt?: number;
};

export class DeepSeekFilesApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string
  ) {
    super(message);
    this.name = "DeepSeekFilesApiError";
  }
}

export function validateDeepSeekFileSize(bytes: number, index = 0): void {
  if (bytes > MAX_DEEPSEEK_FILE_BYTES) {
    throw new Error(`Image #${index + 1} exceeds the DeepSeek Files API 64 MiB limit.`);
  }
}

function isQuotaError(error: unknown): error is DeepSeekFilesApiError {
  return (
    error instanceof DeepSeekFilesApiError &&
    /(?:quota|storage|stored files|file count|too many files)/i.test(error.detail)
  );
}

function parseRemoteFile(value: unknown, operation: string): RemoteFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`DeepSeek Files API returned an invalid ${operation} response.`);
  }
  const file = value as Record<string, unknown>;
  if (
    typeof file.id !== "string" ||
    !file.id ||
    file.object !== "file" ||
    !Number.isSafeInteger(file.bytes) ||
    (file.bytes as number) < 0 ||
    !Number.isSafeInteger(file.created_at) ||
    (file.created_at as number) < 0 ||
    typeof file.filename !== "string" ||
    !file.filename ||
    file.purpose !== "user_data" ||
    (file.expires_at !== undefined && (!Number.isSafeInteger(file.expires_at) || (file.expires_at as number) < 0))
  ) {
    throw new Error(`DeepSeek Files API returned an invalid ${operation} response.`);
  }
  return {
    id: file.id,
    bytes: file.bytes as number,
    filename: file.filename,
    createdAt: file.created_at as number,
    ...(file.expires_at === undefined ? {} : { expiresAt: file.expires_at as number }),
  };
}

function errorFields(value: unknown): { message?: string; detail: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { detail: "" };
  }
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return { detail: "" };
  }
  const fields = error as Record<string, unknown>;
  const message = typeof fields.message === "string" ? fields.message : undefined;
  return {
    ...(message ? { message } : {}),
    detail: [fields.code, fields.type, fields.message]
      .filter((field): field is string => typeof field === "string")
      .join(" "),
  };
}

export function decodeDeepSeekImageDataUrl(dataUrl: string, index = 0): DeepSeekImage {
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) {
    throw new Error(`Image #${index + 1} is invalid or unsupported. Only JPEG, PNG, and WebP are supported.`);
  }
  const buffer = Buffer.from(match[2].replace(/[\r\n]/g, ""), "base64");
  validateDeepSeekFileSize(buffer.byteLength, index);
  const rawMediaType = match[1].toLowerCase();
  const mediaType = rawMediaType === "image/jpg" ? "image/jpeg" : rawMediaType;
  const extension = mediaType === "image/png" ? "png" : mediaType === "image/webp" ? "webp" : "jpg";
  return {
    buffer,
    mediaType: mediaType as DeepSeekImage["mediaType"],
    extension,
    hash: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

export class DeepSeekFilesClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch
  ) {}

  private async request(resource: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${DEEPSEEK_FILES_BASE_URL}${resource}`, {
        ...init,
        headers: { authorization: `Bearer ${this.apiKey}`, ...(init.headers ?? {}) },
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : error;
      }
      throw new Error("DeepSeek Files API request failed.", { cause: error });
    }
    if (response.ok) {
      return response;
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = undefined;
    }
    const fields = errorFields(parsed);
    throw new DeepSeekFilesApiError(
      fields.message ?? `DeepSeek Files API error (HTTP ${response.status}).`,
      response.status,
      fields.detail
    );
  }

  async upload(image: DeepSeekImage, expiresAfterSeconds: number, signal?: AbortSignal): Promise<RemoteFile> {
    const form = new FormData();
    form.set("purpose", "user_data");
    form.set("expires_after[anchor]", "created_at");
    form.set("expires_after[seconds]", String(expiresAfterSeconds));
    form.set(
      "file",
      new Blob([Uint8Array.from(image.buffer).buffer], { type: image.mediaType }),
      `deepcode-${image.hash.slice(0, 24)}.${image.extension}`
    );
    const response = await this.request("/files", { method: "POST", body: form }, signal);
    const file = parseRemoteFile(await response.json(), "upload");
    if (file.expiresAt === undefined || file.bytes !== image.buffer.byteLength) {
      throw new Error("DeepSeek Files API upload response does not match the submitted image.");
    }
    return file;
  }

  async list(
    after: string | undefined,
    signal?: AbortSignal
  ): Promise<{ files: RemoteFile[]; lastId?: string; hasMore: boolean }> {
    const query = new URLSearchParams({ purpose: "user_data", limit: "1000", order: "asc" });
    if (after) {
      query.set("after", after);
    }
    const response = await this.request(`/files?${query.toString()}`, { method: "GET" }, signal);
    const value = (await response.json()) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      value.object !== "list" ||
      !Array.isArray(value.data) ||
      typeof value.has_more !== "boolean" ||
      (value.last_id !== undefined && typeof value.last_id !== "string")
    ) {
      throw new Error("DeepSeek Files API returned an invalid list response.");
    }
    return {
      files: value.data.map((file) => parseRemoteFile(file, "list")),
      ...(typeof value.last_id === "string" ? { lastId: value.last_id } : {}),
      hasMore: value.has_more,
    };
  }

  async delete(fileId: string, signal?: AbortSignal): Promise<void> {
    const response = await this.request(`/files/${encodeURIComponent(fileId)}`, { method: "DELETE" }, signal);
    const value = (await response.json()) as Record<string, unknown>;
    if (!value || value.id !== fileId || value.object !== "file" || value.deleted !== true) {
      throw new Error("DeepSeek Files API returned an invalid delete response.");
    }
  }
}

export class DeepSeekFileStore {
  private readonly inflight = new Map<string, Promise<DeepSeekFileReference>>();

  constructor(
    private readonly cachePath = path.join(os.homedir(), ".deepcode", "files-api-cache.json"),
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly now: () => number = Date.now
  ) {}

  private scope(apiKey: string): string {
    return crypto.createHash("sha256").update(DEEPSEEK_FILES_BASE_URL).update("\0").update(apiKey).digest("hex");
  }

  private load(): CacheFile {
    try {
      const value = JSON.parse(fs.readFileSync(this.cachePath, "utf8")) as CacheFile;
      if (value.version !== 1 || !Array.isArray(value.files)) {
        return { version: 1, files: [] };
      }
      return { version: 1, files: value.files.filter((file) => this.isCachedFile(file)) };
    } catch {
      return { version: 1, files: [] };
    }
  }

  private isCachedFile(value: unknown): value is CachedFile {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const file = value as Record<string, unknown>;
    return (
      typeof file.scope === "string" &&
      /^[0-9a-f]{64}$/.test(file.scope) &&
      typeof file.imageHash === "string" &&
      /^[0-9a-f]{64}$/.test(file.imageHash) &&
      typeof file.fileId === "string" &&
      Boolean(file.fileId) &&
      Number.isSafeInteger(file.bytes) &&
      Number.isSafeInteger(file.createdAt) &&
      Number.isSafeInteger(file.expiresAt)
    );
  }

  private save(cache: CacheFile): void {
    fs.mkdirSync(path.dirname(this.cachePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.cachePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      fs.renameSync(temporaryPath, this.cachePath);
    } finally {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // The rename normally consumes the temporary file.
      }
    }
  }

  async ensureUploaded(
    image: DeepSeekImage,
    apiKey: string,
    policy: DeepSeekFilesPolicy,
    signal?: AbortSignal
  ): Promise<DeepSeekFileReference> {
    const scope = this.scope(apiKey);
    const key = `${scope}:${image.hash}`;
    const cached = this.load().files.find(
      (file) =>
        file.scope === scope &&
        file.imageHash === image.hash &&
        file.expiresAt - this.now() > policy.refreshMarginSeconds * 1000
    );
    if (cached) {
      return { fileId: cached.fileId, imageHash: cached.imageHash, bytes: cached.bytes };
    }
    const active = this.inflight.get(key);
    if (active) {
      return active;
    }
    const operation = this.upload(image, apiKey, policy, signal).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, operation);
    return operation;
  }

  private async upload(
    image: DeepSeekImage,
    apiKey: string,
    policy: DeepSeekFilesPolicy,
    signal?: AbortSignal
  ): Promise<DeepSeekFileReference> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error(`DeepSeek Files API timed out after ${policy.timeoutMs}ms.`)),
      policy.timeoutMs
    );
    try {
      const client = new DeepSeekFilesClient(apiKey, this.fetchImpl);
      let remote: RemoteFile;
      try {
        remote = await client.upload(image, policy.expiresAfterSeconds, controller.signal);
      } catch (error) {
        if (!isQuotaError(error)) {
          throw error;
        }
        const deleted = await this.cleanupOldestOwned(client, policy.quotaCleanupBatch, controller.signal);
        if (deleted === 0) {
          throw error;
        }
        remote = await client.upload(image, policy.expiresAfterSeconds, controller.signal);
      }
      const scope = this.scope(apiKey);
      const cache = this.load();
      const files = cache.files.filter(
        (file) => file.expiresAt > this.now() && !(file.scope === scope && file.imageHash === image.hash)
      );
      files.push({
        scope,
        imageHash: image.hash,
        fileId: remote.id,
        bytes: remote.bytes,
        createdAt: remote.createdAt * 1000,
        expiresAt: remote.expiresAt! * 1000,
      });
      this.save({ version: 1, files });
      return { fileId: remote.id, imageHash: image.hash, bytes: remote.bytes };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private async cleanupOldestOwned(client: DeepSeekFilesClient, count: number, signal: AbortSignal): Promise<number> {
    const owned: string[] = [];
    let after: string | undefined;
    while (owned.length < count) {
      const page = await client.list(after, signal);
      for (const file of page.files) {
        if (file.filename.startsWith("deepcode-")) {
          owned.push(file.id);
        }
        if (owned.length === count) {
          break;
        }
      }
      if (!page.hasMore || !page.lastId || page.lastId === after) {
        break;
      }
      after = page.lastId;
    }
    for (const fileId of owned) {
      await client.delete(fileId, signal);
    }
    return owned.length;
  }

  invalidate(reference: DeepSeekFileReference, apiKey: string): void {
    const scope = this.scope(apiKey);
    const cache = this.load();
    const files = cache.files.filter(
      (file) => !(file.scope === scope && file.imageHash === reference.imageHash && file.fileId === reference.fileId)
    );
    if (files.length !== cache.files.length) {
      this.save({ version: 1, files });
    }
  }
}
