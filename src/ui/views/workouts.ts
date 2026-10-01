// A list of workouts reached from the start page: planned (from elitledet), built-in or tests.
import { previousTest } from '../../session/testResults';
import { BUILTIN_WORKOUTS, TEST_WORKOUTS } from '../../workout/builtin';
import { completedPlanIds, localDate, plannedForList } from '../../workout/plan';
import { maxEffortDuration, type Workout } from '../../workout/schema';
import type { View, WorkoutCategory } from '../app';
import { pageHeader } from '../components';
import { h } from '../dom';
import { formatDay, formatPower } from '../format';
import { icon } from '../icons';
import { outline, workoutLength } from '../outline';
import { importPlanFile } from '../planImport';

const TITLES: Record<WorkoutCategory, string> = { planned: 'Planerade pass', builtin: 'Inbyggda pass', test: 'Maxtest' };

/** UI text for the test battery (spec §7.1). */
export const BATTERY_ADVICE =
  'Gör alla fyra testen inom 14 dagar, med samma dragfaktor. Högst två samma dag, med minst 30 min lugnt emellan – till exempel 12 min dag 1, 30 s och 3 min dag 2, 6 min dag 3. Efter tre av dem föreslår appen en ny signatur, och med alla fyra syns hur väl kurvan passar.';

interface RowOptions {
  when?: string;
  today?: boolean;
  name: string;
  sub: string;
  done?: boolean;
  workout: Workout;
}

export const workoutsView: View = (root, app) => {
  const category = app.category ?? 'builtin';
  const list = h('div', { class: 'list' }, h('p', { class: 'hint' }, 'Laddar…'));
  const status = h('p', { class: 'hint', hidden: true });

  const row = (o: RowOptions): HTMLElement => {
    const el = h(
      'button',
      { class: 'list-row' },
      o.when !== undefined ? h('span', { class: o.today ? 'when today' : 'when' }, o.when) : null,
      h('span', { class: 'main' }, h('span', { class: 'name' }, o.name), h('span', { class: 'sub' }, o.sub)),
      o.done ? h('span', { class: 'done', title: 'Genomfört' }, '✓') : null,
      icon('chevron', 'icon tile-chevron'),
    );
    el.addEventListener('click', () => {
      app.workout = o.workout;
      app.navigate('workout');
    });
    return el;
  };

  const loadPlanned = async (): Promise<void> => {
    const today = localDate();
    const [all, sessions] = await Promise.all([app.store.listPlannedWorkouts(), app.store.listSessions()]);
    const done = completedPlanIds(sessions);
    const planned = plannedForList(all, today);
    list.replaceChildren(
      ...(planned.length === 0
        ? [h('p', { class: 'hint' }, 'Inga planerade pass. Importera veckans fil från elitledet.')]
        : planned.map((w) =>
            row({
              when: formatDay(w.date, today),
              today: w.date === today,
              name: w.name,
              sub: [workoutLength(w), w.description].filter(Boolean).join(' · '),
              done: done.has(w.id),
              workout: w,
            }),
          )),
    );
  };

  const loadTests = async (): Promise<void> => {
    const simulated = app.source?.kind === 'simulator';
    const results = await app.store.listTestResults(app.machine());
    list.replaceChildren(
      ...TEST_WORKOUTS.map((w) => {
        const prev = previousTest(results, maxEffortDuration(w) ?? 0, simulated);
        const last = prev
          ? `Senast ${formatPower(prev.avgPower)} · ${prev.date.slice(0, 10)}${prev.dragFactor !== undefined ? ` · dragfaktor ${prev.dragFactor}` : ''}`
          : 'Inget resultat ännu';
        return row({ name: w.name, sub: `${workoutLength(w)} · ${last}`, workout: w });
      }),
    );
  };

  const planFile = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const importBtn = h('button', { class: 'secondary' }, icon('upload'), 'Importera plan…');
  importBtn.addEventListener('click', () => planFile.click());
  planFile.addEventListener('change', async () => {
    const file = planFile.files?.[0];
    planFile.value = '';
    if (!file) return;
    const result = await importPlanFile(app, file);
    status.textContent = result.text;
    status.className = result.error ? 'error' : 'hint';
    status.hidden = false;
    await loadPlanned();
  });

  root.append(
    pageHeader({ title: TITLES[category], onBack: () => app.navigate('start'), right: category === 'planned' ? [importBtn, planFile] : [] }),
    ...(category === 'test' ? [h('p', { class: 'hint' }, BATTERY_ADVICE)] : []),
    status,
    list,
  );

  if (category === 'planned') void loadPlanned();
  else if (category === 'test') void loadTests();
  else {
    list.replaceChildren(
      ...BUILTIN_WORKOUTS.map((w) =>
        row({
          name: w.name,
          sub: `${workoutLength(w)} · ${outline(w.segments)
            .map((l) => l.text)
            .join(' · ')}`,
          workout: w,
        }),
      ),
    );
  }
  return () => {};
};
