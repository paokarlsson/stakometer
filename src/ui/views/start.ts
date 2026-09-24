import { RealClock, SimClock, type SimSpeed } from '../../core/clock';
import { Pm5Source } from '../../sources/pm5/ble';
import { Simulator, type SimMode } from '../../sources/simulator';
import type { View } from '../app';
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
  const pm5Supported = Pm5Source.isSupported();
  const connectPm5 = h('button', { disabled: !pm5Supported }, 'Anslut PM5');
  const useSim = h('button', { class: 'secondary' }, 'Använd simulator');
  const disconnect = h('button', { class: 'secondary' }, 'Koppla från');
  const start = h('button', { class: 'primary big' }, 'Starta');

  const showError = (err: unknown): void => {
    // A cancelled device chooser is not an error worth showing.
    if (err instanceof DOMException && err.name === 'NotFoundError') return;
    error.textContent = err instanceof Error ? err.message : String(err);
    error.hidden = false;
  };

  connectPm5.addEventListener('click', async () => {
    error.hidden = true;
    const clock = new RealClock();
    try {
      await app.useSource(new Pm5Source(clock), clock);
    } catch (err) {
      showError(err);
    }
  });

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
      connected: app.pm5 ? `Ansluten till ${app.pm5.deviceName ?? 'PM5'}` : 'Simulator ansluten',
      reconnecting: 'Återansluter…',
      disconnected: 'Inte ansluten',
    };
    status.textContent = labels[app.connection];
    status.dataset.state = app.connection;
    connectPm5.hidden = connected;
    useSim.hidden = connected;
    disconnect.hidden = !connected;
    start.disabled = !connected;
  };
  const off = app.sourceChanged.on(update);

  root.append(
    h('h1', {}, 'SkiErg Training'),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Anslutning'),
      status,
      h('div', { class: 'row' }, connectPm5, useSim, disconnect),
      h('div', { class: 'row small' }, h('label', {}, 'Simulatorhastighet ', speed), h('label', {}, 'Simulatorläge ', mode)),
      !pm5Supported && h('p', { class: 'hint' }, 'Web Bluetooth stöds inte här. Använd Chrome eller Edge på dator eller Android.'),
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
  );
  update();
  return off;
};
