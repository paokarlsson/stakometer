// Start page (spec §8.1): connection status, today's planned workout, and tiles for the lists of
// workouts, history, the signature, the plan import and the backup.
import { kOf } from '../../model/signature';
import { TEST_DURATIONS } from '../../session/testResults';
import { exportBackup } from '../../storage/backup';
import { BUILTIN_WORKOUTS } from '../../workout/builtin';
import { completedPlanIds, featuredPlanned, localDate, plannedForList, weekStart } from '../../workout/plan';
import type { Workout } from '../../workout/schema';
import type { View, WorkoutCategory } from '../app';
import { downloadJson, iconButton, pageHeader, tile } from '../components';
import { connectionCard, statusPill } from '../connection';
import { h } from '../dom';
import { formatDay, formatKJ, testName } from '../format';
import { workoutLength } from '../outline';
import { importPlanFile } from '../planImport';

export const startView: View = (root, app) => {
  const connection = connectionCard(app);
  let showConnection = false;
  const pill = statusPill(app, () => {
    showConnection = !showConnection;
    update();
  });
  const status = h('p', { class: 'hint', hidden: true });
  const showStatus = (text: string, isError = false): void => {
    status.textContent = text;
    status.className = isError ? 'error' : 'hint';
    status.hidden = false;
  };

  const choose = (workout: Workout | null, category: WorkoutCategory | null): void => {
    app.workout = workout;
    app.category = category;
    app.navigate('workout');
  };
  const openList = (category: WorkoutCategory): void => {
    app.category = category;
    app.navigate('workouts');
  };

  const featured = h('div', {});
  const planned = tile({ icon: 'calendar', title: 'Planerade pass', detail: 'Laddar…', onClick: () => openList('planned') });
  const builtin = tile({
    icon: 'bars',
    title: 'Inbyggda pass',
    detail: `${BUILTIN_WORKOUTS.slice(0, 3)
      .map((w) => w.name)
      .join(', ')} m.fl.`,
    onClick: () => openList('builtin'),
  });
  const tests = tile({ icon: 'activity', title: 'Maxtest', detail: TEST_DURATIONS.map(testName).join(', '), onClick: () => openList('test') });
  const free = tile({ icon: 'infinity', title: 'Fri åkning', detail: 'Ingen tidslinje – värm upp eller åk fritt', onClick: () => choose(null, null) });
  const history = tile({ icon: 'history', title: 'Historik', detail: 'Laddar…', onClick: () => app.navigate('history') });
  const signature = tile({ icon: 'curve', title: 'Fitness Signature', detail: '…', onClick: () => app.navigate('settings') });
  const planFile = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const importTile = tile({ icon: 'upload', title: 'Importera planfil', detail: 'från elitledet (JSON)', onClick: () => planFile.click() });
  const backup = tile({
    icon: 'database',
    title: 'Säkerhetskopiera data',
    detail: 'Pass, tester och inställningar',
    onClick: async () => {
      const file = await exportBackup(app.store);
      downloadJson(file, `skierg-backup-${file.exportedAt.slice(0, 10)}.json`);
      showStatus(`Exporterade ${file.stores.sessions.length} pass. Importera en backup under Inställningar.`);
    },
  });

  planFile.addEventListener('change', async () => {
    const file = planFile.files?.[0];
    planFile.value = '';
    if (!file) return;
    const result = await importPlanFile(app, file);
    showStatus(result.text, result.error);
    await loadLists();
  });

  const loadLists = async (): Promise<void> => {
    const today = localDate();
    const [all, sessions] = await Promise.all([app.store.listPlannedWorkouts(), app.store.listSessions()]);
    const completed = completedPlanIds(sessions);
    const list = plannedForList(all, today);
    const monday = weekStart(today);
    const sunday = new Date(Date.parse(`${monday}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
    const thisWeek = all.filter((w) => w.date >= monday && w.date <= sunday).length;
    planned.detail.textContent =
      list.length === 0 ? 'Inga – importera veckans fil från elitledet' : thisWeek > 0 ? `${thisWeek} pass denna vecka` : `${list.length} pass i listan`;
    history.detail.textContent = sessions.length === 1 ? '1 pass' : `${sessions.length} pass`;

    const w = featuredPlanned(list, today, completed);
    if (!w) {
      featured.replaceChildren();
      return;
    }
    const done = completed.has(w.id);
    const kicker = w.date === today ? 'Dagens pass' : `Nästa pass · ${formatDay(w.date, today)}`;
    featured.replaceChildren(
      tile({
        icon: 'today',
        primary: true,
        title: h('span', {}, h('span', { class: 'tile-kicker' }, kicker), w.name),
        detail: `${workoutLength(w)}${done ? ' · ✓ genomfört' : ''}${w.description ? ` · ${w.description}` : ''}`,
        onClick: () => choose(w, null),
      }).el,
    );
  };

  const loadSignature = async (): Promise<void> => {
    const sig = await app.displaySignature();
    const defaults: Record<string, string> = {
      'simulator-default': ' · simulatorns standardvärden',
      'pm5-default': ' · standardvärden – gör test eller mata in egna',
    };
    signature.detail.textContent =
      `PP ${Math.round(sig.pp)} W · CP ${Math.round(sig.cp)} W · W′ ${formatKJ(sig.wPrime)} kJ · k ${Math.round(kOf(sig))} s` + (defaults[sig.id] ?? '');
    signature.detail.classList.toggle('warn-text', sig.id === 'pm5-default');
  };

  const update = (): void => {
    pill.update();
    connection.el.hidden = app.connection === 'connected' && !showConnection;
    void loadSignature();
  };
  const off = app.sourceChanged.on(() => {
    showConnection = false;
    update();
  });

  root.append(
    pageHeader({ title: 'Stakometer', right: [pill.el, iconButton('gear', 'Inställningar', () => app.navigate('settings'))] }),
    connection.el,
    h(
      'nav',
      { class: 'tiles' },
      featured,
      planned.el,
      builtin.el,
      tests.el,
      free.el,
      history.el,
      signature.el,
      importTile.el,
      backup.el,
      planFile,
    ),
    status,
  );
  update();
  void loadLists();
  return () => {
    off();
    connection.cleanup();
  };
};
