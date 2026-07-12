import type { MindContext, MindInstructionPrecedence } from '@chamber/shared/types';

interface PerMindCustomInstructionsControlsProps {
  minds: MindContext[];
  precedenceByMindId: Record<string, MindInstructionPrecedence>;
  savingMindId: string | null;
  onToggle: (mind: MindContext, enabled: boolean) => Promise<void>;
}

/**
 * Per-mind inheritance controls: shows whether each mind inherits the global
 * custom instructions and renders its ordered instruction precedence without
 * exposing prompt content. Reused by the Custom instructions section and the
 * Agents detail pane, so it stays presentational and prop-driven.
 */
export function PerMindCustomInstructionsControls({
  minds,
  precedenceByMindId,
  savingMindId,
  onToggle,
}: PerMindCustomInstructionsControlsProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background/60 p-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Per-mind inheritance</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Minds inherit global custom instructions by default. Disable inheritance only when a mind needs to ignore your global preferences. Chamber safety guidance remains authoritative for every mind.
        </p>
      </div>

      {minds.length === 0 ? (
        <p className="text-xs text-muted-foreground">No minds are loaded.</p>
      ) : (
        <div className="space-y-3">
          {minds.map((mind) => {
            const precedence = precedenceByMindId[mind.mindId];
            const enabled = precedence?.globalCustomInstructionsEnabled ?? true;
            const saving = savingMindId === mind.mindId;
            return (
              <div key={mind.mindId} className="rounded-lg border border-border bg-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{mind.identity.name}</p>
                    <p className="text-xs text-muted-foreground">{mindInstructionStatus(precedence)}</p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-foreground">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={saving}
                      onChange={(event) => { void onToggle(mind, event.currentTarget.checked); }}
                      aria-label={`Apply global custom instructions to ${mind.identity.name}`}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-ring disabled:opacity-60"
                    />
                    {saving ? 'Saving...' : enabled ? 'Enabled' : 'Disabled'}
                  </label>
                </div>

                {precedence ? (
                  <ol aria-label={`Instruction precedence for ${mind.identity.name}`} className="mt-3 space-y-2">
                    {precedence.layers.map((layer, index) => (
                      <li key={layer.id} className="flex gap-3 rounded-md border border-border/70 bg-muted/20 p-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-semibold text-muted-foreground">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-medium text-foreground">{layer.label}</p>
                            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {instructionLayerStatus(layer)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{layer.source}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{layer.description}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">Loading instruction precedence...</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function mindInstructionStatus(precedence: MindInstructionPrecedence | undefined): string {
  if (!precedence) return 'Loading instruction precedence.';
  if (!precedence.globalCustomInstructionsEnabled) return 'Global custom instructions are disabled for this mind.';
  if (!precedence.hasGlobalCustomInstructions) return 'Inheritance is enabled, but no global custom instructions are saved.';
  return 'Inherits global custom instructions.';
}

function instructionLayerStatus(layer: MindInstructionPrecedence['layers'][number]): string {
  if (layer.included) return 'Included';
  if (!layer.enabled) return 'Disabled';
  if (!layer.present) return 'Not present';
  return 'Skipped';
}
