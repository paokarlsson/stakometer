// Connecting to the PM5 or the simulator (spec §8.1): USB is the default, Bluetooth only when chosen.
import { RealClock, SimClock, type SimSpeed } from '../core/clock';
import { Pm5Source } from '../sources/pm5/ble';
import { UsbPm5Source } from '../sources/pm5/usb';
import { DEFAULT_DRAG_FACTOR, Simulator, type SimMode } from '../sources/simulator';
import type { App, Cleanup } from './app';
import { h } from './dom';
import { icon } from './icons';

export function connectionLabel(app: App): string {
  const labels = {
    connected: app.pm5 ? `${app.pm5.deviceName ?? 'PM5'} ansluten` : 'Simulator ansluten',
    reconnecting: 'Återansluter…',
    disconnected: 'Inte ansluten',
  };
  return labels[app.connection];
}

/** Status pill, e.g. "● PM5 ansluten". Clicking it calls `onClick`. */
export function statusPill(app: App, onClick?: () => void): { el: HTMLElement; update: () => void } {
  const el = h('button', { class: 'pill', type: 'button' });
  if (onClick) el.addEventListener('click', onClick);
  const update = (): void => {
    el.textContent = connectionLabel(app);
    el.dataset.state = app.connection;
    el.title = app.pm5 ? `Ansluten via ${app.pm5.transport === 'usb' ? 'USB' : 'Bluetooth'}` : '';
  };
  update();
  return { el, update };
}

/** Buttons for USB, Bluetooth and the simulator, or the connection and "Koppla från" when connected. */
export function connectionCard(app: App): { el: HTMLElement; cleanup: Cleanup } {
  const error = h('p', { class: 'error', hidden: true });
  const usbSupported = UsbPm5Source.isSupported();
  const bleSupported = Pm5Source.isSupported();
  const connectUsb = h('button', { class: 'blue', disabled: !usbSupported }, icon('usb'), 'Anslut PM5 via USB');
  const connectBle = h('button', { class: 'secondary', disabled: !bleSupported }, icon('bluetooth'), 'Anslut via Bluetooth');
  const useSim = h('button', { class: 'secondary' }, icon('chip'), 'Använd simulator');
  const showAll = h('button', { class: 'link' }, 'Hittar du inte PM5 via Bluetooth? Visa alla enheter');
  const disconnect = h('button', { class: 'secondary' }, 'Koppla från');
  const status = h('p', { class: 'hint' });

  const speed = h(
    'select',
    {},
    ...([1, 5, 20] as const).map((s) => h('option', { value: String(s), selected: app.sim.speed === s }, `${s}×`)),
  );
  const modes: [SimMode, string][] = [
    ['followTarget', 'Jämn effekt'],
    ['manual', 'Manuell (piltangenter)'],
    ['fatigue', 'Trötthet (sann signatur 550/220/18 000)'],
  ];
  const mode = h('select', {}, ...modes.map(([value, label]) => h('option', { value, selected: app.sim.mode === value }, label)));
  const simDrag = h('input', { type: 'number', min: '50', max: '250', step: '1', value: String(app.sim.dragFactor), class: 'narrow' });
  const remember = (): void => {
    app.sim = { speed: Number(speed.value) as SimSpeed, mode: mode.value as SimMode, dragFactor: Number(simDrag.value) || DEFAULT_DRAG_FACTOR };
  };
  [speed, mode, simDrag].forEach((el) => el.addEventListener('change', remember));

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
    remember();
    const clock = new SimClock(app.sim.speed);
    await app.useSource(
      new Simulator(clock, { mode: app.sim.mode, dragFactor: app.sim.dragFactor, target: () => app.target(), maxEffort: () => app.maxEffort() }),
      clock,
    );
  });
  disconnect.addEventListener('click', () => void app.disconnect());

  const buttons = h('div', { class: 'connect-buttons' }, connectUsb, connectBle, useSim);
  const simOptions = h(
    'details',
    {},
    h('summary', {}, 'Simulator'),
    h('div', { class: 'row small' }, h('label', {}, 'Hastighet ', speed), h('label', {}, 'Läge ', mode), h('label', {}, 'Dragfaktor ', simDrag)),
  );
  const help = h('p', { class: 'hint small' }, 'En PM5 som sitter i USB ansluts automatiskt när du har valt den en gång.');
  const unsupported = !usbSupported && !bleSupported && h('p', { class: 'hint' }, 'Varken WebHID eller Web Bluetooth stöds här. Använd Chrome eller Edge.');

  const update = (): void => {
    const connected = app.connection !== 'disconnected';
    buttons.hidden = connected;
    showAll.hidden = connected || !bleSupported;
    simOptions.hidden = connected;
    help.hidden = connected;
    disconnect.hidden = !connected;
    status.hidden = !connected;
    status.textContent = app.pm5
      ? `${connectionLabel(app)} via ${app.pm5.transport === 'usb' ? 'USB' : 'Bluetooth'}.`
      : `${connectionLabel(app)} (${app.sim.speed}×).`;
  };
  const off = app.sourceChanged.on(update);
  update();

  const el = h('section', { class: 'card' }, h('h2', {}, 'Anslutning'), status, buttons, showAll, simOptions, help, unsupported, h('div', {}, disconnect), error);
  return { el, cleanup: off };
}
