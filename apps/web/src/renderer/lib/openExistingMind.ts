import type { MindContext } from '@chamber/shared/types';
import type { AppAction } from './store';
import { selectPreferredMind } from './mindSelection';
import { Logger } from './logger';

interface OpenExistingMindOptions {
  existingMinds: MindContext[];
  dispatch: (action: AppAction) => void;
}

const log = Logger.create('openExistingMind');

function mergeMindIntoList(minds: MindContext[], openedMind: MindContext): MindContext[] {
  const byId = new Map<string, MindContext>(minds.map((mind) => [mind.mindId, mind]));
  byId.set(openedMind.mindId, openedMind);
  return [...byId.values()];
}

export async function openExistingMind(
  dirPath: string,
  options: OpenExistingMindOptions,
): Promise<MindContext> {
  const openedMind = await window.electronAPI.mind.add(dirPath);
  const optimisticMinds = mergeMindIntoList(options.existingMinds, openedMind);
  options.dispatch({ type: 'SET_MINDS', payload: optimisticMinds });
  const optimisticSelection = selectPreferredMind(optimisticMinds, openedMind);
  if (optimisticSelection) {
    options.dispatch({ type: 'SET_ACTIVE_MIND', payload: optimisticSelection.mindId });
  }

  void window.electronAPI.mind.list()
    .then((loadedMinds) => {
      options.dispatch({ type: 'SET_MINDS', payload: loadedMinds });
      const preferred = selectPreferredMind(loadedMinds, openedMind);
      if (preferred) {
        options.dispatch({ type: 'SET_ACTIVE_MIND', payload: preferred.mindId });
      }
    })
    .catch(() => {
      log.warn('Failed to refresh minds after opening an existing agent.');
    });

  return openedMind;
}
