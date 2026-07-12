import { useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import {
  modelSelectionEqualsModel,
  modelSelectionKeyFromModel,
  parseModelSelectionKey,
} from '@chamber/shared/model-selection';
import type { MindContext, ModelInfo } from '@chamber/shared/types';
import { cn } from '@/renderer/lib/utils';
import { useAppDispatch, useAppState } from '../../lib/store';
import { Badge } from '../ui/badge';

interface AgentModelControlsProps {
  mind: MindContext;
}

/**
 * Per-mind model selection for Settings > Agents > Model. The chat header only
 * ever knows the active mind's models, so this fetches the catalogue for the
 * selected agent directly and persists the choice through mind.setModel. The
 * store is updated so the sidebar and chat header stay in sync when the edited
 * agent happens to be the active one.
 */
export function AgentModelControls({ mind }: AgentModelControlsProps) {
  const { minds, activeMindId } = useAppState();
  const dispatch = useAppDispatch();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    window.electronAPI.chat
      .listModels(mind.mindId)
      .then((list) => {
        if (!cancelled) setModels(list);
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
  }, [mind.mindId]);

  const currentSelection = useMemo(
    () => parseModelSelectionKey(mind.selectedModel ?? null),
    [mind.selectedModel],
  );

  const selectedModel = useMemo(
    () => models.find((model) => modelSelectionEqualsModel(currentSelection, model)) ?? null,
    [currentSelection, models],
  );

  const runtimeLabel = (selectedModel?.provider ?? mind.selectedModelProvider) === 'byo'
    ? 'Local model (bring-your-own endpoint)'
    : 'GitHub Copilot';

  const handleSelect = async (model: ModelInfo) => {
    if (applying || modelSelectionEqualsModel(currentSelection, model)) return;
    const key = modelSelectionKeyFromModel(model);
    const isActiveMind = mind.mindId === activeMindId;
    setApplying(true);
    setError(null);
    if (isActiveMind) {
      dispatch({ type: 'SET_MODEL_SWITCHING', payload: { mindId: mind.mindId, switching: true } });
    }
    try {
      const updated = await window.electronAPI.mind.setModel(mind.mindId, key);
      if (updated) {
        dispatch({
          type: 'SET_MINDS',
          payload: minds.map((entry) => (entry.mindId === updated.mindId ? updated : entry)),
        });
      }
      if (isActiveMind) {
        dispatch({ type: 'SET_SELECTED_MODEL', payload: key });
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setApplying(false);
      if (isActiveMind) {
        dispatch({ type: 'SET_MODEL_SWITCHING', payload: { mindId: mind.mindId, switching: false } });
      }
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-foreground">Model</h4>
        <p className="text-xs text-muted-foreground">Choose which model this agent uses for new turns.</p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading models...</p>
      ) : models.length === 0 ? (
        <p className="rounded-lg border border-border bg-background/40 p-3 text-sm text-muted-foreground">
          No models are available for this agent yet. Sign in or configure a model provider, then reopen this tab.
        </p>
      ) : (
        <div role="radiogroup" aria-label="Model" className="space-y-1.5">
          {models.map((model) => {
            const selected = modelSelectionEqualsModel(currentSelection, model);
            return (
              <button
                key={modelSelectionKeyFromModel(model)}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={applying}
                onClick={() => {
                  void handleSelect(model);
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                  selected
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border bg-card text-foreground/80 hover:bg-hover hover:text-foreground',
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                      selected ? 'border-primary' : 'border-muted-foreground',
                    )}
                  >
                    {selected ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
                  </span>
                  <span className="truncate">{model.name}</span>
                </span>
                {model.provider === 'byo' ? <Badge variant="secondary">Local</Badge> : null}
              </button>
            );
          })}
        </div>
      )}

      <dl className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Current model</dt>
          <dd className="mt-0.5 truncate text-sm text-foreground" title={selectedModel?.name ?? mind.selectedModel ?? 'Default model'}>
            {selectedModel?.name ?? mind.selectedModel ?? 'Default model'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Runtime</dt>
          <dd className="mt-0.5 truncate text-sm text-foreground">{runtimeLabel}</dd>
        </div>
      </dl>

      {applying ? <p role="status" className="text-xs text-muted-foreground">Applying model change...</p> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
