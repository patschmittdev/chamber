import { useEffect, useRef } from 'react';
import type { Command } from '../lib/commands';
import { eventMatchesKeybinding } from '../lib/commands';

/** True when focus sits in a field where typing should suppress plain-key shortcuts. */
function isTypingTarget(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const tag = element.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return element.isContentEditable;
}

/**
 * Dispatch registry keybindings from a single global keydown listener. The listener
 * is attached once and reads the latest commands through a ref, so rebuilding the
 * command list does not churn the subscription. A matching command runs unless focus
 * is in an input and the command is a plain-key shortcut that did not opt in through
 * `runWhileTyping`. A mod chord (Cmd/Ctrl) always runs, because it can never be
 * mistaken for literal text entry.
 */
export function useCommandShortcuts(commands: Command[]): void {
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const match = commandsRef.current.find(
        (command) => command.keybinding && eventMatchesKeybinding(event, command.keybinding),
      );
      if (!match) return;
      const requiresMod = match.keybinding?.mod === true;
      if (!requiresMod && !match.runWhileTyping && isTypingTarget(document.activeElement)) return;
      event.preventDefault();
      match.run();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
