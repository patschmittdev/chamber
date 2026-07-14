import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { CommandPromptRequest } from './appCommands';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

interface CommandPromptDialogProps {
  request: CommandPromptRequest | null;
  onClose: () => void;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary';
const TEXTAREA_CLASS =
  'min-h-[200px] w-full resize-none rounded-lg border border-border bg-background p-3 font-mono text-sm leading-6 text-foreground outline-none focus:border-primary';
const INPUT_ID = 'command-prompt-input';

/**
 * Generic single-value text dialog the command surface hosts on behalf of commands
 * that need free text (rename, set system prompt). The command supplies the request
 * and the confirm callback; this dialog owns the input lifecycle and hands back the
 * trimmed value on confirm, keeping command definitions declarative and DRY.
 */
export function CommandPromptDialog({ request, onClose }: CommandPromptDialogProps) {
  const [value, setValue] = useState('');

  // Reseed the field whenever a new request arrives so each invocation starts from
  // the command's supplied initial value rather than the previous edit.
  useEffect(() => {
    if (request) setValue(request.initialValue);
  }, [request]);

  if (!request) return null;

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    request.onSubmit(trimmed);
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // Single-line inputs submit on Enter; multi-line reserves Enter for newlines and
    // submits on Cmd/Ctrl+Enter so long prompts can wrap freely.
    if (event.key !== 'Enter') return;
    if (request.multiline && !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    submit();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription className={request.description ? undefined : 'sr-only'}>
            {request.description ?? request.label}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <label htmlFor={INPUT_ID} className="text-xs font-medium text-muted-foreground">
            {request.label}
          </label>
          {request.multiline ? (
            <textarea
              id={INPUT_ID}
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={handleKeyDown}
              className={TEXTAREA_CLASS}
            />
          ) : (
            <input
              id={INPUT_ID}
              autoFocus
              type="text"
              value={value}
              placeholder={request.placeholder}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={handleKeyDown}
              className={INPUT_CLASS}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {request.submitLabel ?? 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
