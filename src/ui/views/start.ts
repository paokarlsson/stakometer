import { RealClock, SimClock, type SimSpeed } from '../../core/clock';
import { Pm5Source } from '../../sources/pm5/ble';
import { UsbPm5Source } from '../../sources/pm5/usb';
import { DEFAULT_DRAG_FACTOR, Simulator, type SimMode } from '../../sources/simulator';
import { previousTest } from '../../session/testResults';
import { kOf, validateSignature } from '../../model/signature';
import { BUILTIN_WORKOUTS, TEST_WORKOUTS } from '../../workout/builtin';
import { expand, totalDuration } from '../../workout/expand';
import { calibrate } from '../../workout/calibrate';
import { isPlanned, localDate, parsePlan, plannedForList, type PlannedWorkout } from '../../workout/plan';
import { isStructured, maxEffortDuration, type Workout } from '../../workout/schema';
import { calibrationOptions } from '../../storage/settings';
import type { FitnessSignature } from '../../model/signature';
import type { View } from '../app';
import { debugPanel } from '../debugPanel';
import { h } from '../dom';
import { formatDate, formatDay, formatDuration, formatPower } from '../format';
import { outline } from '../outline';

/** [FÖRSLAG] The plan's CP and W′ count as different from the active signature beyond these shares. */
const PLAN_CP_TOLERANCE = 0.03;
const PLAN_WPRIME_TOLERANCE = 0.1;

export const startView: View = (root, app) => {
  const status = h('p', { class: 'status' });
  const error = h('p', { class: 'error', hidden: true });
  const speed = h(
    'select',
    { id: 'sim-speed' },
    h('option', { value: '1' }, '1×'),
    h('option', { value: '5' }, '5×'),
    h('option', { value: '20' }, '20×'),
  );
  const mode = h(
    'select',
    { id: 'sim-mode' },
    h('option', { value: 'followTarget' }, 'Jämn effekt'),
    h('option', { value: 'manual' }, 'Manuell (piltangenter)'),
    h('option', { value: 'fatigue' }, 'Trötthet (sann signatur 550/220/18 000)'),
  );
  const simDrag = h('input', { type: 'number', id: 'sim-drag', min: '50', max: '250', step: '1', value: String(DEFAULT_DRAG_FACTOR), class: 'narrow' });
  const usbSupported = UsbPm5Source.isSupported();
  const bleSupported = Pm5Source.isSupported();
  const connectUsb = h('button', { disabled: !usbSupported }, 'Anslut PM5 via USB');
  const connectBle = h('button', { class: 'secondary', disabled: !bleSupported }, 'Anslut via Bluetooth');
  const showAll = h('button', { class: 'link' }, 'Hittar du inte PM5 via Bluetooth? Visa alla enheter');
  const useSim = h('button', { class: 'secondary' }, 'Använd simulator');
  const disconnect = h('button', { class: 'secondary' }, 'Koppla från');
  const start = h('button', { class: 'primary big' }, 'Starta');

  const showError = (err: unknown): void => {
    // A cancelled device chooser is not an error worth showing.
    if (err instanceof DOMException && err.name === 'NotFoundError') return;
    error.textContent = err instanceof Error ? err.message : String(err);
    error.hidden = false;
  };

  const connectWith = async (create: (clock: RealClock) => Promise<Pm5Source | UsbPm5Source | null>): Promise<void> => {
    error.hidden = true;
    const clock = new RealClock();
    try {
      const source = await create(clock);
      if (source) await app.useSource(source, clock);
    } catch (err) {
      showError(err);
    }
  };
  connectUsb.addEventListener('click', () =>
    void connectWith(async (clock) => {
      // Reuse a permitted device if one is plugged in, otherwise ask.
      const device = (await UsbPm5Source.findConnected()) ?? (await UsbPm5Source.request());
      return device && new UsbPm5Source(device, clock);
    }),
  );
  connectBle.addEventListener('click', () => void connectWith(async (clock) => new Pm5Source(clock)));
  showAll.addEventListener('click', () => void connectWith(async (clock) => new Pm5Source(clock, { showAll: true })));

  useSim.addEventListener('click', async () => {
    error.hidden = true;
    const clock = new SimClock(Number(speed.value) as SimSpeed);
    const dragFactor = Number(simDrag.value) || DEFAULT_DRAG_FACTOR;
    await app.useSource(new Simulator(clock, { mode: mode.value as SimMode, dragFactor, target: () => app.target(), maxEffort: () => app.maxEffort() }), clock);
  });

  disconnect.addEventListener('click', () => void app.disconnect());
  start.addEventListener('click', () => {
    app.beeper.unlock(); // audio needs a user gesture
    app.navigate('live');
  });

  // Workout choice (spec §8.1): built-in workouts and free ride.
  const signatureText = h('p', { class: 'hint' }, 'Anslut för att se aktiv signatur');
  // Planned intensity and lowest W′ for the chosen workout (fitted per settings).
  const planInfo = h('p', { class: 'hint', hidden: true });
  // For a test: the last result of the same length and its drag factor (spec §7.3).
  const testInfo = h('p', { class: 'hint', hidden: true });
  let signature: FitnessSignature | null = null;
  const updateTestInfo = async (): Promise<void> => {
    const w = app.workout;
    const duration = w ? maxEffortDuration(w) : null;
    const source = app.source;
    const prev = duration !== null && source ? previousTest(await app.store.listTestResults(app.machine()), duration, source.kind === 'simulator') : undefined;
    if (app.workout !== w) return; // the choice changed while loading
    testInfo.hidden = !prev;
    if (prev) {
      testInfo.textContent =
        `Förra testet: ${formatPower(prev.avgPower)} (${formatDate(prev.date)})` +
        (prev.dragFactor !== undefined ? ` med dragfaktor ${prev.dragFactor}. Ställ dämparen så att dragfaktorn blir densamma.` : '.');
    }
  };
  const updatePlan = (): void => {
    void updateTestInfo();
    updatePlannedInfo();
    const w = app.workout;
    const sig = signature;
    planInfo.hidden = !w || !sig || !isStructured(w) || maxEffortDuration(w) !== null;
    if (!w || !sig || planInfo.hidden) return;
    const planned = expand(w, sig, app.settings.tolerance);
    const c = calibrate(planned, sig, calibrationOptions(app.settings, isPlanned(w) ? w.calibration : undefined));
    // The work is the intervals when there are any, so pickups in a planned warm-up do not count.
    const peak = (t: typeof planned) => {
      const above = t.filter((s) => s.targetW !== null && s.targetW > sig.cp);
      const work = above.some((s) => s.kind === 'interval') ? above.filter((s) => s.kind === 'interval') : above;
      return Math.max(0, ...work.map((s) => Math.round(s.targetW!)));
    };
    const pct = (f: number) => `${Math.round(Math.max(0, f) * 100)} %`;
    if (peak(planned) === 0) planInfo.textContent = 'Passet ligger under CP – W′ förbrukas inte.';
    else if (c.scale === 1) planInfo.textContent = `Arbete ${peak(c.timeline)} W · beräknat lägsta W′ ${pct(c.minWbal.fraction)}`;
    else {
      planInfo.textContent =
        `Arbete ${peak(c.timeline)} W (justerat från ${peak(planned)} W) · beräknat lägsta W′ ${pct(c.minWbal.fraction)}` +
        ` (utan justering ${pct(c.before.fraction)})`;
    }
  };
  const lengthText = (w: Workout): string => (isStructured(w) ? formatDuration(totalDuration(expand(w, null))) : 'ostrukturerat');
  const asChoice = (w: Workout) => ({ id: w.id, label: w.name, detail: lengthText(w), workout: w as Workout | null });
  const choices = [{ id: 'free', label: 'Fri åkning', detail: 'ingen tidslinje', workout: null }, ...BUILTIN_WORKOUTS.map(asChoice)];
  const testChoices = TEST_WORKOUTS.map(asChoice);
  const radio = (c: (typeof choices)[number]) => {
    const input = h('input', { type: 'radio', name: 'workout', value: c.id, checked: (app.workout?.id ?? 'free') === c.id });
    input.addEventListener('change', () => {
      app.workout = c.workout;
      updatePlan();
    });
    return h('label', { class: 'choice' }, input, ` ${c.label} `, h('span', { class: 'hint' }, `· ${c.detail}`));
  };

  // Planned workouts from elitledet (plan.md §4.1, spec §6.7): imported from a file, listed first.
  const plannedList = h('div', {});
  const plannedStatus = h('p', { class: 'hint small', hidden: true });
  const plannedInfo = h('div', { class: 'planned-info', hidden: true });
  const planFile = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const importPlan = h('button', { class: 'secondary' }, 'Importera plan…');
  importPlan.addEventListener('click', () => planFile.click());
  let planned: PlannedWorkout[] = [];
  let completed = new Set<string>();
  const showPlannedStatus = (text: string, isError = false): void => {
    plannedStatus.textContent = text;
    plannedStatus.className = isError ? 'error' : 'hint small';
    plannedStatus.hidden = false;
  };
  const loadPlanned = async (): Promise<void> => {
    const today = localDate();
    const [all, sessions] = await Promise.all([app.store.listPlannedWorkouts(), app.store.listSessions()]);
    completed = new Set(sessions.filter((s) => s.planned && s.status === 'completed').map((s) => s.planned!.id));
    planned = plannedForList(all, today);
    // Keep the choice in step with the stored copy (replaced by a new import, or deleted).
    if (isPlanned(app.workout)) {
      const id = app.workout.id;
      app.workout = all.find((w) => w.id === id) ?? null;
      if (!app.workout) (workoutList.querySelector('input[value="free"]') as HTMLInputElement | null)?.click();
    }
    plannedList.replaceChildren(
      ...(planned.length === 0
        ? [h('p', { class: 'hint small' }, 'Inga planerade pass. Importera veckans fil från elitledet.')]
        : planned.map((w) => radio({ id: w.id, label: `${formatDay(w.date, today)} · ${w.name}${completed.has(w.id) ? ' ✓' : ''}`, detail: lengthText(w), workout: w }))),
    );
    updatePlan();
  };
  planFile.addEventListener('change', async () => {
    const file = planFile.files?.[0];
    planFile.value = '';
    if (!file) return;
    try {
      let json: unknown;
      try {
        json = JSON.parse(await file.text());
      } catch {
        throw new Error('Filen är inte giltig JSON.');
      }
      const plan = parsePlan(json);
      const existing = new Set((await app.store.listPlannedWorkouts()).map((w) => w.id));
      await app.store.putPlannedWorkouts(plan.workouts);
      const replaced = plan.workouts.filter((w) => existing.has(w.id)).length;
      showPlannedStatus(`Importerade ${plan.workouts.length} pass från ${file.name}${replaced > 0 ? ` (${replaced} ersatte tidigare versioner)` : ''}.`);
      await loadPlanned();
    } catch (err) {
      showPlannedStatus(`Planen importerades inte. ${err instanceof Error ? err.message : String(err)}`, true);
    }
  });

  /** Details for a chosen planned workout: description, structure, the coach's athlete values. */
  function updatePlannedInfo(): void {
    const w = app.workout;
    plannedInfo.hidden = !isPlanned(w);
    if (!isPlanned(w)) return;
    const a = w.athlete;
    const sig = signature;
    const lines = outline(w.segments);
    const nodes: (HTMLElement | null)[] = [
      h('h3', {}, w.name),
      h('p', { class: 'hint' }, `${formatDay(w.date, localDate())} · ${isStructured(w) ? formatDuration(totalDuration(expand(w, null))) : 'ostrukturerat – körs som fri åkning med beskrivningen'}${completed.has(w.id) ? ' · genomfört' : ''}`),
      w.description ? h('p', { class: 'description' }, w.description) : null,
      lines.length > 0
        ? h(
            'ul',
            { class: 'outline' },
            ...lines.map((l) => h('li', { style: `margin-left: ${l.depth * 1.25}rem` }, l.text, l.description ? h('div', { class: 'hint small description' }, l.description) : null)),
          )
        : null,
      w.calibration
        ? h('p', { class: 'hint small' }, w.calibration.mode === 'off' ? 'Planen anger målen som de står (ingen anpassning till W′).' : `Planen anger lägsta W′ ${Math.round((w.calibration.minWbal ?? app.settings.minWbal) * 100)} % (${w.calibration.mode === 'fit' ? 'landa på nivån' : 'sänk bara'}).`)
        : null,
      a ? h('p', { class: 'hint small' }, athleteText(a)) : null,
    ];
    // The plan's signature against the active one (only for a real PM5; the simulator has its own).
    if (a && sig && !sig.simulated && sig.id !== 'simulator-default') {
      if (sig.id === 'pm5-default' && a.pp !== undefined && a.cp !== undefined && a.wPrime !== undefined && validateSignature({ pp: a.pp, cp: a.cp, wPrime: a.wPrime }) === null) {
        const use = h('button', { class: 'secondary' }, `Använd planens signatur (CP ${Math.round(a.cp)} W)`);
        use.addEventListener('click', async () => {
          await app.store.putSignature({ id: crypto.randomUUID(), machine: app.machine(), pp: a.pp!, cp: a.cp!, wPrime: a.wPrime!, createdAt: new Date().toISOString(), source: 'manual' });
          await loadSignature();
        });
        nodes.push(h('p', { class: 'hint warn' }, 'Aktiv signatur är standardvärden. Planen har egna värden för PP, CP och W′.'), h('div', { class: 'row' }, use));
      } else if (sig.id !== 'pm5-default') {
        const cpDiffers = a.cp !== undefined && Math.abs(a.cp - sig.cp) / sig.cp > PLAN_CP_TOLERANCE;
        const wDiffers = a.wPrime !== undefined && Math.abs(a.wPrime - sig.wPrime) / sig.wPrime > PLAN_WPRIME_TOLERANCE;
        if (cpDiffers || wDiffers) {
          const planText = [a.cp !== undefined && `CP ${Math.round(a.cp)} W`, a.wPrime !== undefined && `W′ ${Math.round(a.wPrime).toLocaleString('sv-SE')} J`].filter(Boolean).join(' och ');
          nodes.push(
            h(
              'p',
              { class: 'hint warn' },
              `Planen skrevs med ${planText}, men aktiv signatur har CP ${Math.round(sig.cp)} W och W′ ${Math.round(sig.wPrime).toLocaleString('sv-SE')} J. Watten räknas från den aktiva signaturen.`,
            ),
          );
        }
      }
    }
    const remove = h('button', { class: 'link' }, 'Ta bort från listan');
    remove.addEventListener('click', async () => {
      if (!confirm(`Ta bort "${w.name}" från planerade pass? Genomförda pass påverkas inte.`)) return;
      await app.store.deletePlannedWorkout(w.id);
      await loadPlanned();
    });
    nodes.push(remove);
    plannedInfo.replaceChildren(...nodes.filter((n): n is HTMLElement => n !== null));
  }

  const workoutList = h(
    'div',
    { class: 'choices' },
    h('div', { class: 'choice-group' }, 'Planerade pass'),
    plannedList,
    h('div', { class: 'row small' }, importPlan, planFile),
    plannedStatus,
    h('div', { class: 'choice-group' }, 'Standardpass'),
    ...choices.map(radio),
    h('div', { class: 'choice-group' }, 'Testbatteri'),
    h(
      'p',
      { class: 'hint small' },
      'Gör alla fyra testen inom 14 dagar, med samma dragfaktor. Högst två samma dag, med minst 30 min lugnt emellan – till exempel 12 min dag 1, 30 s och 3 min dag 2, 6 min dag 3. Efter tre av dem föreslår appen en ny signatur, och med alla fyra syns hur väl kurvan passar.',
    ),
    ...testChoices.map(radio),
  );
  const loadSignature = async (): Promise<void> => {
    const sig = await app.activeSignature();
    signature = sig;
    updatePlan();
    const defaults: Record<string, string> = {
      'simulator-default': ' (simulatorns standardvärden)',
      'pm5-default': ' (standardvärden – gör test eller mata in egna)',
    };
    signatureText.textContent = sig
      ? `PP ${Math.round(sig.pp)} W · CP ${Math.round(sig.cp)} W · W′ ${Math.round(sig.wPrime).toLocaleString('sv-SE')} J · k ${Math.round(kOf(sig))} s` +
        (defaults[sig.id] ?? '')
      : 'Anslut för att se aktiv signatur';
  };

  const update = (): void => {
    const connected = app.connection === 'connected';
    const labels = {
      connected: app.pm5
        ? `Ansluten till ${app.pm5.deviceName ?? 'PM5'} via ${app.pm5.transport === 'usb' ? 'USB' : 'Bluetooth'}`
        : 'Simulator ansluten',
      reconnecting: 'Återansluter…',
      disconnected: 'Inte ansluten',
    };
    status.textContent = labels[app.connection];
    status.dataset.state = app.connection;
    connectUsb.hidden = connected;
    connectBle.hidden = connected;
    showAll.hidden = connected || !bleSupported;
    useSim.hidden = connected;
    disconnect.hidden = !connected;
    start.disabled = !connected;
    void loadSignature();
  };
  const off = app.sourceChanged.on(update);
  const debug = debugPanel(app);

  root.append(
    h('h1', {}, 'SkiErg Training'),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Anslutning'),
      status,
      h('div', { class: 'row' }, connectUsb, connectBle, useSim, disconnect),
      showAll,
      h('div', { class: 'row small' }, h('label', {}, 'Simulatorhastighet ', speed), h('label', {}, 'Simulatorläge ', mode), h('label', {}, 'Simulatorns dragfaktor ', simDrag)),
      h('p', { class: 'hint small' }, 'En PM5 som sitter i USB ansluts automatiskt när du har valt den en gång.'),
      !usbSupported && !bleSupported && h('p', { class: 'hint' }, 'Varken WebHID eller Web Bluetooth stöds här. Använd Chrome eller Edge.'),
      error,
    ),
    h('section', { class: 'card' }, h('h2', {}, 'Signatur'), signatureText),
    h('section', { class: 'card' }, h('h2', {}, 'Pass'), workoutList, plannedInfo, planInfo, testInfo, start),
    h(
      'nav',
      { class: 'row' },
      h('button', { class: 'link', onclick: () => app.navigate('history') }, 'Historik'),
      h('button', { class: 'link', onclick: () => app.navigate('settings') }, 'Inställningar'),
    ),
    debug.el,
  );
  update();
  void loadPlanned();
  return () => {
    off();
    debug.cleanup();
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
