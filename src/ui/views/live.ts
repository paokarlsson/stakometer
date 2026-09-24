// Free ride with plain numbers. The canvas live view (spec §8.2) replaces this in step 2.
import { Recorder } from '../../session/recorder';
import type { StatusSample, StrokeSample } from '../../sources/DataSource';
import { MANUAL_STEP_W } from '../../sources/simulator';
import type { View } from '../app';
import { h } from '../dom';
import { formatDistance, formatDuration, formatPower } from '../format';

export const liveView: View = (root, app) => {
  const source = app.source;
  const clock = app.clock;
  if (!source || !clock) {
    app.navigate('start');
    return () => {};
  }

  const recorder = new Recorder(app.store, clock);
  let lastStroke: StrokeSample | null = null;
  let lastStatus: StatusSample | null = null;
  let firstDistance: number | null = null;
  let stopping = false;
  let frame = 0;

  const metric = (label: string) => {
    const value = h('div', { class: 'value' }, '–');
    return { el: h('div', { class: 'metric' }, h('div', { class: 'label' }, label), value), value };
  };
  const time = metric('Tid');
  const power = metric('Effekt');
  const rate = metric('Dragtakt');
  const distance = metric('Distans');
  const heartRate = metric('Puls');
  heartRate.el.hidden = true;
  const banner = h('p', { class: 'banner', hidden: true }, 'Återansluter till PM5 – passet fortsätter');
  const sim = app.simulator;
  const simInfo = h('p', { class: 'hint' });

  const offs = [
    source.onStroke((s) => (lastStroke = s)),
    source.onStatus((s) => {
      lastStatus = s;
      firstDistance ??= s.distance;
    }),
    source.onConnection((c) => (banner.hidden = c !== 'reconnecting')),
  ];

  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await recorder.stop('completed');
    app.navigate('history');
  };

  const onKey = (e: KeyboardEvent): void => {
    if (!sim || sim.mode !== 'manual') return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') sim.adjustPower(MANUAL_STEP_W);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') sim.adjustPower(-MANUAL_STEP_W);
    else if (e.key === ' ') sim.setPulling(!sim.isPulling);
    else return;
    e.preventDefault();
  };
  // Best effort on reload/close; the 30 s chunks are the guarantee.
  const onHide = (): void => void recorder.flush();
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') onHide();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibility);

  const render = (): void => {
    time.value.textContent = formatDuration(recorder.elapsed());
    power.value.textContent = formatPower(lastStroke?.power);
    rate.value.textContent = lastStatus?.strokeRate ? String(lastStatus.strokeRate) : '–';
    distance.value.textContent = lastStatus && firstDistance !== null ? formatDistance(lastStatus.distance - firstDistance) : '–';
    const hr = lastStatus?.heartRate;
    heartRate.el.hidden = hr === undefined;
    if (hr !== undefined) heartRate.value.textContent = String(hr);
    if (sim) {
      simInfo.textContent =
        sim.mode === 'manual'
          ? `Simulator: ${sim.power} W ${sim.isPulling ? '' : '(står still) '}– ↑/↓ ändrar ±${MANUAL_STEP_W} W, mellanslag startar/stoppar`
          : `Simulator: ${sim.power} W`;
    }
    frame = requestAnimationFrame(render);
  };

  root.append(
    h('h1', {}, 'Fri åkning'),
    banner,
    h('div', { class: 'metrics' }, time.el, power.el, rate.el, distance.el, heartRate.el),
    ...(sim ? [simInfo] : []),
    h('div', { class: 'row' }, h('button', { class: 'primary big', onclick: () => void stop() }, 'Avsluta')),
  );

  void recorder.start(source, { mode: 'free', machine: source.machine() ?? 'skierg' }).then(() => {
    frame = requestAnimationFrame(render);
  });

  return () => {
    cancelAnimationFrame(frame);
    for (const off of offs) off();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVisibility);
    if (recorder.active) void recorder.stop('aborted');
  };
};
