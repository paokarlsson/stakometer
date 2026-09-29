import { RealClock, SimClock, type SimSpeed } from '../../core/clock';
import { Pm5Source } from '../../sources/pm5/ble';
import { UsbPm5Source } from '../../sources/pm5/usb';
import { DEFAULT_DRAG_FACTOR, Simulator, type SimMode } from '../../sources/simulator';
import { previousTest } from '../../session/testResults';
import { kOf } from '../../model/signature';
import { BUILTIN_WORKOUTS, TEST_WORKOUTS } from '../../workout/builtin';
import { expand, totalDuration } from '../../workout/expand';
import { calibrate } from '../../workout/calibrate';
import { maxEffortDuration } from '../../workout/schema';
import { calibrationOptions } from '../../storage/settings';
import type { FitnessSignature } from '../../model/signature';
import type { View } from '../app';
import { debugPanel } from '../debugPanel';
import { h } from '../dom';
import { formatDate, formatDuration, formatPower } from '../format';

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
    const w = app.workout;
    const sig = signature;
    planInfo.hidden = !w || !sig || maxEffortDuration(w) !== null;
    if (!w || !sig || planInfo.hidden) return;
    const planned = expand(w, sig, app.settings.tolerance);
    const c = calibrate(planned, sig, calibrationOptions(app.settings));
    const peak = (t: typeof planned) => Math.max(0, ...t.filter((s) => s.targetW !== null && s.targetW > sig.cp).map((s) => Math.round(s.targetW!)));
    const pct = (f: number) => `${Math.round(Math.max(0, f) * 100)} %`;
    if (peak(planned) === 0) planInfo.textContent = 'Passet ligger under CP – W′ förbrukas inte.';
    else if (c.scale === 1) planInfo.textContent = `Arbete ${peak(c.timeline)} W · beräknat lägsta W′ ${pct(c.minWbal.fraction)}`;
    else {
      planInfo.textContent =
        `Arbete ${peak(c.timeline)} W (justerat från ${peak(planned)} W) · beräknat lägsta W′ ${pct(c.minWbal.fraction)}` +
        ` (utan justering ${pct(c.before.fraction)})`;
    }
  };
  const asChoice = (w: (typeof BUILTIN_WORKOUTS)[number]) => ({ id: w.id, label: w.name, detail: formatDuration(totalDuration(expand(w, null))), workout: w });
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
  const workoutList = h(
    'div',
    { class: 'choices' },
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
    h('section', { class: 'card' }, h('h2', {}, 'Pass'), workoutList, planInfo, testInfo, start),
    h(
      'nav',
      { class: 'row' },
      h('button', { class: 'link', onclick: () => app.navigate('history') }, 'Historik'),
      h('button', { class: 'link', onclick: () => app.navigate('settings') }, 'Inställningar'),
    ),
    debug.el,
  );
  update();
  return () => {
    off();
    debug.cleanup();
  };
};
