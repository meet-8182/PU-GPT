// Lightweight, dependency-free pub/sub for conversation-history changes.
//
// AskPage emits when the backend confirms a conversation was persisted. The
// sidebar and the history page subscribe and refetch, so new chats appear
// without a manual page refresh. BroadcastChannel extends this to other tabs.

const EVENT_NAME = 'pu:history-changed';
const CHANNEL_NAME = 'pu-history';

let channel = null;
if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
}

export function notifyHistoryChanged(detail = {}) {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));

  if (channel) {
    try {
      channel.postMessage({ type: 'history-changed', ...detail });
    } catch {
      // Ignore serialization/closing errors; the local event already fired.
    }
  }
}

export function subscribeToHistoryChanges(callback) {
  if (typeof window === 'undefined') return () => {};

  const handleLocal = (event) => callback(event.detail || {});
  const handleRemote = (event) => callback(event.data || {});

  window.addEventListener(EVENT_NAME, handleLocal);
  channel?.addEventListener('message', handleRemote);

  return () => {
    window.removeEventListener(EVENT_NAME, handleLocal);
    channel?.removeEventListener('message', handleRemote);
  };
}
