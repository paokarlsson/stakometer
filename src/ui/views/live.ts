// Live view (spec §8.2): canvas chart (~70 %) and side panel.
import { wbalZone } from '../../model/wbal';
import { LiveSession } from '../../session/live';
import { MANUAL_STEP_W } from '../../sources/simulator';
import { expand, highestTarget } from '../../workout/expand';
import { maxEffortDuration } from '../../workout/schema';
import { calibrationOptions, wbalOptions } from '../../storage/settings';
import { calibrate } from '../../workout/calibrate';
import { beepsDue } from '../../workout/runner';
import type { View } from '../app';
import { h } from '../dom';
import { formatDuration, formatPower } from '../format';
import { LiveChart, yMaxFor } from '../live/canvas';

export const liveView: View = (root, app) => {
  const source = app.source;
  const clock = app.clock;
  if (!source || !clock) {
    app.navigate('start');
    return () => {};
  }
  const workout = app.workout;
  const isTest = workout !== null && maxEffortDuration(workout) !== null;
  const settings = app.settings;

  // --- DOM ---
  const canvas = h('canvas', { class: 'chart', role: 'img', 'aria-label': 'Effekt, målband och MPA över tid' });
  const countdown = h('div', { class: 'countdown', hidden: true });
  // Test mode (spec §7.2): large "MAX", time left and the running average instead of a band.
  const maxLeft = h('div', { class: 'max-left' });
  const maxAvg = h('div', { class: 'max-avg' });
  const maxOverlay = h('div', { class: 'max-overlay', hidden: true }, h('div', { class: 'max-word' }, 'MAX'), maxLeft, maxAvg);
  const banner = h('p', { class: 'banner', hidden: true }, 'Återansluter till PM5 – passet fortsätter');
  const pausedBanner = h('p', { class: 'banner', hidden: true }, 'Pausat – tidslinjen står still');

  const segLabel = h('div', { class: 'seg-label' }, workout ? '' : 'Fri åkning');
  const segLeft = h('div', { class: 'seg-left' }, '–');
  const segNext = h('div', { class: 'hint' });

  const batteryFill = h('div', { class: 'battery-fill' });
  const batteryText = h('div', { class: 'battery-text' }, '–');
  const batteryNote = h('div', { class: 'battery-note' });
  const battery = h('div', { class: 'battery-wrap' }, h('div', { class: 'battery' }, batteryFill), h('div', {}, batteryText, batteryNote));

  const metric = (label: string, big = false) => {
    const value = h('div', { class: 'value' }, '–');
    return { el: h('div', { class: big ? 'metric big' : 'metric' }, h('div', { class: 'label' }, label), value), value };
  };
  const power = metric(`Effekt (${settings.powerAvgStrokes} drag)`, true);
  const rate = metric('Dragtakt');
  const heartRate = metric('Puls');
  const mpaMetric = metric('MPA');
  const empty = metric('Tid till tomt W′');
  const elapsed = metric('Tid');
  heartRate.el.hidden = true;
  empty.el.hidden = true;

  const pauseBtn = h('button', { class: 'secondary' }, 'Paus');
  const stopBtn = h('button', { class: 'danger' }, 'Avsluta');
  const fullscreenBtn = h('button', { class: 'secondary' }, 'Helskärm');
  const sim = app.simulator;
  const simInfo = h('p', { class: 'hint small', hidden: !sim });
  // Frame rate check for the 30 fps criterion (spec §12 step 2); shown in debug mode.
  const fps = h('div', { class: 'fps', hidden: !app.debugLogging });
  let fpsFrames = 0;
  let fpsSince = performance.now();

  root.append(
    h(
      'div',
      { class: 'live' },
      h('div', { class: 'live-main' }, canvas, countdown, maxOverlay, fps, h('div', { class: 'banners' }, banner, pausedBanner)),
      h(
        'aside',
        { class: 'live-side' },
        h('div', { class: 'segment' }, segLabel, segLeft, segNext),
        battery,
        h('div', { class: 'side-metrics' }, power.el, rate.el, heartRate.el, mpaMetric.el, empty.el, elapsed.el),
        h('div', { class: 'row' }, pauseBtn, stopBtn, fullscreenBtn),
        simInfo,
      ),
    ),
  );

  // --- Session ---
  let live: LiveSession | null = null;
  let chart: LiveChart | null = null;
  let frame = 0;
  let stopping = false;
  let prevRemaining: number | null = null;
  let prevCountdown: number | null = null;
  let prevIndex = -1;
  let wakeLock: WakeLockSentinel | null = null;

  const stop = async (): Promise<void> => {
    if (!live || stopping) return;
    stopping = true;
    const session = await live.stop();
    await app.completeSession(session);
    app.sessionId = session.id;
    app.navigate('session');
  };

  const render = (): void => {
    const l = live;
    if (!l || !chart) return;
    l.tick();
    const runner = l.runner;
    chart.draw(l);
    fpsFrames++;
    const nowMs = performance.now();
    if (nowMs - fpsSince >= 1000) {
      fps.textContent = `${Math.round((fpsFrames * 1000) / (nowMs - fpsSince))} fps`;
      fpsFrames = 0;
      fpsSince = nowMs;
    }

    const t = l.sessionTime();
    countdown.hidden = runner.state !== 'countdown';
    countdown.textContent = String(Math.ceil(-t));
    // Beeps in the last three seconds before the start, like before a segment change.
    if (runner.state === 'countdown') {
      if (prevCountdown !== null && beepsDue(prevCountdown, -t) > 0) app.beeper.beep();
      prevCountdown = -t;
    }
    const inMax = runner.state !== 'finished' && runner.current()?.segment.isMax === true;
    maxOverlay.hidden = !inMax;
    if (inMax) {
      maxLeft.textContent = formatDuration(Math.ceil(runner.current()!.remaining));
      const avg = l.maxEffortAverage();
      maxAvg.textContent = avg === null ? '–' : `snitt ${Math.round(avg)} W`;
    }
    pausedBanner.hidden = runner.state !== 'paused';
    pauseBtn.textContent = runner.state === 'paused' ? 'Fortsätt' : 'Paus';
    pauseBtn.disabled = runner.state !== 'running' && runner.state !== 'paused';

    // Segment and beeps (spec §6.3)
    const cur = runner.current();
    if (cur) {
      segLabel.textContent = cur.segment.label;
      segLeft.textContent = formatDuration(Math.ceil(cur.remaining));
      segNext.textContent = cur.next
        ? `Nästa: ${cur.next.label} ${formatDuration(cur.next.end - cur.next.start)}${cur.next.targetW !== null ? ` · ${Math.round(cur.next.targetW)} W` : ''}`
        : 'Sista segmentet';
      if (runner.state === 'running' && cur.index === prevIndex && prevRemaining !== null && cur.next && beepsDue(prevRemaining, cur.remaining) > 0) {
        app.beeper.beep();
      }
      prevIndex = cur.index;
      prevRemaining = cur.remaining;
    } else if (workout) {
      segLabel.textContent = workout.name;
      segLeft.textContent = '–';
    }

    // W′ battery (spec §5.7)
    const frac = l.wbalFraction();
    battery.hidden = frac === null;
    if (frac !== null) {
      const zone = wbalZone(frac, settings.zones);
      batteryFill.style.height = `${Math.min(Math.max(frac, 0), 1) * 100}%`;
      battery.dataset.zone = zone;
      batteryText.textContent = `${Math.round(Math.max(frac, 0) * 100)} %`;
      // No W′ warnings in test mode (spec §5.7, §7.2).
      batteryNote.textContent = frac < 0 ? 'över modellen' : zone === 'red' && !isTest ? 'Avsluta intervallet' : 'W′';
      battery.dataset.warn = String(!isTest);
    }

    const p = l.currentPowerAvg();
    power.value.textContent = formatPower(p);
    const sr = l.strokeRate();
    rate.value.textContent = sr ? String(Math.round(sr)) : '–';
    const hr = l.heartRate();
    heartRate.el.hidden = hr === null;
    if (hr !== null) heartRate.value.textContent = String(hr);
    const m = l.mpa();
    mpaMetric.el.hidden = m === null;
    if (m !== null) mpaMetric.value.textContent = formatPower(m);
    const tte = l.timeToEmpty();
    empty.el.hidden = tte === null;
    if (tte !== null) empty.value.textContent = formatDuration(tte);
    const total = runner.duration;
    const tl = Math.max(0, runner.timelineTime());
    elapsed.value.textContent = total !== null ? `${formatDuration(tl)} / ${formatDuration(total)}` : formatDuration(Math.max(0, t));

    if (sim) {
      simInfo.textContent =
        sim.mode === 'manual'
          ? `Simulator: ${sim.power} W ${sim.isPulling ? '' : '(står still) '}– ↑/↓ ±${MANUAL_STEP_W} W, mellanslag startar/stoppar`
          : `Simulator: följer målet (${sim.power} W)`;
    }

    if (runner.state === 'finished') {
      void stop();
      return;
    }
    frame = requestAnimationFrame(render);
  };

  // --- Controls ---
  pauseBtn.addEventListener('click', () => {
    if (!live) return;
    if (live.runner.state === 'paused') live.runner.resume();
    else live.runner.pause();
  });
  stopBtn.addEventListener('click', () => {
    const r = live?.runner;
    if (r && r.timeline && !r.isComplete && !confirm('Avsluta passet i förtid? Det sparas som avbrutet.')) return;
    void stop();
  });
  fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  });

  const onKey = (e: KeyboardEvent): void => {
    if (!sim || sim.mode !== 'manual') return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') sim.adjustPower(MANUAL_STEP_W);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') sim.adjustPower(-MANUAL_STEP_W);
    else if (e.key === ' ') sim.setPulling(!sim.isPulling);
    else return;
    e.preventDefault();
  };

  // Screen Wake Lock during the session (spec §8); re-acquired when the page is visible again.
  const lockScreen = async (): Promise<void> => {
    try {
      wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      wakeLock = null;
    }
  };
  // Best effort on reload/close; the 30 s chunks are the guarantee.
  const onHide = (): void => void live?.recorder.flush();
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') onHide();
    else void lockScreen();
  };
  const offConnection = source.onConnection((c) => (banner.hidden = c !== 'reconnecting'));
  window.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibility);

  void (async () => {
    const signature = await app.activeSignature();
    let timeline = workout ? expand(workout, signature, settings.tolerance) : null;
    // Fit the intensity so the planned W′ lands on the minimum in settings (not for tests).
    if (timeline && signature && !isTest) timeline = calibrate(timeline, signature, calibrationOptions(settings)).timeline;
    live = new LiveSession(source, clock, app.store, {
      mode: isTest ? 'test' : workout ? 'workout' : 'free',
      machine: app.machine(),
      powerAvgStrokes: settings.powerAvgStrokes,
      wbal: wbalOptions(settings),
      ...(workout && { workoutId: workout.id }),
      timeline,
      signature,
    });
    const session = live;
    app.target = () => session.runner.target();
    app.maxEffort = () => session.maxEffortDuration();
    chart = new LiveChart(canvas, yMaxFor(timeline ? highestTarget(timeline) : null, signature?.cp ?? null));
    await live.start();
    void lockScreen();
    frame = requestAnimationFrame(render);
  })();

  return () => {
    cancelAnimationFrame(frame);
    chart?.dispose();
    offConnection();
    app.target = () => null;
    app.maxEffort = () => null;
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVisibility);
    void wakeLock?.release().catch(() => {});
    if (live && !stopping) void live.stop();
  };
};
