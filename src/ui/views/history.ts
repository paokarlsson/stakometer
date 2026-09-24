import type { Session } from '../../storage/types';
import type { View } from '../app';
import { h } from '../dom';
import { formatDate, formatDistance, formatDuration, formatPower } from '../format';

const MODE_LABEL: Record<Session['mode'], string> = { free: 'Fri åkning', workout: 'Pass', test: 'Test' };

export const historyView: View = (root, app) => {
  const body = h('tbody', {}, h('tr', {}, h('td', { colspan: 7 }, 'Laddar…')));

  root.append(
    h('h1', {}, 'Historik'),
    h(
      'table',
      { class: 'history' },
      h(
        'thead',
        {},
        h('tr', {}, ...['Datum', 'Pass', 'Tid', 'Distans', 'Medeleffekt', 'Källa', 'Status'].map((c) => h('th', {}, c))),
      ),
      body,
    ),
    h('nav', {}, h('button', { class: 'link', onclick: () => app.navigate('start') }, 'Tillbaka')),
  );

  void app.store.listSessions().then((sessions) => {
    body.replaceChildren(
      ...(sessions.length === 0
        ? [h('tr', {}, h('td', { colspan: 7 }, 'Inga pass ännu.'))]
        : sessions.map((s) =>
            h(
              'tr',
              {},
              h('td', {}, formatDate(s.startedAt)),
              h('td', {}, MODE_LABEL[s.mode]),
              h('td', { class: 'num' }, s.summary ? formatDuration(s.summary.duration) : '–'),
              h('td', { class: 'num' }, s.summary ? formatDistance(s.summary.distance) : '–'),
              h('td', { class: 'num' }, formatPower(s.summary?.avgPower)),
              h('td', {}, s.source === 'pm5' ? 'PM5' : 'Simulator'),
              h('td', {}, s.status === 'completed' ? 'Klart' : 'Avbrutet'),
            ),
          )),
    );
  });

  return () => {};
};
