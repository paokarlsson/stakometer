import { RealClock, SimClock, type SimSpeed } from '../../core/clock';
import { Pm5Source } from '../../sources/pm5/ble';
import { UsbPm5Source } from '../../sources/pm5/usb';
import { Simulator, type SimMode } from '../../sources/simulator';
import type { View } from '../app';
import { debugPanel } from '../debugPanel';
import { h } from '../dom';

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
    await app.useSource(new Simulator(clock, { mode: mode.value as SimMode }), clock);
  });

  disconnect.addEventListener('click', () => void app.disconnect());
  start.addEventListener('click', () => app.navigate('live'));

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
    h('section', { class: 'card' }, h('h2', {}, 'Signatur'), h('p', { class: 'hint' }, 'Signatur saknas – gör test eller mata in')),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Pass'),
      h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'workout', value: 'free', checked: true }), ' Fri åkning'),
      start,
    ),
    h('nav', {}, h('button', { class: 'link', onclick: () => app.navigate('history') }, 'Historik')),
    debug.el,
  );
  update();
  return () => {
    off();
    debug.cleanup();
  };
};
