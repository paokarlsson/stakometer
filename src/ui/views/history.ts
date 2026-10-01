import type { Session } from '../../storage/types';
import { workoutById } from '../../workout/builtin';
import type { View } from '../app';
import { pageHeader } from '../components';
import { h } from '../dom';
import { formatDate, formatDistance, formatDuration, formatPower } from '../format';

const MODE_LABEL: Record<Session['mode'], string> = { free: 'Fri åkning', workout: 'Pass', test: 'Test' };

const workoutLabel = (s: Session): string => s.planned?.name ?? workoutById(s.workoutId)?.name ?? MODE_LABEL[s.mode];

const COLUMNS = ['Datum', 'Pass', 'Tid', 'Distans', 'Medeleffekt', 'Lägsta W′', 'Källa', 'Status'];
const NUMERIC = new Set([2, 3, 4, 5]);

export const historyView: View = (root, app) => {
  const body = h('tbody', {}, h('tr', {}, h('td', { colspan: COLUMNS.length }, 'Laddar…')));

  const subtitle = h('span', {}, '');
  root.append(
    pageHeader({ title: 'Historik', subtitle, onBack: () => app.navigate('start') }),
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ...COLUMNS.map((c, i) => h('th', { class: NUMERIC.has(i) ? 'num' : undefined }, c)))), body)),
    ),
  );

  void app.store.listSessions().then((sessions) => {
    subtitle.textContent = sessions.length === 1 ? '1 pass' : `${sessions.length} pass`;
    body.replaceChildren(
      ...(sessions.length === 0
        ? [h('tr', {}, h('td', { colspan: COLUMNS.length }, 'Inga pass ännu.'))]
        : sessions.map((s) =>
            h(
              'tr',
              {
                class: 'clickable',
                onclick: () => {
                  app.sessionId = s.id;
                  app.sessionBack = 'history';
                  app.navigate('session');
                },
              },
              h('td', {}, formatDate(s.startedAt)),
              h('td', {}, workoutLabel(s)),
              h('td', { class: 'num' }, s.summary ? formatDuration(s.summary.duration) : '–'),
              h('td', { class: 'num' }, s.summary ? formatDistance(s.summary.distance) : '–'),
              h('td', { class: 'num' }, formatPower(s.summary?.avgPower)),
              h('td', { class: 'num' }, s.summary?.minWbal ? `${Math.round(Math.max(0, s.summary.minWbal.fraction) * 100)} %` : '–'),
              h('td', {}, s.source === 'pm5' ? 'PM5' : 'Simulator'),
              h('td', {}, h('span', { class: s.status === 'completed' ? 'status-tag ok' : 'status-tag bad' }, s.status === 'completed' ? 'Klart' : 'Avbrutet')),
            ),
          )),
    );
  });

  return () => {};
};
