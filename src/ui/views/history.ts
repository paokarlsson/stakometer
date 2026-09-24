import type { Session } from '../../storage/types';
import { BUILTIN_WORKOUTS } from '../../workout/builtin';
import type { View } from '../app';
import { h } from '../dom';
import { formatDate, formatDistance, formatDuration, formatPower } from '../format';

const MODE_LABEL: Record<Session['mode'], string> = { free: 'Fri åkning', workout: 'Pass', test: 'Test' };

const workoutLabel = (s: Session): string =>
  (s.workoutId && BUILTIN_WORKOUTS.find((w) => w.id === s.workoutId)?.name) || MODE_LABEL[s.mode];

const COLUMNS = ['Datum', 'Pass', 'Tid', 'Distans', 'Medeleffekt', 'Lägsta W′', 'Källa', 'Status'];

export const historyView: View = (root, app) => {
  const body = h('tbody', {}, h('tr', {}, h('td', { colspan: COLUMNS.length }, 'Laddar…')));

  root.append(
    h('h1', {}, 'Historik'),
    h(
      'table',
      { class: 'history' },
      h(
        'thead',
        {},
        h('tr', {}, ...COLUMNS.map((c) => h('th', {}, c))),
      ),
      body,
    ),
    h('nav', {}, h('button', { class: 'link', onclick: () => app.navigate('start') }, 'Tillbaka')),
  );

  void app.store.listSessions().then((sessions) => {
    body.replaceChildren(
      ...(sessions.length === 0
        ? [h('tr', {}, h('td', { colspan: COLUMNS.length }, 'Inga pass ännu.'))]
        : sessions.map((s) =>
            h(
              'tr',
              {},
              h('td', {}, formatDate(s.startedAt)),
              h('td', {}, workoutLabel(s)),
              h('td', { class: 'num' }, s.summary ? formatDuration(s.summary.duration) : '–'),
              h('td', { class: 'num' }, s.summary ? formatDistance(s.summary.distance) : '–'),
              h('td', { class: 'num' }, formatPower(s.summary?.avgPower)),
              h('td', { class: 'num' }, s.summary?.minWbal ? `${Math.round(Math.max(0, s.summary.minWbal.fraction) * 100)} %` : '–'),
              h('td', {}, s.source === 'pm5' ? 'PM5' : 'Simulator'),
              h('td', {}, s.status === 'completed' ? 'Klart' : 'Avbrutet'),
            ),
          )),
    );
  });

  return () => {};
};
