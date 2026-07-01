import type { InputKey } from "../hooks";
import type { KeybindMap } from "@vegamo/deepcode-core";

/**
 * Match a keybind shortcut string (e.g. "ctrl+shift+g") against
 * the raw input character and parsed InputKey.
 *
 * Supported modifiers: ctrl, shift, meta.
 * The key part is case-insensitive.
 */
export function matchKeybind(shortcut: string, input: string, key: InputKey): boolean {
  const parts = shortcut.toLowerCase().split("+");
  const keyChar = parts.pop()!;

  // Must have at least one modifier + a key
  if (parts.length === 0 || !keyChar) return false;

  const modifiers = new Set(parts);

  // Each modifier in the shortcut must be present in the key event.
  // Modifiers NOT in the shortcut must NOT be present (exact match).
  if (modifiers.has("ctrl") !== key.ctrl) return false;
  if (modifiers.has("shift") !== key.shift) return false;
  if (modifiers.has("meta") !== key.meta) return false;

  return input.toLowerCase() === keyChar;
}

export type KeybindMatcher = {
  match: (input: string, key: InputKey) => boolean;
  action: string;
};

/**
 * Pre-compile a KeybindMap into an array of matchers for fast per-keystroke lookup.
 */
export function buildKeybindMatchers(keybinds: KeybindMap): KeybindMatcher[] {
  return Object.entries(keybinds).map(([shortcut, action]) => ({
    match: (input: string, key: InputKey) => matchKeybind(shortcut, input, key),
    action,
  }));
}
