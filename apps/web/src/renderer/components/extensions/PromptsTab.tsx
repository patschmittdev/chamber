import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { validatePromptInput } from '@chamber/shared/prompt-authoring';
import type { Prompt } from '@chamber/shared/types';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { useAppDispatch, useAppState } from '../../lib/store';
import { cn } from '../../lib/utils';
import { Alert } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { TabEmptyState, TabError, TabLoading } from './extensionsShared';

const fieldInputClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';

type PromptSelection = string | 'new' | null;

export function PromptsTab({
  onInventoryChanged,
  onEditorDirtyChange,
}: {
  readonly onInventoryChanged?: () => void;
  readonly onEditorDirtyChange?: (dirty: boolean) => void;
}) {
  const { activeMindId, pendingExtensionsIntent } = useAppState();
  const dispatch = useAppDispatch();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<PromptSelection>(null);
  const [pendingSelection, setPendingSelection] = useState<PromptSelection>(null);
  const [pendingDraftHandoff, setPendingDraftHandoff] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    onEditorDirtyChange?.(editorDirty);
    return () => onEditorDirtyChange?.(false);
  }, [editorDirty, onEditorDirtyChange]);

  const loadPrompts = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.electronAPI.prompts
      .list()
      .then((items) => {
        if (!cancelled) setPrompts(items);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(safeAuthoringError(loadError, 'Could not load prompts.'));
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
    setSelection('new');
    setNotice(null);
    dispatch({ type: 'SET_PENDING_EXTENSIONS_INTENT', payload: null });
  }, [pendingExtensionsIntent, dispatch]);

  const select = (next: PromptSelection) => {
    if (editorDirty) {
      setPendingSelection(next);
      return;
    }
    setSelection(next);
    setNotice(null);
  };

  const runDraftHandoff = () => {
    if (!activeMindId) return;
    dispatch({
      type: 'SET_COMPOSE_DRAFT',
      payload: { mindId: activeMindId, draft: 'Create a reusable prompt for my prompt library. Include title, description, and body.' },
    });
    dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
  };

  const requestDraftHandoff = () => {
    if (editorDirty) {
      setPendingDraftHandoff(true);
      return;
    }
    runDraftHandoff();
  };

  const selectedPrompt = typeof selection === 'string' ? prompts.find((prompt) => prompt.id === selection) ?? null : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Prompts</h2>
          <p className="text-sm text-muted-foreground">
            Reusable, user-authored text available to every mind from the composer slash menu.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {activeMindId ? (
            <Button
              variant="outline"
              onClick={requestDraftHandoff}
            >
              Draft with active mind
            </Button>
          ) : null}
          <Button onClick={() => select('new')}>
            <Plus size={16} />
            New prompt
          </Button>
        </div>
      </header>

      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Draft with active mind starts a chat draft. It does not create or save a prompt.
      </p>

      {notice ? <p role="status" className="text-sm text-genesis">{notice}</p> : null}

      {loading ? <TabLoading label="Loading prompts" /> : null}
      {error ? <TabError message={error} /> : null}
      {!loading && !error ? (
        <div className="grid min-h-[28rem] gap-4 lg:grid-cols-[minmax(14rem,0.38fr)_minmax(0,1fr)]">
          <PromptList prompts={prompts} selection={selection} onSelect={select} />
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
            {pendingSelection !== null || pendingDraftHandoff ? (
              <DiscardChangesNotice
                onKeepEditing={() => {
                  setPendingSelection(null);
                  setPendingDraftHandoff(false);
                }}
                onDiscard={() => {
                  setEditorDirty(false);
                  if (pendingSelection !== null) setSelection(pendingSelection);
                  setPendingSelection(null);
                  if (pendingDraftHandoff) runDraftHandoff();
                  setPendingDraftHandoff(false);
                }}
              />
            ) : selection === 'new' || selectedPrompt ? (
              <PromptEditor
                key={selectedPrompt?.id ?? 'new'}
                prompt={selectedPrompt}
                onDirtyChange={setEditorDirty}
                onSaved={(next, savedId) => {
                  setPrompts(next);
                  setSelection(savedId ?? null);
                  setEditorDirty(false);
                  setNotice('Prompt saved.');
                  onInventoryChanged?.();
                }}
                onDeleted={(next) => {
                  setPrompts(next);
                  setSelection(null);
                  setEditorDirty(false);
                  setNotice('Prompt deleted.');
                  onInventoryChanged?.();
                }}
              />
            ) : (
              <TabEmptyState
                icon={<FileText size={22} />}
                title={prompts.length === 0 ? 'No saved prompts' : 'Select a prompt'}
                detail={prompts.length === 0
                  ? 'Create a prompt to reuse it from the composer with a slash command.'
                  : 'Choose a prompt to view its scope and edit its authorized content.'}
              />
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function PromptList({
  prompts,
  selection,
  onSelect,
}: {
  readonly prompts: Prompt[];
  readonly selection: PromptSelection;
  readonly onSelect: (selection: PromptSelection) => void;
}) {
  return (
    <aside className="rounded-xl border border-border bg-card p-2" aria-label="Saved prompts">
      <div className="mb-2 flex items-center justify-between px-2 pt-1">
        <h3 className="text-sm font-semibold">Saved prompts</h3>
        <span className="text-xs text-muted-foreground">{prompts.length}</span>
      </div>
      <div role="listbox" aria-label="Prompt library" className="grid gap-1">
        {prompts.map((prompt) => (
          <button
            key={prompt.id}
            type="button"
            role="option"
            aria-selected={selection === prompt.id}
            onClick={() => onSelect(prompt.id)}
            className={cn(
              'rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selection === prompt.id ? 'bg-selected text-selected-foreground' : 'hover:bg-hover',
            )}
          >
            <span className="block truncate text-sm font-medium">{prompt.title}</span>
            <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">
              {prompt.description || 'No description'}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function PromptEditor({
  prompt,
  onDirtyChange,
  onSaved,
  onDeleted,
}: {
  readonly prompt: Prompt | null;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onSaved: (prompts: Prompt[], savedId: string | null) => void;
  readonly onDeleted: (prompts: Prompt[]) => void;
}) {
  const [title, setTitle] = useState(prompt?.title ?? '');
  const [description, setDescription] = useState(prompt?.description ?? '');
  const [body, setBody] = useState(prompt?.body ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteRequested, setDeleteRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = prompt !== null;
  const dirty = title !== (prompt?.title ?? '') || description !== (prompt?.description ?? '') || body !== (prompt?.body ?? '');
  const validationError = validatePromptInput({ title, description, body });

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const save = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI.prompts.save({
        id: prompt?.id ?? null,
        title: title.trim(),
        body: body.trim(),
        description: description.trim() || undefined,
      });
      if (result.success) {
        const savedId = prompt?.id ?? null;
        onSaved(result.prompts ?? [], savedId);
      } else {
        setError(safeAuthoringMessage(result.error, 'Could not save the prompt.'));
      }
    } catch (saveError) {
      setError(safeAuthoringError(saveError, 'Could not save the prompt.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!prompt) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await window.electronAPI.prompts.delete(prompt.id);
      if (result.success) {
        onDeleted(result.prompts ?? []);
      } else {
        setError(safeAuthoringMessage(result.error, 'Could not delete the prompt.'));
      }
    } catch (deleteError) {
      setError(safeAuthoringError(deleteError, 'Could not delete the prompt.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{editing ? 'Edit prompt' : 'New prompt'}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {editing ? 'Changes update this user-authored prompt.' : 'Create a reusable prompt for the global library.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline">Global scope</Badge>
          <Badge variant="secondary">User authored</Badge>
        </div>
      </div>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {deleteRequested ? (
        <Alert variant="destructive">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Delete this prompt? This cannot be undone.</span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteRequested(false)}>Keep prompt</Button>
              <Button variant="destructive" size="sm" disabled={deleting} onClick={() => void remove()}>
                {deleting ? 'Deleting...' : 'Delete prompt'}
              </Button>
            </span>
          </div>
        </Alert>
      ) : null}
      <div className="grid gap-3">
        <Field label="Title" htmlFor="prompt-title">
          <input
            id="prompt-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => setError(validationError)}
            className={fieldInputClass}
          />
        </Field>
        <Field label="Description" htmlFor="prompt-description" hint="Optional short hint shown in the slash menu.">
          <input
            id="prompt-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => setError(validationError)}
            className={fieldInputClass}
          />
        </Field>
        <Field label="Prompt body" htmlFor="prompt-body">
          <textarea
            id="prompt-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onBlur={() => setError(validationError)}
            className={cn(fieldInputClass, 'min-h-[220px] resize-y font-mono leading-6')}
          />
        </Field>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {dirty ? <span className="mr-auto text-xs text-amber-600 dark:text-amber-300">Unsaved edits</span> : <span className="mr-auto text-xs text-muted-foreground">All changes saved</span>}
        {editing ? (
          <Button variant="outline" onClick={() => setDeleteRequested(true)}>
            <Trash2 size={16} />
            Delete
          </Button>
        ) : null}
        <Button onClick={() => void save()} disabled={!dirty || saving || Boolean(validationError)}>
          {saving ? 'Saving...' : 'Save prompt'}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">{label}</label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function DiscardChangesNotice({
  onKeepEditing,
  onDiscard,
}: {
  readonly onKeepEditing: () => void;
  readonly onDiscard: () => void;
}) {
  return (
    <Alert variant="destructive">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>You have unsaved edits. Discard them and continue?</span>
        <span className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onKeepEditing}>Keep editing</Button>
          <Button variant="destructive" size="sm" onClick={onDiscard}>Discard edits</Button>
        </span>
      </div>
    </Alert>
  );
}

function safeAuthoringError(error: unknown, fallback: string): string {
  return safeAuthoringMessage(getErrorMessage(error), fallback);
}

function safeAuthoringMessage(message: string | undefined, fallback: string): string {
  if (!message || /(?:[A-Za-z]:[\\/]|\\\\|(?:^|\s)\/\S+|\b[a-z][a-z0-9+.-]*:)/i.test(message)) return fallback;
  return message;
}
