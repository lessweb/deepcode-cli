import React, { useState } from "react";
import { Box, Text, useWindowSize } from "ink";
import {
  getPermissionScopeSelection,
  PERMISSION_SCOPES,
  previewPermissionSettings,
  type PermissionDefaultMode,
  type PermissionScope,
  type PermissionScopeSelection,
  type PermissionSettingsChanges,
  type PermissionSettingsEdit,
} from "@vegamo/deepcode-core";
import DropdownMenu, { type DropdownMenuItem } from "../DropdownMenu";
import SaveScopeSelector from "../SaveScopeSelector";
import { useTerminalInput } from "../../hooks";

const MODES: PermissionDefaultMode[] = ["askAll", "allowAll"];
const DECISIONS: PermissionScopeSelection[] = ["allow", "deny", "ask", "default"];
const DECISION_DESCRIPTIONS = ["Allow automatically", "Block", "Ask before proceeding", "Remove this level's rule"];

type Props = {
  edit: PermissionSettingsEdit;
  width: number;
  onClose: () => void;
  onSave: (target: PermissionSettingsEdit["target"], changes: PermissionSettingsChanges) => string | Promise<string>;
  onStatusMessage: (message: string) => void;
};

export function describeScopeSetting(
  edit: PermissionSettingsEdit,
  changes: PermissionSettingsChanges,
  scope: PermissionScope
): string {
  const { permissions, effective } = previewPermissionSettings(edit, changes);
  const selected = getPermissionScopeSelection(permissions, scope);
  const explicit = getPermissionScopeSelection(effective, scope);
  const decision = explicit === "default" ? (effective.defaultMode === "askAll" ? "ask" : "allow") : explicit;
  if (selected === decision) return selected;
  const otherSource = edit.target === "project" ? "User" : "Project";
  const projectPermissions = edit.target === "project" ? permissions : edit.otherPermissions;
  const userPermissions = edit.target === "user" ? permissions : edit.otherPermissions;
  const source =
    explicit !== "default" ? otherSource : projectPermissions ? "Project" : userPermissions ? "User" : "defaultMode";
  return `${selected} · effective: ${decision} (${source})`;
}

export default function PermissionsDropdown({
  edit: initialEdit,
  width,
  onClose,
  onSave,
  onStatusMessage,
}: Props): React.ReactElement {
  const { rows } = useWindowSize();
  const [target, setTarget] = useState(initialEdit.target);
  const edit: PermissionSettingsEdit =
    target === initialEdit.target || initialEdit.sameFile
      ? { ...initialEdit, target }
      : { target, permissions: initialEdit.otherPermissions, otherPermissions: initialEdit.permissions };
  const [step, setStep] = useState<"home" | "defaultMode" | "scopes" | "scope">("home");
  const [activeIndex, setActiveIndex] = useState(0);
  const [scopeIndex, setScopeIndex] = useState(0);
  const [changes, setChanges] = useState<PermissionSettingsChanges>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const scope = PERMISSION_SCOPES[scopeIndex]!;
  const { permissions, effective } = previewPermissionSettings(edit, changes);
  const currentMode = permissions ? (permissions.defaultMode ?? "allowAll") : effective.defaultMode;
  const targetLabel = edit.target === "project" ? "Project" : "User";

  async function save(nextChanges: PermissionSettingsChanges): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const message = await onSave(edit.target, nextChanges);
      onStatusMessage(message);
      onClose();
    } catch (cause) {
      setError(`Could not save permissions: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setSaving(false);
    }
  }

  let items: DropdownMenuItem[];
  if (step === "home") {
    items = [
      { key: "defaultMode", label: "defaultMode", description: currentMode },
      { key: "scopes", label: "scopes" },
      { key: "save", label: "Save" },
    ];
  } else if (step === "defaultMode") {
    items = MODES.map((mode) => ({ key: mode, label: mode, selected: mode === currentMode }));
  } else if (step === "scopes") {
    items = PERMISSION_SCOPES.map((item) => ({
      key: item,
      label: item,
      description: describeScopeSetting(edit, changes, item),
    }));
  } else {
    items = DECISIONS.map((decision, index) => {
      const description = describeScopeSetting(
        edit,
        { ...changes, scopes: { ...changes.scopes, [scope]: decision } },
        scope
      );
      const effectiveHint = description.includes(" · ") ? description.slice(description.indexOf(" · ")) : "";
      return {
        key: decision,
        label: decision,
        selected: decision === getPermissionScopeSelection(permissions, scope),
        description: `${DECISION_DESCRIPTIONS[index]}${effectiveHint}`,
      };
    });
  }

  useTerminalInput((input, key) => {
    if (saving || key.paste || key.tab) return;
    if (step === "home" && !key.ctrl && !key.meta && !key.shift && (key.leftArrow || key.rightArrow)) {
      setTarget(key.leftArrow ? "user" : "project");
      setError(null);
    } else if (key.escape) {
      setError(null);
      if (step === "home") onClose();
      else if (step === "scope") {
        setStep("scopes");
        setActiveIndex(scopeIndex);
      } else {
        setStep("home");
        setActiveIndex(step === "scopes" ? 1 : 0);
      }
    } else if (key.upArrow || key.downArrow) {
      setActiveIndex((index) => (index + (key.upArrow ? -1 : 1) + items.length) % items.length);
    } else if (!key.ctrl && !key.meta && !key.shift && (key.return || input === " ")) {
      setError(null);
      if (step === "home") {
        if (items[activeIndex]!.key === "save") void save(changes);
        else {
          setStep(activeIndex === 0 ? "defaultMode" : "scopes");
          setActiveIndex(activeIndex === 0 ? MODES.indexOf(currentMode) : 0);
        }
      } else if (step === "defaultMode") {
        setChanges({ ...changes, defaultMode: MODES[activeIndex]! });
        setStep("home");
        setActiveIndex(0);
      } else if (step === "scopes") {
        setScopeIndex(activeIndex);
        setStep("scope");
        setActiveIndex(DECISIONS.indexOf(getPermissionScopeSelection(permissions, PERMISSION_SCOPES[activeIndex]!)));
      } else {
        const selection = DECISIONS[activeIndex]!;
        setChanges({ ...changes, scopes: { ...changes.scopes, [scope]: selection } });
        setStep("scopes");
        setActiveIndex(scopeIndex);
      }
    }
  });

  const title = step === "home" ? "Permissions" : step === "scope" ? scope : step;
  const helpText = saving
    ? "Saving…"
    : step === "home"
      ? "↑↓ move · Enter/Space select · Esc cancel"
      : "↑↓ move · Enter/Space select · Esc back";
  const labelWidth = Math.min(
    Math.max(...items.map((item) => item.label.length + (item.selected === undefined ? 2 : 4))),
    Math.max(1, width - 4)
  );
  const showDescriptions = width - 4 - labelWidth > 2;
  return (
    <Box flexDirection="column" width={width}>
      <DropdownMenu
        title={`${title} · ${targetLabel}`}
        width={width}
        items={items}
        activeIndex={activeIndex}
        maxVisible={step === "home" ? items.length : Math.max(1, Math.min(8, rows - 10))}
        helpText={helpText}
        footer={step === "home" ? <SaveScopeSelector target={target} /> : undefined}
        renderItem={(item, active) => (
          <Box paddingX={1} gap={showDescriptions ? 2 : 0}>
            <Box width={labelWidth} flexShrink={0}>
              <Text color={active ? "#229ac3" : undefined} wrap="truncate-end">
                {active ? "> " : "  "}
                {item.selected === undefined ? "" : item.selected ? "● " : "○ "}
                {item.label}
              </Text>
            </Box>
            {showDescriptions && item.description ? (
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Text dimColor wrap="truncate-end">
                  {item.description}
                </Text>
              </Box>
            ) : null}
          </Box>
        )}
      />
      {error ? <Text color="red">{error}</Text> : null}
    </Box>
  );
}
