// Live view (spec §8.2): canvas chart (~70 %) and side panel.
import { wbalZone } from '../../model/wbal';
import { LiveSession } from '../../session/live';
import { dragFactorDiffers, previousTest } from '../../session/testResults';
import type { TestResult } from '../../storage/types';
import { MANUAL_STEP_W } from '../../sources/simulator';
import { expand, highestTarget } from '../../workout/expand';
import { heartRateShare, isPlanned } from '../../workout/plan';
import { isStructured, maxEffortDuration } from '../../workout/schema';
import { calibrationOptions, wbalOptions } from '../../storage/settings';
import { calibrate } from '../../workout/calibrate';
import { beepsDue } from '../../workout/runner';
import type { View } from '../app';
import { h } from '../dom';
import { formatDuration, formatPower } from '../format';
import { LiveChart, yMaxFor } from '../live/canvas';

/** [FÖRSLAG] How long into a planned workout a drag factor unlike the plan's is pointed out, s. */
const PLAN_DRAG_CHECK_S = 180;

export const liveView: View = (root, app) => {
  const source = app.source;
  const clock = app.clock;
  if (!source || !clock) {
    app.navigate('start');
    return () => {};
  }
  const workout = app.workout;
  // An unstructured planned workout has no timeline and runs like free ride with its description.
  const structured = workout !== null && isStructured(workout);
  const isTest = structured && maxEffortDuration(workout) !== null;
  const planned = isPlanned(workout) ? workout : null;
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
  // Before the maximal effort: a drag factor unlike the last test of the same length (spec §7.3).
  const dragBanner = h('p', { class: 'banner', hidden: true });

  const segBlock = h('div', { class: 'seg-block', hidden: true });
  const segLabel = h('div', { class: 'seg-label' }, workout ? (structured ? '' : workout.name) : 'Fri åkning');
  const segLeft = h('div', { class: 'seg-left' }, '–');
  // The segment's description from the plan, or the workout's before the start and without a timeline.
  const segDesc = h('div', { class: 'seg-desc', hidden: true });
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
  const hrShare = h('div', { class: 'hint small' });
  heartRate.el.append(hrShare);
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
      h('div', { class: 'live-main' }, canvas, countdown, maxOverlay, fps, h('div', { class: 'banners' }, banner, pausedBanner, dragBanner)),
      h(
        'aside',
        { class: 'live-side' },
        h('div', { class: 'segment' }, segBlock, segLabel, segLeft, segDesc, segNext),
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
  let previous: TestResult | undefined;

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
    // Drag factor: against the last test of the same length before a maximal effort (spec §7.3),
    // else against the plan's during the first minutes, while there is time to set the damper.
    const df = l.dragFactor();
    const refDf = previous?.dragFactor ?? planned?.athlete?.dragFactor;
    const beforeMain = isTest ? l.maxEffortAverage() === null : t < PLAN_DRAG_CHECK_S;
    dragBanner.hidden = !(refDf !== undefined && df !== null && beforeMain && dragFactorDiffers(df, refDf));
    if (!dragBanner.hidden) {
      dragBanner.textContent =
        previous?.dragFactor !== undefined
          ? `Dragfaktor ${df} – förra testet gjordes med ${refDf}. Ställ dämparen så att den blir densamma.`
          : `Dragfaktor ${df} – planen är skriven för ${refDf}. Ställ dämparen så att den blir densamma.`;
    }
    pauseBtn.textContent = runner.state === 'paused' ? 'Fortsätt' : 'Paus';
    pauseBtn.disabled = runner.state !== 'running' && runner.state !== 'paused';

    // Segment and beeps (spec §6.3)
    const cur = runner.current();
    // Before the start (and without a timeline) the workout's description, then the segment's.
    const description = runner.state === 'countdown' || !cur ? (workout?.description ?? cur?.segment.description) : cur.segment.description;
    segDesc.hidden = !description;
    segDesc.textContent = description ?? '';
    segBlock.hidden = !cur?.segment.block;
    segBlock.textContent = cur?.segment.block ?? '';
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
    if (hr !== null) {
      heartRate.value.textContent = String(hr);
      const share = heartRateShare(hr, planned?.athlete);
      hrShare.textContent = share ? `${Math.round(share.fraction * 100)} % av ${share.of === 'threshold' ? 'tröskelpuls' : 'maxpuls'}` : '';
    }
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
    const maxDuration = workout ? maxEffortDuration(workout) : null;
    if (maxDuration !== null) previous = previousTest(await app.store.listTestResults(app.machine()), maxDuration, source.kind === 'simulator');
    let timeline = workout && structured ? expand(workout, signature, settings.tolerance) : null;
    // Fit the intensity so the planned W′ lands on the minimum in settings or the plan (not for tests).
    if (timeline && signature && !isTest) timeline = calibrate(timeline, signature, calibrationOptions(settings, planned?.calibration)).timeline;
    live = new LiveSession(source, clock, app.store, {
      mode: isTest ? 'test' : structured ? 'workout' : 'free',
      machine: app.machine(),
      powerAvgStrokes: settings.powerAvgStrokes,
      wbal: wbalOptions(settings),
      ...(workout && { workoutId: workout.id }),
      ...(planned && { planned }),
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
