/**
 * Prompt content helpers.
 *
 * Summary:
 * Converts request payloads into core UserPromptContent values. This module is
 * intentionally limited to payload normalization and does not execute prompts.
 *
 * Exports:
 * - buildPromptContent(projectRoot: string, body: RequestBody)
 */
import type { SkillInfo, UserPromptContent } from "@vegamo/deepcode-core";
import { normalizeImageList } from "./images";
import { normalizePermissionScopes, normalizeUserPermissions } from "./permissions";
import type { RequestBody } from "./request-body";

export function buildPromptContent(
  projectRoot: string,
  body: RequestBody
): { ok: true; data: UserPromptContent } | { ok: false; error: string } {
  const text = typeof body.text === "string" ? body.text : typeof body.prompt === "string" ? body.prompt : "";
  const images = normalizeImageList(projectRoot, body.images ?? body.imageUrls);
  if (!images.ok) {
    return images;
  }
  const userPermissions = normalizeUserPermissions(body.permissions ?? body.decisions);
  return {
    ok: true,
    data: {
      text,
      skills: normalizeSkillList(body.skills),
      imageUrls: images.data.length > 0 ? images.data : undefined,
      permissions: userPermissions.length > 0 ? userPermissions : undefined,
      alwaysAllows: normalizePermissionScopes(body.alwaysAllows),
    },
  };
}

function normalizeSkillList(value: unknown): SkillInfo[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const skills = value.filter((item): item is SkillInfo => isRecord(item) && typeof item.name === "string");
  return skills.length > 0 ? skills : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
