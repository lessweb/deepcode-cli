import * as path from "path";
import {
  getDefaultSettingsTarget,
  getProjectSettingsPath,
  getUserSettingsPath,
  mergePermissions,
  PERMISSION_SCOPES,
  readEditableSettings,
  writeProjectSettings,
  writeSettings,
  type DeepcodingSettings,
  type PermissionDefaultMode,
  type PermissionScope,
  type PermissionSettings,
  type SettingsTarget,
} from "./settings";

export type PermissionScopeSelection = "allow" | "deny" | "ask" | "default";

export type PermissionSettingsChanges = {
  defaultMode?: PermissionDefaultMode;
  scopes?: Partial<Record<PermissionScope, PermissionScopeSelection>>;
};

export type PermissionSettingsEdit = {
  target: SettingsTarget;
  sameFile?: boolean;
  permissions?: PermissionSettings;
  otherPermissions?: PermissionSettings;
};

/** Editing must not mistake an unreadable or malformed file for an empty one. */
function readEditablePermissionSettings(settingsPath: string): DeepcodingSettings {
  const settings = readEditableSettings(settingsPath);
  const permissions = settings.permissions;
  if (permissions !== undefined) {
    if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
      throw new Error(`Invalid permissions in ${settingsPath}`);
    }
    for (const key of ["allow", "deny", "ask"] as const) {
      const list = permissions[key];
      if (list !== undefined && (!Array.isArray(list) || list.some((scope) => typeof scope !== "string"))) {
        throw new Error(`Invalid permissions.${key} in ${settingsPath}`);
      }
    }
    if (permissions.defaultMode !== undefined && !["askAll", "allowAll"].includes(permissions.defaultMode)) {
      throw new Error(`Invalid permissions.defaultMode in ${settingsPath}`);
    }
  }
  return settings;
}

function readPermissionSettingsTarget(
  projectRoot: string,
  target: PermissionSettingsEdit["target"]
): {
  settings: DeepcodingSettings;
  otherSettings: DeepcodingSettings;
  edit: PermissionSettingsEdit;
} {
  const projectPath = getProjectSettingsPath(projectRoot);
  const userPath = getUserSettingsPath();
  const sameFile = path.resolve(projectPath) === path.resolve(userPath);
  const settings = readEditablePermissionSettings(target === "project" ? projectPath : userPath);
  const otherSettings = sameFile ? {} : readEditablePermissionSettings(target === "project" ? userPath : projectPath);
  return {
    settings,
    otherSettings,
    edit: { target, permissions: settings.permissions, otherPermissions: otherSettings.permissions, sameFile },
  };
}

export function readPermissionSettingsEdit(projectRoot: string = process.cwd()): PermissionSettingsEdit {
  const target = getDefaultSettingsTarget(projectRoot);
  return readPermissionSettingsTarget(projectRoot, target).edit;
}

export function getPermissionScopeSelection(
  permissions: PermissionSettings | undefined,
  scope: PermissionScope
): PermissionScopeSelection {
  for (const decision of ["deny", "ask", "allow"] as const) {
    if (permissions?.[decision]?.includes(scope)) return decision;
  }
  return "default";
}

export function applyPermissionSettingsChanges(
  settings: DeepcodingSettings,
  changes: PermissionSettingsChanges,
  currentDefaultMode: PermissionDefaultMode
): DeepcodingSettings {
  const permissions = { ...settings.permissions };
  let changed = false;
  if (changes.defaultMode !== undefined && changes.defaultMode !== permissions.defaultMode) {
    permissions.defaultMode = changes.defaultMode;
    changed = true;
  }
  for (const scope of PERMISSION_SCOPES) {
    const selection = changes.scopes?.[scope];
    if (selection === undefined) continue;
    for (const decision of ["allow", "deny", "ask"] as const) {
      const previous = permissions[decision];
      if (selection === decision && previous?.filter((item) => item === scope).length === 1) continue;
      const next = (previous ?? []).filter((item) => item !== scope);
      if (selection === decision) next.push(scope);
      if (JSON.stringify(previous ?? []) !== JSON.stringify(next)) {
        permissions[decision] = next;
        changed = true;
      }
    }
  }
  if (!changed) return settings;
  // A new project permissions object otherwise resets an inherited askAll to allowAll.
  if (!settings.permissions && permissions.defaultMode === undefined) permissions.defaultMode = currentDefaultMode;
  return { ...settings, permissions };
}

export function previewPermissionSettings(
  edit: PermissionSettingsEdit,
  changes: PermissionSettingsChanges = {}
): { permissions: PermissionSettings | undefined; effective: Required<PermissionSettings> } {
  const own = { permissions: edit.permissions };
  const other = {
    permissions:
      edit.target === "user" ? clearProjectPermissionOverrides(edit.otherPermissions, changes) : edit.otherPermissions,
  };
  const merge = (settings: DeepcodingSettings) =>
    edit.target === "project" ? mergePermissions(other, settings) : mergePermissions(settings, other);
  const currentDefaultMode = edit.target === "user" ? mergePermissions(own, null).defaultMode : merge(own).defaultMode;
  const settings = applyPermissionSettingsChanges(own, changes, currentDefaultMode);
  return { permissions: settings.permissions, effective: merge(settings) };
}

function clearProjectPermissionOverrides(
  permissions: PermissionSettings | undefined,
  changes: PermissionSettingsChanges
): PermissionSettings | undefined {
  if (!permissions) return undefined;
  const next = { ...permissions };
  for (const decision of ["allow", "deny", "ask"] as const) {
    if (next[decision]) next[decision] = next[decision].filter((scope) => changes.scopes?.[scope] === undefined);
  }
  // An existing project permissions object always supplies a default mode,
  // even when the defaultMode key is absent. Keep it aligned when explicitly edited.
  if (changes.defaultMode !== undefined) next.defaultMode = changes.defaultMode;
  return next;
}

export function writePermissionSettingsChanges(
  target: PermissionSettingsEdit["target"],
  changes: PermissionSettingsChanges,
  projectRoot: string = process.cwd()
): { changed: boolean } {
  const { settings, otherSettings, edit } = readPermissionSettingsTarget(projectRoot, target);
  const currentDefaultMode =
    target === "user"
      ? mergePermissions(settings, null).defaultMode
      : previewPermissionSettings(edit).effective.defaultMode;
  const next = applyPermissionSettingsChanges(settings, changes, currentDefaultMode);
  const projectPermissions =
    target === "user" ? clearProjectPermissionOverrides(otherSettings.permissions, changes) : undefined;
  const projectChanged =
    target === "user" && JSON.stringify(projectPermissions) !== JSON.stringify(otherSettings.permissions);
  if (next !== settings) {
    if (target === "project") writeProjectSettings(next, projectRoot);
    else writeSettings(next);
  }
  if (projectChanged) writeProjectSettings({ ...otherSettings, permissions: projectPermissions }, projectRoot);
  return { changed: next !== settings || projectChanged };
}
