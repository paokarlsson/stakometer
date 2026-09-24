import { recoverUnfinished } from './session/recorder';
import { IdbStore } from './storage/db';
import { App, type Cleanup, type View, type ViewName } from './ui/app';
import { historyView } from './ui/views/history';
import { liveView } from './ui/views/live';
import { startView } from './ui/views/start';

const views: Record<ViewName, View> = { start: startView, live: liveView, history: historyView };

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
    cleanup = views[name](root, app);
  });
  app.navigate('start');
}

void main();
