import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { useAppDispatch, useAppState } from '../../lib/store';
import { Logger } from '../../lib/logger';

const log = Logger.create('ChatSystemPromptControl');

const triggerButtonClass =
  'inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50';
const secondaryButtonClass =
  'rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50';
const primaryButtonClass =
  'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50';

interface ChatSystemPromptControlProps {
  /** Disabled while a turn is streaming or the mind is busy, so setting a prompt never rebinds a live session mid-turn. */
  disabled?: boolean;
}

/**
 * Chat-header control for the per-conversation system prompt override. Shows the
 * effective state (agent default vs a custom prompt for this conversation) and
 * opens a dialog to set or clear the override. An empty value falls back to the
 * mind default. Persistence and live-session application happen in the host via
 * `conversationHistory.setSystemMessage`; the refreshed summaries are pushed back
 * into the store exactly like pin/archive.
 */
export function ChatSystemPromptControl({ disabled = false }: ChatSystemPromptControlProps) {
  const { activeMindId, minds, conversationHistoryByMind } = useAppState();
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const activeMind = activeMindId ? minds.find((mind) => mind.mindId === activeMindId) : undefined;
  const activeConversation = activeMindId
    ? conversationHistoryByMind[activeMindId]?.find((conversation) => conversation.active)
    : undefined;
  const mindDefault = activeMind?.identity.systemMessage ?? '';
  const override = activeConversation?.systemMessage;
  const normalizedOverride = typeof override === 'string' ? override.trim() : '';
  const normalizedDefault = mindDefault.trim();
  const hasOverride = normalizedOverride.length > 0;
  const overrideMatchesDefault = hasOverride && normalizedOverride === normalizedDefault;
  const stateLabel = hasOverride
    ? (overrideMatchesDefault ? 'Override saved' : 'Override active')
    : 'Using agent default';
  const stateDetail = hasOverride
    ? (overrideMatchesDefault
      ? 'An override is saved and currently matches the agent default.'
      : 'This conversation is using its own prompt override.')
    : 'No override is saved. This conversation follows the agent default.';

  // Prefill the editor from the current override each time the dialog opens, so
  // it always reflects the persisted value rather than a stale local edit.
  useEffect(() => {
    if (open) setValue(override ?? '');
  }, [open, override]);

  if (!activeMind || !activeConversation) return null;

  const sessionId = activeConversation.sessionId;
  const trimmed = value.trim();
  const dirty = trimmed !== normalizedOverride;

  const persist = async (nextValue: string) => {
    setSaving(true);
    try {
      const history = await window.electronAPI.conversationHistory.setSystemMessage(
        activeMind.mindId,
        sessionId,
        nextValue,
      );
      dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId: activeMind.mindId, conversations: history } });
      setOpen(false);
    } catch (error) {
      log.error('Failed to update conversation system prompt:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label="Conversation system prompt"
        title="Conversation system prompt"
        className={triggerButtonClass}
      >
        <Settings2 className="h-4 w-4" aria-hidden="true" />
        <span className="flex flex-col items-start leading-tight">
          <span className="font-medium text-foreground">System prompt</span>
          <span>{stateLabel}</span>
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col">
          <DialogHeader>
            <DialogTitle>Conversation system prompt</DialogTitle>
            <DialogDescription>
              Override {activeMind.identity.name}&apos;s default prompt for this conversation only. Leave it empty to use the agent default.
            </DialogDescription>
          </DialogHeader>

          <label htmlFor="chat-system-prompt-input" className="text-xs font-medium text-muted-foreground">
            System prompt for this conversation
          </label>
          <textarea
            id="chat-system-prompt-input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            spellCheck={false}
            placeholder={mindDefault.length > 0 ? mindDefault : 'No agent default is set.'}
            className="min-h-[200px] w-full flex-1 resize-none rounded-xl border border-border bg-background p-4 font-mono text-sm leading-6 text-foreground outline-none focus:border-primary"
          />
          <p className="text-xs text-muted-foreground">
            {stateDetail}
          </p>

          <DialogFooter>
            {hasOverride ? (
              <button
                type="button"
                onClick={() => persist('')}
                disabled={saving}
                className={`mr-auto ${secondaryButtonClass}`}
              >
                Reset to agent default
              </button>
            ) : null}
            <button type="button" onClick={() => setOpen(false)} className={secondaryButtonClass}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => persist(trimmed)}
              disabled={!dirty || saving}
              className={primaryButtonClass}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
