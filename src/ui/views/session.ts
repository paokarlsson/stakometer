// After a session (spec §8.3), including the test result and signature suggestion (§7.3).
import { kOf, type FitnessSignature } from '../../model/signature';
import { analyzeSession } from '../../session/analysis';
import { summarize } from '../../session/summary';
import { suggestSignature } from '../../session/testResults';
import type { Session } from '../../storage/types';
import { workoutById } from '../../workout/builtin';
import type { View } from '../app';
import { sessionChart, signatureChart } from '../charts';
import { h } from '../dom';
import { formatDate, formatDistance, formatDuration, formatPower } from '../format';

const pct = (f: number): string => `${Math.round(f * 100)} %`;
const TEST_NAMES: Record<number, string> = { 30: '30 s', 180: '3 min', 600: '10 min' };

export const sessionView: View = (root, app) => {
  const disposers: (() => void)[] = [];
  const body = h('div', {}, h('p', { class: 'hint' }, 'Laddar…'));
  root.append(
    h('nav', {}, h('button', { class: 'link', onclick: () => app.navigate('history') }, '← Historik'), ' ', h('button', { class: 'link', onclick: () => app.navigate('start') }, 'Start')),
    body,
  );

  void (async () => {
    const session = app.sessionId ? await app.store.getSession(app.sessionId) : undefined;
    if (!session) {
      body.replaceChildren(h('p', {}, 'Passet finns inte.'));
      return;
    }
    const chunks = await app.store.getChunks(session.id);
    const analysis = analyzeSession(session, chunks, app.settings.skiba);
    // Recomputed from raw data, so sessions saved by older versions show every value too.
    const s = summarize(chunks, session.signatureSnapshot);
    const title = workoutById(session.workoutId)?.name ?? (session.mode === 'free' ? 'Fri åkning' : 'Pass');

    const stat = (label: string, value: string) => h('div', { class: 'metric' }, h('div', { class: 'label' }, label), h('div', { class: 'value small-value' }, value));
    const chartEl = h('div', { class: 'chart-box' });

    const intervals = analysis.segments.filter((x) => x.segment.targetW !== null || x.segment.isMax);
    const table =
      intervals.length > 0
        ? h(
            'table',
            { class: 'history' },
            h('thead', {}, h('tr', {}, ...['Segment', 'Mål', 'Medeleffekt', 'Inom bandet'].map((c) => h('th', {}, c)))),
            h(
              'tbody',
              {},
              ...intervals.map((x) =>
                h(
                  'tr',
                  {},
                  h('td', {}, x.segment.label),
                  h('td', { class: 'num' }, x.segment.isMax ? 'MAX' : formatPower(x.segment.targetW)),
                  h('td', { class: 'num' }, formatPower(x.avgPower)),
                  h('td', { class: 'num' }, x.inBand === null ? '–' : pct(x.inBand)),
                ),
              ),
            ),
          )
        : null;

    body.replaceChildren(
      h('h1', {}, title),
      h('p', { class: 'hint' }, `${formatDate(session.startedAt)} · ${session.source === 'pm5' ? 'PM5' : 'Simulator'} · ${session.status === 'completed' ? 'Klart' : 'Avbrutet'}`),
      h(
        'div',
        { class: 'metrics' },
        stat('Tid', s ? formatDuration(s.duration) : '–'),
        stat('Distans', s ? formatDistance(s.distance) : '–'),
        stat('Medeleffekt', formatPower(s?.avgPower)),
        stat('Arbete', s ? `${Math.round(s.workKJ)} kJ` : '–'),
        stat('Lägsta W′', s?.minWbal ? `${pct(Math.max(0, s.minWbal.fraction))} vid ${formatDuration(s.minWbal.t)}` : '–'),
      ),
      h('section', { class: 'card' }, h('h2', {}, 'Hela passet'), chartEl),
      ...(table ? [h('section', { class: 'card' }, h('h2', {}, 'Per intervall'), table)] : []),
      ...(session.mode === 'test' ? [await testSection(session, analysis.maxEffort)] : []),
    );
    if (analysis.power.length > 1) disposers.push(sessionChart(chartEl, session, analysis));
    else chartEl.replaceChildren(h('p', { class: 'hint' }, 'För lite data för en graf.'));
  })();

  /** Test result and, when all three tests are done, the signature suggestion. */
  async function testSection(session: Session, max: ReturnType<typeof analyzeSession>['maxEffort']): Promise<HTMLElement> {
    const section = h('section', { class: 'card' }, h('h2', {}, 'Test'));
    if (!max || !max.complete) {
      section.append(h('p', {}, 'Maxinsatsen blev inte klar, så passet gav inget testresultat.'));
      return section;
    }
    const duration = max.segment.end - max.segment.start;
    section.append(h('p', { class: 'big-line' }, `Testresultat ${TEST_NAMES[duration] ?? formatDuration(duration)}: ${formatPower(max.avgPower)}`));

    const simulated = session.source === 'simulator';
    const suggestion = suggestSignature(await app.store.listTestResults(session.machine), simulated);
    if (suggestion.kind === 'missing') {
      const names = suggestion.durations.map((d) => TEST_NAMES[d] ?? `${d} s`).join(' och ');
      section.append(h('p', { class: 'hint' }, `Gör även testet ${names} – gärna olika dagar, inom 14 dagar – så föreslår appen en ny signatur.`));
      return section;
    }
    const fit = suggestion.fit;
    if (!fit.ok) {
      section.append(
        h('p', { class: 'error' }, fit.error),
        h('button', { class: 'secondary', onclick: () => app.navigate('settings') }, 'Mata in signatur manuellt'),
      );
      return section;
    }

    const previous = await app.store.latestSignature(session.machine, simulated);
    const chartEl = h('div', { class: 'chart-box' });
    const status = h('p', { class: 'hint' });
    const approve = h('button', {}, 'Godkänn ny signatur');
    const decline = h('button', { class: 'secondary' }, 'Avböj');
    const buttons = h('div', { class: 'row' }, approve, decline);
    approve.addEventListener('click', async () => {
      const signature: FitnessSignature = {
        id: crypto.randomUUID(),
        machine: session.machine,
        pp: fit.pp,
        cp: fit.cp,
        wPrime: fit.wPrime,
        createdAt: new Date().toISOString(),
        source: 'test3p',
        testResultIds: suggestion.results.map((r) => r.id),
        ...(simulated && { simulated: true }),
      };
      await app.store.putSignature(signature);
      buttons.hidden = true;
      status.textContent = 'Ny signatur sparad. Den används från nästa pass.';
    });
    decline.addEventListener('click', () => {
      buttons.hidden = true;
      status.textContent = 'Förslaget avböjdes. Signaturen är oförändrad.';
    });

    const row = (label: string, now: number, before: number | undefined, unit: string) =>
      h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, `${Math.round(now).toLocaleString('sv-SE')} ${unit}`), h('td', { class: 'num' }, before === undefined ? '–' : `${Math.round(before).toLocaleString('sv-SE')} ${unit}`));
    section.append(
      h('h2', {}, 'Förslag på ny signatur'),
      h(
        'table',
        { class: 'history' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Förslag'), h('th', {}, 'Nuvarande'))),
        h(
          'tbody',
          {},
          row('PP', fit.pp, previous?.pp, 'W'),
          row('CP', fit.cp, previous?.cp, 'W'),
          row('W′', fit.wPrime, previous?.wPrime, 'J'),
          row('k', fit.k, previous ? kOf(previous) : undefined, 's'),
        ),
      ),
      h('p', { class: 'hint small' }, `Bygger på ${suggestion.results.map((r) => `${TEST_NAMES[r.duration]} ${Math.round(r.avgPower)} W (${formatDate(r.date)})`).join(', ')}.`),
      chartEl,
      buttons,
      status,
    );
    disposers.push(signatureChart(chartEl, suggestion.results.map((r) => ({ t: r.duration, p: r.avgPower })), fit, previous));
    return section;
  }

  return () => disposers.forEach((d) => d());
};
