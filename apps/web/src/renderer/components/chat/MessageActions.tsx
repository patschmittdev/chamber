import { useCallback, useState } from 'react';
import { Check, Copy, FileCode, GitFork, Pencil, RefreshCw, Trash2, X, type LucideIcon } from 'lucide-react';
import type { ChatMessage } from '@chamber/shared/types';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { toMarkdown, toPlainText } from './messageContent';

interface MessageActionsProps {
  message: ChatMessage;
  /** True while the active conversation cannot be safely mutated. */
  isBusy: boolean;
  /** Regenerate the assistant response. Omit to hide (not the newest turn, or unsupported). */
  regenerate?: RowAction;
  /** Edit a user turn in place. Omit to hide (assistant turn, unsaved turn, or unsupported). */
  edit?: RowAction;
  /** Forks a new conversation from this persisted turn. */
  fork?: RowAction;
  /** Delete this turn and every turn after it. Omit to hide (unsaved turn or unsupported). */
  onDelete?: () => void;
}

/**
 * A mutating row action. Presence of the object means the action is available
 * for this row; `disabledReason`, when set, renders the control disabled and
 * surfaces the reason as a tooltip (e.g. turns with images cannot be replayed).
 * Omitting the action entirely hides it — used for unsupported hosts (browser
 * mode) and turns not yet persisted to conversation history.
 */
export interface RowAction {
  onRun: () => void;
  disabledReason?: string;
}

/**
 * Hover-revealed action row for a completed message. Mirrors the
 * M365/Anthropic pattern: actions stay out of the way until the row is hovered
 * (or a control is focused for keyboard users). Copy and Copy as markdown are
 * always available; the mutating actions (regenerate, edit, delete) are passed
 * in by the parent only when the host and persisted history support them, so
 * this component never has to know about capabilities itself.
 */
export function MessageActions({ message, isBusy, regenerate, edit, fork, onDelete }: MessageActionsProps) {
  const plain = useCopyToClipboard();
  const markdown = useCopyToClipboard();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleCopyPlain = useCallback(() => plain.copy(toPlainText(message)), [plain, message]);
  const handleCopyMarkdown = useCallback(() => markdown.copy(toMarkdown(message)), [markdown, message]);
  const handleConfirmDelete = useCallback(() => {
    setConfirmingDelete(false);
    onDelete?.();
  }, [onDelete]);

  return (
    <div className="mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <ActionButton
        onClick={handleCopyPlain}
        icon={plain.copied ? Check : Copy}
        label={plain.copied ? 'Copied' : 'Copy'}
        ariaLabel={plain.copied ? 'Copied' : 'Copy message'}
      />
      <ActionButton
        onClick={handleCopyMarkdown}
        icon={markdown.copied ? Check : FileCode}
        label={markdown.copied ? 'Copied' : 'Markdown'}
        ariaLabel={markdown.copied ? 'Copied as markdown' : 'Copy as markdown'}
      />

      {regenerate && (
        <ActionButton
          onClick={regenerate.onRun}
          icon={RefreshCw}
          label="Regenerate"
          ariaLabel="Regenerate response"
          disabled={isBusy || Boolean(regenerate.disabledReason)}
          title={regenerate.disabledReason}
        />
      )}

      {edit && (
        <ActionButton
          onClick={edit.onRun}
          icon={Pencil}
          label="Edit"
          ariaLabel="Edit message"
          disabled={isBusy || Boolean(edit.disabledReason)}
          title={edit.disabledReason}
        />
      )}

      {fork && (
        <ActionButton
          onClick={fork.onRun}
          icon={GitFork}
          label="Fork from here"
          ariaLabel="Fork conversation from here"
          disabled={isBusy || Boolean(fork.disabledReason)}
          title={fork.disabledReason}
        />
      )}

      {onDelete && (
        confirmingDelete ? (
          <span className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Remove this and all later turns?</span>
            <ActionButton
              onClick={handleConfirmDelete}
              icon={Trash2}
              label="Delete"
              ariaLabel="Confirm delete from here"
              disabled={isBusy}
              variant="danger"
            />
            <ActionButton
              onClick={() => setConfirmingDelete(false)}
              icon={X}
              label="Cancel"
              ariaLabel="Cancel delete"
            />
          </span>
        ) : (
          <ActionButton
            onClick={() => setConfirmingDelete(true)}
            icon={Trash2}
            label="Delete from here"
            ariaLabel="Delete this message and all following messages"
            title="Removes this message and every turn after it"
            disabled={isBusy}
          />
        )
      )}
    </div>
  );
}

function ActionButton({
  onClick,
  icon: Icon,
  label,
  ariaLabel,
  disabled,
  title,
  variant,
}: {
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  ariaLabel: string;
  disabled?: boolean;
  title?: string;
  variant?: 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={
        'flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 '
        + (variant === 'danger'
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground')
      }
    >
      <Icon size={12} aria-hidden />
      {label}
    </button>
  );
}
