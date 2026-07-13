import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import type { Prompt } from '@chamber/shared/types';
import { validatePromptInput } from '@chamber/shared/prompt-authoring';
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { cn } from '../../lib/utils';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { TabEmptyState, TabError, TabLoading } from './extensionsShared';

const fieldInputClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary';

export function PromptsTab() {
  const { pendingExtensionsIntent } = useAppState();
  const dispatch = useAppDispatch();

  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Prompt | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Prompt | null>(null);

  const loadPrompts = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.electronAPI.prompts
      .list()
      .then((items) => {
        if (!cancelled) setPrompts(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => loadPrompts(), [loadPrompts]);

  useEffect(() => {
    if (pendingExtensionsIntent?.action !== 'create-prompt') return;
    setCreateOpen(true);
    dispatch({ type: 'SET_PENDING_EXTENSIONS_INTENT', payload: null });
  }, [pendingExtensionsIntent, dispatch]);

  const closeDialog = () => {
    setCreateOpen(false);
    setEditTarget(null);
  };

  const applyRefreshedPrompts = (next: Prompt[]) => {
    setPrompts(next);
    closeDialog();
    setDeleteTarget(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Prompts</h2>
        <p className="text-sm text-muted-foreground">
          Reusable prompt text you can insert into the composer with a slash command.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">Saved prompts</h3>
            <p className="text-xs text-muted-foreground">Stored on this device and available to every mind.</p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            New prompt
          </Button>
        </div>
        <PromptsList
          prompts={prompts}
          loading={loading}
          error={error}
          onEdit={setEditTarget}
          onDelete={setDeleteTarget}
        />
      </section>

      <PromptDialog
        open={createOpen || editTarget !== null}
        prompt={editTarget}
        onClose={closeDialog}
        onSaved={applyRefreshedPrompts}
      />

      <PromptDeleteDialog
        prompt={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={applyRefreshedPrompts}
      />
    </div>
  );
}

function PromptsList({
  prompts,
  loading,
  error,
  onEdit,
  onDelete,
}: {
  prompts: Prompt[];
  loading: boolean;
  error: string | null;
  onEdit: (prompt: Prompt) => void;
  onDelete: (prompt: Prompt) => void;
}) {
  if (loading) return <TabLoading label="Loading prompts" />;
  if (error) return <TabError message={error} />;
  if (prompts.length === 0) {
    return (
      <TabEmptyState
        icon={<FileText size={22} />}
        title="No saved prompts"
        detail="Create a prompt to reuse it from the composer with a slash command."
      />
    );
  }

  return (
    <ul className="grid gap-3">
      {prompts.map((prompt) => (
        <li key={prompt.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium">{prompt.title}</div>
              {prompt.description ? (
                <p className="mt-1 text-sm text-muted-foreground">{prompt.description}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <CardActionButton
                label={`Edit ${prompt.title}`}
                text="Edit"
                icon={<Pencil size={14} />}
                onClick={() => onEdit(prompt)}
              />
              <CardActionButton
                label={`Delete ${prompt.title}`}
                text="Delete"
                icon={<Trash2 size={14} />}
                onClick={() => onDelete(prompt)}
              />
            </div>
          </div>
          <p className="mt-2 line-clamp-3 break-words whitespace-pre-wrap text-sm text-muted-foreground">
            {prompt.body}
          </p>
        </li>
      ))}
    </ul>
  );
}

function CardActionButton({
  label,
  text,
  icon,
  onClick,
}: {
  label: string;
  text: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" size="sm" aria-label={label} onClick={onClick}>
      {icon}
      {text}
    </Button>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function PromptDialog({
  open,
  prompt,
  onClose,
  onSaved,
}: {
  open: boolean;
  prompt: Prompt | null;
  onClose: () => void;
  onSaved: (prompts: Prompt[]) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(prompt?.title ?? '');
    setDescription(prompt?.description ?? '');
    setBody(prompt?.body ?? '');
    setError(null);
    setSaving(false);
  }, [open, prompt]);

  const editing = prompt !== null;
  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !saving;

  const handleSave = async () => {
    const validationError = validatePromptInput({ title, body, description });
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    const trimmedDescription = description.trim();
    try {
      const result = await window.electronAPI.prompts.save({
        id: prompt?.id ?? null,
        title: title.trim(),
        body: body.trim(),
        description: trimmedDescription.length > 0 ? trimmedDescription : undefined,
      });
      setSaving(false);
      if (result.success) {
        onSaved(result.prompts ?? []);
      } else {
        setError(result.error ?? 'Could not save the prompt.');
      }
    } catch (err) {
      setSaving(false);
      setError(getErrorMessage(err));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit prompt' : 'New prompt'}</DialogTitle>
          <DialogDescription>Saved prompts insert their body into the composer from the slash menu.</DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">{error}</Alert>
        ) : null}
        <div className="flex flex-col gap-3">
          <Field label="Title" htmlFor="prompt-title">
            <input
              id="prompt-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={fieldInputClass}
            />
          </Field>
          <Field label="Description" htmlFor="prompt-description" hint="Optional short hint shown in the slash menu.">
            <input
              id="prompt-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={fieldInputClass}
            />
          </Field>
          <Field label="Prompt body" htmlFor="prompt-body">
            <textarea
              id="prompt-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className={cn(fieldInputClass, 'min-h-[160px] resize-none font-mono leading-6')}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit}>
            {saving ? 'Saving...' : 'Save prompt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PromptDeleteDialog({
  prompt,
  onClose,
  onDeleted,
}: {
  prompt: Prompt | null;
  onClose: () => void;
  onDeleted: (prompts: Prompt[]) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (prompt) {
      setDeleting(false);
      setError(null);
    }
  }, [prompt]);

  const handleDelete = async () => {
    if (!prompt) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await window.electronAPI.prompts.delete(prompt.id);
      setDeleting(false);
      if (result.success) {
        onDeleted(result.prompts ?? []);
      } else {
        setError(result.error ?? 'Could not delete the prompt.');
      }
    } catch (err) {
      setDeleting(false);
      setError(getErrorMessage(err));
    }
  };

  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-w-md flex-col">
        <DialogHeader>
          <DialogTitle>Delete prompt</DialogTitle>
          <DialogDescription>This removes the prompt from your library. This cannot be undone.</DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">{error}</Alert>
        ) : null}
        {prompt ? (
          <p className="text-sm text-muted-foreground">
            Delete <span className="font-medium text-foreground">{prompt.title}</span>?
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete prompt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
