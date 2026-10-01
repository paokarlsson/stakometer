// After a session (spec §8.3): the whole session in a chart, the summary and a table per
// interval; for a test also the result, the curve fit and the signature suggestion (§7.3).
import { powerAt } from '../../model/morton3p';
import { kOf, type FitnessSignature } from '../../model/signature';
import { analyzeSession, intervalRows, strokeStats } from '../../session/analysis';
import { summarize } from '../../session/summary';
import { wbalOptions } from '../../storage/settings';
import { dragFactorDiffers, MIN_TEST_LENGTHS, mixedDragFactors, previousTest, suggestSignature } from '../../session/testResults';
import type { Session } from '../../storage/types';
import { workoutById } from '../../workout/builtin';
import { heartRateShare } from '../../workout/plan';
import type { View } from '../app';
import { sessionChart, signatureChart } from '../charts';
import { pageHeader, stat, wallClock } from '../components';
import { h } from '../dom';
import { formatDate, formatDistance, formatDuration, formatKJ, formatPower, testName } from '../format';
import { icon } from '../icons';

const pct = (f: number): string => `${Math.round(f * 100)} %`;
/** "a", "a och b", "a, b och c". */
const list = (items: readonly string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} och ${items.at(-1)}`);
const COUNT = ['noll', 'ett', 'två', 'tre', 'fyra'];
/** "+12", "−0,6", "±0". */
const signed = (n: number, decimals = 0): string => {
  const r = Number(n.toFixed(decimals));
  const text = Math.abs(r).toLocaleString('sv-SE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${text}`;
};

export const sessionView: View = (root, app) => {
  const disposers: (() => void)[] = [];
  const body = h('div', {}, h('p', { class: 'hint' }, 'Laddar…'));
  root.append(pageHeader({ title: 'Passresultat', onBack: () => app.navigate(app.sessionBack), right: [wallClock()] }), body);

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
    const extra = strokeStats(chunks);
    const title = session.planned?.name ?? workoutById(session.workoutId)?.name ?? (session.mode === 'free' ? 'Fri åkning' : 'Pass');
    const km = `${(s.distance / 1000).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} km`;

    const tile = (label: string, value: string, note?: string): HTMLElement => {
      const t = stat(label, value);
      if (note) t.value.append(h('small', {}, note));
      return t.el;
    };
    const hrShare = extra.avgHeartRate !== null ? heartRateShare(extra.avgHeartRate, session.planned?.athlete) : null;
    const summary = h(
      'div',
      { class: 'summary-tiles' },
      tile('Tid', formatDuration(s.duration)),
      tile('Distans', formatDistance(s.distance)),
      tile('Medeleffekt', formatPower(s.avgPower)),
      tile('Arbete', `${Math.round(s.workKJ).toLocaleString('sv-SE')} kJ`),
      tile('Lägsta W′', s.minWbal ? pct(Math.max(0, s.minWbal.fraction)) : '–', s.minWbal ? `vid ${formatDuration(s.minWbal.t)}` : undefined),
      tile('Snittpuls', extra.avgHeartRate === null ? '–' : String(Math.round(extra.avgHeartRate)), hrShare ? `(${pct(hrShare.fraction)})` : undefined),
      tile('Dragtakt', extra.avgStrokeRate === null ? '–' : String(Math.round(extra.avgStrokeRate))),
      tile('Dragfaktor', extra.dragFactor === null ? '–' : String(Math.round(extra.dragFactor))),
    );

    const rows = intervalRows(analysis.segments);
    const intervals =
      rows.length > 0
        ? h(
            'section',
            { class: 'card' },
            h('h2', {}, 'Intervaller'),
            h(
              'div',
              { class: 'table-wrap' },
              h(
                'table',
                { class: 'table' },
                h('thead', {}, h('tr', {}, h('th', {}, 'Segment'), ...['Mål', 'Medel', 'Inom band', 'Lägsta W′'].map((c) => h('th', { class: 'num' }, c)))),
                h(
                  'tbody',
                  {},
                  ...rows.map((x) =>
                    h(
                      'tr',
                      {},
                      h('td', {}, x.segment.block ? `${x.segment.block} · ${x.segment.label}` : x.segment.label),
                      h('td', { class: 'num' }, x.segment.isMax ? 'MAX' : formatPower(x.segment.targetW)),
                      h('td', { class: 'num' }, formatPower(x.avgPower)),
                      h('td', { class: 'num' }, x.inBand === null ? '–' : pct(x.inBand)),
                      h('td', { class: 'num' }, x.minWbal === null ? '–' : pct(Math.max(0, x.minWbal))),
                    ),
                  ),
                ),
              ),
            ),
          )
        : null;

    const chartEl = h('div', { class: 'result-chart session-chart' });
    body.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h3', {}, title),
        h(
          'div',
          { class: 'row small' },
          `${formatDate(session.startedAt)} · ${formatDuration(s.duration)} · ${km}`,
          h('span', { class: 'status-tag' }, session.source === 'pm5' ? 'PM5' : 'Simulator'),
          h('span', { class: session.status === 'completed' ? 'status-tag ok' : 'status-tag bad' }, session.status === 'completed' ? 'Klart' : 'Avbrutet'),
          session.planned ? h('span', { class: 'status-tag' }, `Planerat ${session.planned.date}`) : null,
        ),
        session.planned?.description ? h('p', { class: 'description hint' }, session.planned.description) : null,
        chartEl,
      ),
      h('div', { class: 'result-grid' }, h('section', { class: 'card' }, h('h2', {}, 'Sammanfattning'), summary), intervals),
      ...(session.mode === 'test' ? [await testSection(session, analysis.maxEffort)] : []),
    );
    if (analysis.power.length > 1) disposers.push(sessionChart(chartEl, session, analysis));
    else chartEl.replaceChildren(h('p', { class: 'hint' }, 'För lite data för en graf.'));
  })();

  /** Test result and, when three or more lengths are done, the signature suggestion (spec §7.3). */
  async function testSection(session: Session, max: ReturnType<typeof analyzeSession>['maxEffort']): Promise<HTMLElement> {
    const section = h('section', { class: 'card' }, h('h2', {}, 'Testresultat och kurvanpassning'));
    if (!max || !max.complete) {
      section.append(h('p', {}, 'Maxinsatsen blev inte klar, så passet gav inget testresultat.'));
      return section;
    }
    const duration = max.segment.end - max.segment.start;
    const df = max.dragFactor === null ? null : Math.round(max.dragFactor);
    const left = h('div', {}, h('p', { class: 'big-line' }, `Testresultat ${testName(duration)}: ${formatPower(max.avgPower)}`));
    const right = h('div', {});
    section.append(h('div', { class: 'fit-grid' }, left, right));

    // Against the signature used in the session, e.g. for a control test between batteries.
    const used = session.signatureSnapshot;
    if (used && !used.id.endsWith('-default')) {
      const predicted = powerAt(duration, used);
      const diff = (max.avgPower - predicted) / predicted;
      left.append(
        h('p', { class: 'hint' }, `Signaturen i passet (CP ${Math.round(used.cp)} W) gav ${formatPower(predicted)} för ${testName(duration)}. Resultatet är ${Math.abs(Math.round(diff * 100))} % ${diff >= 0 ? 'högre' : 'lägre'}.`),
      );
    }

    const simulated = session.source === 'simulator';
    const all = await app.store.listTestResults(session.machine);
    const before = previousTest(all, duration, simulated, session.startedAt);
    if (df !== null) {
      const differs = before?.dragFactor !== undefined && dragFactorDiffers(df, before.dragFactor);
      left.append(
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
      left.append(
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
      left.append(h('p', { class: 'error' }, fit.error), h('button', { class: 'secondary', onclick: () => app.navigate('settings') }, 'Mata in signatur manuellt'));
      return section;
    }

    const previous = await app.store.latestSignature(session.machine, simulated);
    const status = h('p', { class: 'hint' });
    const approve = h('button', {}, icon('check'), 'Godkänn');
    const decline = h('button', { class: 'secondary' }, 'Avböj');
    const buttons = h('div', { class: 'overlay-buttons' }, approve, decline);
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

    const row = (label: string, value: string, now: number, before: number | undefined, decimals = 0) => {
      const delta = before === undefined ? null : now - before;
      return h(
        'tr',
        {},
        h('td', {}, label),
        h('td', {}, value),
        h('td', { class: delta === null || Math.abs(delta) < 10 ** -decimals / 2 ? 'hint' : delta > 0 ? 'delta-up' : 'delta-down' }, delta === null ? '' : `(${signed(delta, decimals)})`),
      );
    };
    const worst = fit.residuals.reduce((w, r, i) => (Math.abs(r) > Math.abs(fit.residuals[w]!) ? i : w), 0);
    const durations = suggestion.results.map((r) => r.duration);
    left.append(
      h(
        'div',
        { class: 'suggest' },
        h('h3', {}, 'Föreslagen ny signatur'),
        h(
          'table',
          {},
          h(
            'tbody',
            {},
            row('PP', `${Math.round(fit.pp)} W`, fit.pp, previous?.pp),
            row('CP', `${Math.round(fit.cp)} W`, fit.cp, previous?.cp),
            row('W′', `${formatKJ(fit.wPrime)} kJ`, fit.wPrime / 1000, previous ? previous.wPrime / 1000 : undefined, 1),
            row('k', `${fit.k.toLocaleString('sv-SE', { maximumFractionDigits: 1 })} s`, fit.k, previous ? kOf(previous) : undefined, 1),
          ),
        ),
        previous ? h('p', { class: 'hint small' }, 'Inom parentes: skillnaden mot nuvarande signatur.') : null,
      ),
      fit.residuals.length > MIN_TEST_LENGTHS
        ? h(
            'div',
            { class: 'fit-tiles' },
            stat('Residual (SSE)', `${Math.round(fit.sse).toLocaleString('sv-SE')} W²`).el,
            worstTile(`${Math.abs(Math.round(fit.residuals[worst]!))} W`, testName(durations[worst]!)),
          )
        : h('p', { class: 'hint' }, `Med tre test går kurvan genom alla punkterna, så det syns inte hur väl den passar. Gör även testet ${list(suggestion.missing.map(testName))} för att se det.`),
      ...dragFactorWarning(suggestion.results),
      buttons,
      status,
    );

    const chartEl = h('div', { class: 'result-chart' });
    right.append(
      chartEl,
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Test'), h('th', {}, 'Datum'), ...['Resultat', 'Kurvan', 'Avvikelse', 'Dragfaktor'].map((c) => h('th', { class: 'num' }, c)))),
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
                h('td', { class: 'num' }, `${signed(fit.residuals[i]!)} W`),
                h('td', { class: 'num' }, r.dragFactor === undefined ? '–' : String(r.dragFactor)),
              ),
            ),
          ),
        ),
      ),
    );
    disposers.push(signatureChart(chartEl, suggestion.results.map((r) => ({ t: r.duration, p: r.avgPower })), fit, previous));
    return section;
  }

  return () => disposers.forEach((d) => d());
};

function worstTile(value: string, test: string): HTMLElement {
  const t = stat('Största avvikelse', value);
  t.value.append(h('small', {}, test));
  return t.el;
}

function dragFactorWarning(results: Parameters<typeof mixedDragFactors>[0]): HTMLElement[] {
  const mixed = mixedDragFactors(results);
  return mixed
    ? [h('p', { class: 'hint warn' }, `Dragfaktorn skiljer mellan testen (${mixed.min}–${mixed.max}). Watt vid olika dragfaktor går inte helt att jämföra, så kurvan blir osäkrare.`)]
    : [];
}
