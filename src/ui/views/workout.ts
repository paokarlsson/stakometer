// A chosen workout before the start (spec §8.1, §6.5, §6.7, §7.3): its parts, structure and
// description, the intensity fitted to W′, the coach's values and warnings, and the start button.
import { kOf, validateSignature, type FitnessSignature } from '../../model/signature';
import { previousTest } from '../../session/testResults';
import { calibrationOptions } from '../../storage/settings';
import { calibrate } from '../../workout/calibrate';
import { expand, totalDuration } from '../../workout/expand';
import { completedPlanIds, isPlanned, localDate, type PlannedWorkout } from '../../workout/plan';
import { isStructured, maxEffortDuration, type TimelineSegment } from '../../workout/schema';
import type { View } from '../app';
import { pageHeader, stat } from '../components';
import { connectionCard, statusPill } from '../connection';
import { h } from '../dom';
import { formatDate, formatDay, formatDuration, formatKJ, formatPower } from '../format';
import { icon } from '../icons';
import { outline } from '../outline';
import { workoutStrip } from '../strip';
import { BATTERY_ADVICE } from './workouts';

/** [FÖRSLAG] The plan's CP and W′ count as different from the active signature beyond these shares. */
const PLAN_CP_TOLERANCE = 0.03;
const PLAN_WPRIME_TOLERANCE = 0.1;

const pct = (f: number): string => `${Math.round(Math.max(0, f) * 100)} %`;

/** The work in W: the intervals when there are any, so pickups in a planned warm-up do not count. */
function peakWork(timeline: readonly TimelineSegment[], cp: number): number {
  const above = timeline.filter((s) => s.targetW !== null && s.targetW > cp);
  const work = above.some((s) => s.kind === 'interval') ? above.filter((s) => s.kind === 'interval') : above;
  return Math.max(0, ...work.map((s) => Math.round(s.targetW!)));
}

export const workoutView: View = (root, app) => {
  const w = app.workout;
  const planned = isPlanned(w) ? w : null;
  const structured = w !== null && isStructured(w);
  const maxLength = w ? maxEffortDuration(w) : null;
  const back = (): void => app.navigate(app.category ? 'workouts' : 'start');

  const connection = connectionCard(app);
  const pill = statusPill(app);
  const facts = h('div', { class: 'facts' });
  const strip = h('div', {});
  const fitText = h('p', { class: 'hint', hidden: true });
  const testText = h('p', { class: 'hint', hidden: true });
  const coach = h('div', {});
  const start = h('button', { class: 'big' }, icon('play'), 'Starta');
  const startHint = h('span', { class: 'hint' });
  start.addEventListener('click', () => {
    app.beeper.unlock(); // audio needs a user gesture
    app.navigate('live');
  });

  const fact = (label: string, value: string): HTMLElement => stat(label, value, 'fact').el;

  let signature: FitnessSignature | null = null;
  let done = false;

  const render = async (): Promise<void> => {
    signature = await app.displaySignature();
    const sig = signature;
    const items: HTMLElement[] = [];
    if (planned) items.push(fact('Datum', formatDay(planned.date, localDate())));
    items.push(fact('Längd', structured ? formatDuration(totalDuration(expand(w!, null))) : w ? 'fri' : 'tills du stoppar'));

    // Intensity fitted to W′ (spec §6.5); tests are never fitted.
    fitText.hidden = true;
    if (w && structured && maxLength === null) {
      const timeline = expand(w, sig, app.settings.tolerance);
      const c = calibrate(timeline, sig, calibrationOptions(app.settings, planned?.calibration));
      const before = peakWork(timeline, sig.cp);
      const after = peakWork(c.timeline, sig.cp);
      if (before === 0) {
        fitText.textContent = 'Passet ligger under CP – W′ förbrukas inte.';
        fitText.hidden = false;
      } else {
        items.push(fact('Arbete', `${after} W`), fact('Lägsta W′ (beräknat)', pct(c.minWbal.fraction)));
        if (c.scale !== 1) {
          fitText.textContent = `Arbetet är anpassat till din signatur: ${after} W i stället för ${before} W, så att W′ landar på ${pct(c.minWbal.fraction)} (utan anpassning ${pct(c.before.fraction)}).`;
          fitText.hidden = false;
        }
      }
      strip.replaceChildren(workoutStrip(w, c.timeline).el);
    } else if (w && structured) {
      strip.replaceChildren(workoutStrip(w, expand(w, sig, app.settings.tolerance)).el);
    }

    // For a test: the last result of the same length and its drag factor (spec §7.3).
    testText.hidden = maxLength === null;
    if (maxLength !== null) {
      const prev = previousTest(await app.store.listTestResults(app.machine()), maxLength, app.source?.kind === 'simulator');
      if (prev) {
        items.push(fact('Förra testet', formatPower(prev.avgPower)));
        if (prev.dragFactor !== undefined) items.push(fact('Dragfaktor då', String(prev.dragFactor)));
        testText.textContent = `Förra testet gjordes ${formatDate(prev.date)}.${prev.dragFactor !== undefined ? ' Ställ dämparen så att dragfaktorn blir densamma.' : ''} ${BATTERY_ADVICE}`;
      } else testText.textContent = BATTERY_ADVICE;
    }
    if (done) items.push(fact('Status', '✓ genomfört'));
    facts.replaceChildren(...items);
    renderCoach(sig);
  };

  /** The coach's values from the plan, and warnings against the active signature (spec §6.7). */
  function renderCoach(sig: FitnessSignature): void {
    if (!planned) return;
    const a = planned.athlete;
    const nodes: (HTMLElement | null)[] = [
      planned.calibration
        ? h(
            'p',
            { class: 'hint small' },
            planned.calibration.mode === 'off'
              ? 'Planen anger målen som de står (ingen anpassning till W′).'
              : `Planen anger lägsta W′ ${Math.round((planned.calibration.minWbal ?? app.settings.minWbal) * 100)} % (${planned.calibration.mode === 'fit' ? 'landa på nivån' : 'sänk bara'}).`,
          )
        : null,
      a ? h('p', { class: 'hint small' }, athleteText(a)) : null,
    ];
    // Only for a real PM5; the simulator has its own signature.
    if (a && !sig.simulated && sig.id !== 'simulator-default') {
      if (sig.id === 'pm5-default' && a.pp !== undefined && a.cp !== undefined && a.wPrime !== undefined && validateSignature({ pp: a.pp, cp: a.cp, wPrime: a.wPrime }) === null) {
        const use = h('button', { class: 'secondary' }, `Använd planens signatur (CP ${Math.round(a.cp)} W)`);
        use.addEventListener('click', async () => {
          await app.store.putSignature({ id: crypto.randomUUID(), machine: app.machine(), pp: a.pp!, cp: a.cp!, wPrime: a.wPrime!, createdAt: new Date().toISOString(), source: 'manual' });
          await render();
        });
        nodes.push(h('div', { class: 'notice' }, 'Aktiv signatur är standardvärden. Planen har egna värden för PP, CP och W′.', h('div', { class: 'row' }, use)));
      } else if (sig.id !== 'pm5-default') {
        const cpDiffers = a.cp !== undefined && Math.abs(a.cp - sig.cp) / sig.cp > PLAN_CP_TOLERANCE;
        const wDiffers = a.wPrime !== undefined && Math.abs(a.wPrime - sig.wPrime) / sig.wPrime > PLAN_WPRIME_TOLERANCE;
        if (cpDiffers || wDiffers) {
          const planText = [a.cp !== undefined && `CP ${Math.round(a.cp)} W`, a.wPrime !== undefined && `W′ ${Math.round(a.wPrime).toLocaleString('sv-SE')} J`].filter(Boolean).join(' och ');
          nodes.push(
            h(
              'div',
              { class: 'notice' },
              `Planen skrevs med ${planText}, men aktiv signatur har CP ${Math.round(sig.cp)} W och W′ ${Math.round(sig.wPrime).toLocaleString('sv-SE')} J. Watten räknas från den aktiva signaturen.`,
            ),
          );
        }
      }
    }
    const remove = h('button', { class: 'link' }, 'Ta bort från listan');
    remove.addEventListener('click', async () => {
      if (!confirm(`Ta bort "${planned.name}" från planerade pass? Genomförda pass påverkas inte.`)) return;
      await app.store.deletePlannedWorkout(planned.id);
      app.workout = null;
      back();
    });
    nodes.push(remove);
    coach.replaceChildren(...nodes.filter((n): n is HTMLElement => n !== null));
  }

  const lines = w ? outline(w.segments) : [];
  const update = async (): Promise<void> => {
    pill.update();
    const connected = app.connection === 'connected';
    connection.el.hidden = connected;
    start.disabled = !connected;
    await render();
    startHint.textContent = !connected
      ? 'Anslut PM5 eller simulatorn först.'
      : signature
        ? `Signatur: CP ${Math.round(signature.cp)} W · W′ ${formatKJ(signature.wPrime)} kJ · k ${Math.round(kOf(signature))} s`
        : '';
  };
  const off = app.sourceChanged.on(() => void update());

  root.append(
    pageHeader({
      title: w?.name ?? 'Fri åkning',
      subtitle: planned ? 'Planerat pass från elitledet' : maxLength !== null ? 'Maxtest' : w ? 'Inbyggt pass' : 'Ingen tidslinje',
      onBack: back,
      right: [pill.el],
    }),
    connection.el,
    h(
      'section',
      { class: 'card' },
      facts,
      strip,
      w?.description ? h('p', { class: 'description' }, w.description) : null,
      !w ? h('p', { class: 'description' }, 'Livevyn visar effekt, MPA och W′-balans men inget målband. Passet pågår tills du stoppar. Bra för uppvärmning före ett pass.') : null,
      planned && !structured ? h('p', { class: 'hint' }, 'Passet saknar struktur och körs som fri åkning med beskrivningen.') : null,
      lines.length > 0
        ? h(
            'ul',
            { class: 'outline' },
            ...lines.map((l) => h('li', { style: `margin-left: ${l.depth * 1.25}rem` }, l.text, l.description ? h('div', { class: 'hint small description' }, l.description) : null)),
          )
        : null,
      fitText,
      testText,
      coach,
    ),
    h('div', { class: 'start-bar' }, start, startHint),
  );

  void (async () => {
    if (planned) done = completedPlanIds(await app.store.listSessions()).has(planned.id);
    await update();
  })();
  return () => {
    off();
    connection.cleanup();
  };
};

/** "Från planen: maxpuls 188 · tröskelpuls 168 · … (2026-10-05)". */
function athleteText(a: NonNullable<PlannedWorkout['athlete']>): string {
  const n = (v: number) => Math.round(v).toLocaleString('sv-SE');
  const parts = [
    a.maxHR !== undefined && `maxpuls ${n(a.maxHR)}`,
    a.thresholdHR !== undefined && `tröskelpuls ${n(a.thresholdHR)}`,
    a.restingHR !== undefined && `vilopuls ${n(a.restingHR)}`,
    a.pp !== undefined && `PP ${n(a.pp)} W`,
    a.cp !== undefined && `CP ${n(a.cp)} W`,
    a.wPrime !== undefined && `W′ ${n(a.wPrime)} J`,
    a.dragFactor !== undefined && `dragfaktor ${n(a.dragFactor)}`,
    a.weight !== undefined && `${a.weight.toLocaleString('sv-SE', { maximumFractionDigits: 1 })} kg`,
  ].filter(Boolean);
  return `Från planen: ${parts.length > 0 ? parts.join(' · ') : 'inga värden'}${a.asOf ? ` (${a.asOf})` : ''}`;
}
