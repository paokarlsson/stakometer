import { recoverUnfinished } from './session/recorder';
import { IdbStore } from './storage/db';
import { App, type Cleanup, type View, type ViewName } from './ui/app';
import { historyView } from './ui/views/history';
import { liveView } from './ui/views/live';
import { sessionView } from './ui/views/session';
import { settingsView } from './ui/views/settings';
import { startView } from './ui/views/start';

const views: Record<ViewName, View> = {
  start: startView,
  live: liveView,
  history: historyView,
  session: sessionView,
  settings: settingsView,
};

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app missing');

  const store = await IdbStore.open();
  // Sessions cut short by a reload or crash get their summary from the saved chunks.
  await recoverUnfinished(store);

  let cleanup: Cleanup = () => {};
  const app = new App(store, (name) => {
    cleanup();
    root.replaceChildren();
    window.scrollTo(0, 0);
    cleanup = views[name](root, app);
  });
  await app.loadSettings();
  app.navigate('start');

  // USB is the default: connect automatically when a permitted PM is (or gets) plugged in.
  const autoConnect = (): void => void app.autoConnectUsb().catch((err) => console.warn('USB auto-connect:', err));
  navigator.hid?.addEventListener('connect', autoConnect);
  autoConnect();
}

void main();
