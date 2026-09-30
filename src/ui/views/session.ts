// After a session (spec §8.3), including the test result and signature suggestion (§7.3).
import { powerAt } from '../../model/morton3p';
import { kOf, type FitnessSignature } from '../../model/signature';
import { analyzeSession } from '../../session/analysis';
import { summarize } from '../../session/summary';
import { wbalOptions } from '../../storage/settings';
import { dragFactorDiffers, MIN_TEST_LENGTHS, mixedDragFactors, previousTest, suggestSignature } from '../../session/testResults';
import type { Session } from '../../storage/types';
import { workoutById } from '../../workout/builtin';
import type { View } from '../app';
import { sessionChart, signatureChart } from '../charts';
import { h } from '../dom';
import { formatDate, formatDistance, formatDuration, formatPower } from '../format';

const pct = (f: number): string => `${Math.round(f * 100)} %`;
const TEST_NAMES: Record<number, string> = { 30: '30 s', 180: '3 min', 360: '6 min', 720: '12 min' };
const testName = (d: number): string => TEST_NAMES[d] ?? formatDuration(d);
/** "a", "a och b", "a, b och c". */
const list = (items: readonly string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} och ${items.at(-1)}`);
const COUNT = ['noll', 'ett', 'två', 'tre', 'fyra'];
const signedW = (w: number): string => {
  const r = Math.round(w);
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r)} W`;
};

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
    const analysis = analyzeSession(session, chunks, wbalOptions(app.settings));
    // Recomputed from raw data, so sessions saved by older versions show every value too.
    const s = summarize(chunks, session.signatureSnapshot, wbalOptions(app.settings));
    const title = session.planned?.name ?? workoutById(session.workoutId)?.name ?? (session.mode === 'free' ? 'Fri åkning' : 'Pass');

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
                  h('td', {}, x.segment.block ? `${x.segment.block} · ${x.segment.label}` : x.segment.label),
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
      h('p', { class: 'hint' }, `${formatDate(session.startedAt)} · ${session.source === 'pm5' ? 'PM5' : 'Simulator'} · ${session.status === 'completed' ? 'Klart' : 'Avbrutet'}${session.planned ? ` · planerat ${session.planned.date}` : ''}`),
      ...(session.planned?.description ? [h('p', { class: 'description' }, session.planned.description)] : []),
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

  /** Test result and, when three or more lengths are done, the signature suggestion (spec §7.3). */
  async function testSection(session: Session, max: ReturnType<typeof analyzeSession>['maxEffort']): Promise<HTMLElement> {
    const section = h('section', { class: 'card' }, h('h2', {}, 'Test'));
    if (!max || !max.complete) {
      section.append(h('p', {}, 'Maxinsatsen blev inte klar, så passet gav inget testresultat.'));
      return section;
    }
    const duration = max.segment.end - max.segment.start;
    const df = max.dragFactor === null ? null : Math.round(max.dragFactor);
    section.append(h('p', { class: 'big-line' }, `Testresultat ${testName(duration)}: ${formatPower(max.avgPower)}`));

    // Against the signature used in the session, e.g. for a control test between batteries.
    const used = session.signatureSnapshot;
    if (used && !used.id.endsWith('-default')) {
      const predicted = powerAt(duration, used);
      const diff = (max.avgPower - predicted) / predicted;
      section.append(
        h('p', { class: 'hint' }, `Signaturen i passet (CP ${Math.round(used.cp)} W) gav ${formatPower(predicted)} för ${testName(duration)}. Resultatet är ${Math.abs(Math.round(diff * 100))} % ${diff >= 0 ? 'högre' : 'lägre'}.`),
      );
    }

    const simulated = session.source === 'simulator';
    const all = await app.store.listTestResults(session.machine);
    const before = previousTest(all, duration, simulated, session.startedAt);
    if (df !== null) {
      const differs = before?.dragFactor !== undefined && dragFactorDiffers(df, before.dragFactor);
      section.append(
        h(
          'p',
          { class: differs ? 'hint warn' : 'hint' },
          `Dragfaktor ${df}.` + (differs ? ` Förra testet ${testName(duration)} gjordes med ${before!.dragFactor}, så resultaten går inte helt att jämföra.` : ''),
        ),
      );
    }

    const suggestion = suggestSignature(all, simulated);
    if (suggestion.kind === 'missing') {
      const needed = MIN_TEST_LENGTHS - suggestion.results.length;
      const more = suggestion.results.length > 0 ? ' till' : '';
      section.append(
        h(
          'p',
          { class: 'hint' },
          `Gör minst ${COUNT[needed]}${more} av testen ${list(suggestion.durations.map(testName))} inom 14 dagar, så föreslår appen en ny signatur. Med alla fyra syns också hur väl kurvan passar.`,
        ),
      );
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
      h('h2', {}, 'Testen och kurvan'),
      h(
        'table',
        { class: 'history' },
        h('thead', {}, h('tr', {}, ...['Test', 'Datum', 'Resultat', 'Kurvan', 'Avvikelse', 'Dragfaktor'].map((c) => h('th', {}, c)))),
        h(
          'tbody',
          {},
          ...suggestion.results.map((r, i) =>
            h(
              'tr',
              {},
              h('td', {}, testName(r.duration)),
              h('td', {}, formatDate(r.date)),
              h('td', { class: 'num' }, formatPower(r.avgPower)),
              h('td', { class: 'num' }, formatPower(powerAt(r.duration, fit))),
              h('td', { class: 'num' }, signedW(fit.residuals[i]!)),
              h('td', { class: 'num' }, r.dragFactor === undefined ? '–' : String(r.dragFactor)),
            ),
          ),
        ),
      ),
      residualText(suggestion.missing, fit.residuals, fit.sse, suggestion.results.map((r) => r.duration)),
      ...dragFactorWarning(suggestion.results),
      chartEl,
      buttons,
      status,
    );
    disposers.push(signatureChart(chartEl, suggestion.results.map((r) => ({ t: r.duration, p: r.avgPower })), fit, previous));
    return section;
  }

  return () => disposers.forEach((d) => d());
};

/** How well the curve fits (spec §7.3). With three points it passes through all of them. */
function residualText(missing: readonly number[], residuals: readonly number[], sse: number, durations: readonly number[]): HTMLElement {
  if (residuals.length <= MIN_TEST_LENGTHS) {
    return h(
      'p',
      { class: 'hint' },
      `Med tre test går kurvan genom alla punkterna, så det syns inte hur väl den passar. Gör även testet ${list(missing.map(testName))} för att se det.`,
    );
  }
  const worst = residuals.reduce((w, r, i) => (Math.abs(r) > Math.abs(residuals[w]!) ? i : w), 0);
  return h(
    'p',
    { class: 'hint' },
    `Residual: SSE ${Math.round(sse).toLocaleString('sv-SE')} W² · största avvikelse ${Math.abs(Math.round(residuals[worst]!))} W (${testName(durations[worst]!)}).`,
  );
}

function dragFactorWarning(results: Parameters<typeof mixedDragFactors>[0]): HTMLElement[] {
  const mixed = mixedDragFactors(results);
  return mixed
    ? [h('p', { class: 'hint warn' }, `Dragfaktorn skiljer mellan testen (${mixed.min}–${mixed.max}). Watt vid olika dragfaktor går inte helt att jämföra, så kurvan blir osäkrare.`)]
    : [];
}
