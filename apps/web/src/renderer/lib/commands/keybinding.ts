import type { Keybinding } from './types';

/** Lower-case a key so matching and chord ids are case-insensitive. */
function normalizeKey(key: string): string {
  return key.toLowerCase();
}

/**
 * True when a keyboard event satisfies a binding. The rules preserve the palette's
 * original Cmd/Ctrl+K behavior while supporting plain keys such as '?':
 * - the key is compared case-insensitively;
 * - `mod` true requires metaKey or ctrlKey, `mod` falsy requires both to be off;
 * - `alt` must equal event.altKey, so a binding without alt never fires with Alt held;
 * - `shift` is enforced only when the binding sets it, so shifted symbols such as '?'
 *   (which carry shiftKey on many layouts) still match.
 */
export function eventMatchesKeybinding(event: KeyboardEvent, binding: Keybinding): boolean {
  if (normalizeKey(event.key) !== normalizeKey(binding.key)) return false;

  const modHeld = event.metaKey || event.ctrlKey;
  if (binding.mod ? !modHeld : modHeld) return false;

  if (event.altKey !== Boolean(binding.alt)) return false;
  if (binding.shift && !event.shiftKey) return false;

  return true;
}

/**
 * Key used to detect chord conflicts. It deliberately omits shift because
 * eventMatchesKeybinding treats an unset shift as "don't care": a binding
 * without shift matches whether or not Shift is held, and a binding with shift
 * matches a subset of those same events. Two bindings that share mod, alt, and
 * key can therefore both fire from one keystroke, so they must be treated as
 * conflicting even when only one of them sets shift. Modifiers appear in a fixed
 * order, for example 'mod+alt+k' or '?'.
 */
export function keybindingConflictKey(binding: Keybinding): string {
  const parts: string[] = [];
  if (binding.mod) parts.push('mod');
  if (binding.alt) parts.push('alt');
  parts.push(normalizeKey(binding.key));
  return parts.join('+');
}

function formatKeyToken(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Human-readable tokens for rendering a chord in the help overlay, for example
 * ['Cmd', 'K'] on macOS or ['Ctrl', 'K'] elsewhere. Each token renders inside its
 * own <kbd> element.
 */
export function keybindingTokens(binding: Keybinding, isMac: boolean): string[] {
  const tokens: string[] = [];
  if (binding.mod) tokens.push(isMac ? 'Cmd' : 'Ctrl');
  if (binding.shift) tokens.push('Shift');
  if (binding.alt) tokens.push(isMac ? 'Option' : 'Alt');
  tokens.push(formatKeyToken(binding.key));
  return tokens;
}
