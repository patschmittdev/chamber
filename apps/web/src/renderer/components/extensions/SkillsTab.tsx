import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import type { SkillManifest } from '@chamber/shared/skill-types';
import { Sparkles } from 'lucide-react';
import { useAppState } from '../../lib/store';
import { Badge } from '../ui/badge';
import { TabEmptyState, TabError } from './extensionsShared';

export function SkillsTab() {
  const { activeMindId, minds } = useAppState();
  const activeMind = minds.find((mind) => mind.mindId === activeMindId) ?? null;

  const [skills, setSkills] = useState<SkillManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeMindId) {
      setSkills([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSkills(await window.electronAPI.skills.listForMind(activeMindId));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [activeMindId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!activeMindId) {
    return (
      <TabEmptyState
        icon={<Sparkles size={22} />}
        title="No mind selected"
        detail="Select a mind from the sidebar to see the skills it discovers on disk."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Skills</h2>
        <p className="text-sm text-muted-foreground">
          Skills discovered in{' '}
          <span className="font-medium text-foreground">{activeMind?.identity.name ?? 'this mind'}</span>&apos;s{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">.github/skills</code>. This list is read-only.
        </p>
      </div>

      {error && <TabError message={error} />}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading skills…</p>
      ) : skills.length === 0 ? (
        <TabEmptyState
          icon={<Sparkles size={22} />}
          title="No skills found"
          detail="Add SKILL.md directories under this mind's .github/skills to extend it."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {skills.map((skill) => (
            <li key={skill.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{skill.name}</span>
                {skill.version && <Badge variant="outline">v{skill.version}</Badge>}
                <span className="text-xs text-muted-foreground">{skill.id}</span>
              </div>
              {skill.description && <p className="mt-1 text-sm text-muted-foreground">{skill.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
