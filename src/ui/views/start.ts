import { RealClock, SimClock, type SimSpeed } from '../../core/clock';
import { Pm5Source } from '../../sources/pm5/ble';
import { UsbPm5Source } from '../../sources/pm5/usb';
import { Simulator, type SimMode } from '../../sources/simulator';
import { kOf } from '../../model/signature';
import { BUILTIN_WORKOUTS } from '../../workout/builtin';
import { expand, totalDuration } from '../../workout/expand';
import { usesPctCP } from '../../workout/schema';
import type { View } from '../app';
import { debugPanel } from '../debugPanel';
import { h } from '../dom';
import { formatDuration } from '../format';

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
  );
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
    await app.useSource(new Simulator(clock, { mode: mode.value as SimMode, target: () => app.target() }), clock);
  });

  disconnect.addEventListener('click', () => void app.disconnect());
  start.addEventListener('click', () => {
    app.beeper.unlock(); // audio needs a user gesture
    app.navigate('live');
  });

  // Workout choice (spec §8.1): built-in workouts and free ride.
  const signatureText = h('p', { class: 'hint' }, 'Signatur saknas – gör test eller mata in');
  const noSignatureNote = h('p', { class: 'hint warn', hidden: true }, 'Signatur saknas – passet körs utan målband, W′ och MPA.');
  let hasSignature = false;
  const choices = [
    { id: 'free', label: 'Fri åkning', detail: 'ingen tidslinje', workout: null },
    ...BUILTIN_WORKOUTS.map((w) => ({ id: w.id, label: w.name, detail: formatDuration(totalDuration(expand(w, null))), workout: w })),
  ];
  const updateNote = (): void => {
    noSignatureNote.hidden = hasSignature || !app.workout || !usesPctCP(app.workout);
  };
  const workoutList = h(
    'div',
    { class: 'choices' },
    ...choices.map((c) => {
      const input = h('input', { type: 'radio', name: 'workout', value: c.id, checked: (app.workout?.id ?? 'free') === c.id });
      input.addEventListener('change', () => {
        app.workout = c.workout;
        updateNote();
      });
      return h('label', { class: 'choice' }, input, ` ${c.label} `, h('span', { class: 'hint' }, `· ${c.detail}`));
    }),
  );
  const loadSignature = async (): Promise<void> => {
    const sig = app.source ? await app.activeSignature() : null;
    hasSignature = sig !== null;
    signatureText.textContent = sig
      ? `PP ${Math.round(sig.pp)} W · CP ${Math.round(sig.cp)} W · W′ ${Math.round(sig.wPrime).toLocaleString('sv-SE')} J · k ${Math.round(kOf(sig))} s` +
        (sig.id === 'simulator-default' ? ' (simulatorns standardvärden)' : '')
      : 'Signatur saknas – gör test eller mata in';
    updateNote();
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
      h('div', { class: 'row small' }, h('label', {}, 'Simulatorhastighet ', speed), h('label', {}, 'Simulatorläge ', mode)),
      h('p', { class: 'hint small' }, 'En PM5 som sitter i USB ansluts automatiskt när du har valt den en gång.'),
      !usbSupported && !bleSupported && h('p', { class: 'hint' }, 'Varken WebHID eller Web Bluetooth stöds här. Använd Chrome eller Edge.'),
      error,
    ),
    h('section', { class: 'card' }, h('h2', {}, 'Signatur'), signatureText),
    h('section', { class: 'card' }, h('h2', {}, 'Pass'), workoutList, noSignatureNote, start),
    h('nav', {}, h('button', { class: 'link', onclick: () => app.navigate('history') }, 'Historik')),
    debug.el,
  );
  update();
  return () => {
    off();
    debug.cleanup();
  };
};
