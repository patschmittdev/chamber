import { useAppState } from '../lib/store';

export function useActiveMindBusy() {
  const { activeMindId, isStreaming, streamingByMind, conversationViewByMind } = useAppState();
  const conversationView = activeMindId ? conversationViewByMind[activeMindId] : undefined;
  const streaming = Boolean(
    isStreaming
    || (activeMindId && (streamingByMind[activeMindId] || conversationView?.streaming)),
  );
  const modelSwitching = Boolean(conversationView?.modelSwitching);
  const hydrating = conversationView?.status === 'hydrating';

  return {
    isBusy: streaming || modelSwitching || hydrating,
    isStreaming: streaming,
    isModelSwitching: modelSwitching,
    isConversationHydrating: hydrating,
  };
}
