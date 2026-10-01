// Live view (spec §8.2): header with the workout's parts, the rolling chart (~70 %) with totals
// below it, and a side panel with the W′ gauge and the current values. Overlays for the
// countdown, the pause and the seconds before a hard segment; a screen of its own for the
// maximal effort of a test (§7.2).
import { wbalZone } from '../../model/wbal';
import { LiveSession } from '../../session/live';
import { dragFactorDiffers, previousTest } from '../../session/testResults';
import type { TestResult } from '../../storage/types';
import { MANUAL_STEP_W } from '../../sources/simulator';
import { expand, highestTarget } from '../../workout/expand';
import { heartRateShare, isPlanned } from '../../workout/plan';
import { isStructured, maxEffortDuration, type TimelineSegment } from '../../workout/schema';
import { calibrationOptions, wbalOptions } from '../../storage/settings';
import { calibrate } from '../../workout/calibrate';
import { beepsDue } from '../../workout/runner';
import type { View } from '../app';
import { iconButton, stat, wallClock } from '../components';
import { h } from '../dom';
import { formatDistance, formatDuration, formatPower, testName } from '../format';
import { icon } from '../icons';
import { LiveChart, yMaxFor } from '../live/canvas';
import { wbalGauge } from '../live/gauge';
import { MaxChart } from '../live/maxChart';
import { workoutStrip } from '../strip';

/** [FÖRSLAG] How long into a planned workout a drag factor unlike the plan's is pointed out, s. */
const PLAN_DRAG_CHECK_S = 180;
/** [FÖRSLAG] Seconds before a hard segment that the get-ready card is shown. */
const PREPARE_S = 10;

/** Sets text only when it changed; the view updates every frame. */
const setText = (el: HTMLElement, text: string): void => {
  if (el.textContent !== text) el.textContent = text;
};

/** A value with a smaller note after it, e.g. "162 86 %". */
const setWithNote = (el: HTMLElement, main: string, note?: string): void => {
  const key = `${main}|${note ?? ''}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.replaceChildren(main, ...(note ? [h('small', {}, note)] : []));
};

const legendKey = (swatch: string, label: string) => h('span', { class: 'key' }, h('span', { class: `swatch ${swatch}` }), label);

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
  const maxLength = workout ? maxEffortDuration(workout) : null;
  const isTest = structured && maxLength !== null;
  const planned = isPlanned(workout) ? workout : null;
  const settings = app.settings;
  const sim = app.simulator;

  // --- Header ---
  const connDot = h('span', { class: 'conn-dot', title: 'Anslutning' });
  const subtitle = h('div', { class: 'live-sub' }, structured ? '' : workout ? 'Fri åkning med passets beskrivning' : 'Ingen tidslinje – åk tills du stoppar');
  const soundBtn = iconButton('sound', 'Ljud', () => {
    app.beeper.muted = !app.beeper.muted;
    soundBtn.replaceChildren(icon(app.beeper.muted ? 'mute' : 'sound'));
  });
  soundBtn.replaceChildren(icon(app.beeper.muted ? 'mute' : 'sound'));
  const pauseBtn = iconButton('pause', 'Paus', () => togglePause());
  const fullscreenBtn = iconButton('fullscreen', 'Helskärm', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  });
  const stopBtn = iconButton('stop', 'Avsluta passet', () => requestStop(), 'icon-btn danger');
  const description = h('p', { class: 'live-desc', hidden: true });

  // --- Chart ---
  const canvas = h('canvas', { class: 'chart', role: 'img', 'aria-label': 'Effekt, målband och MPA över tid' });
  const legend = h('div', { class: 'legend' }, h('span', { class: 'axis' }, 'Effekt (W)'), legendKey('power', `Effekt (${settings.powerAvgStrokes} drag)`));
  const banner = h('p', { class: 'banner', hidden: true }, 'Återansluter till PM5 – passet fortsätter');
  // Before the maximal effort: a drag factor unlike the last test of the same length (spec §7.3).
  const dragBanner = h('p', { class: 'banner', hidden: true });
  const fps = h('div', { class: 'fps', hidden: !app.debugLogging });
  let fpsFrames = 0;
  let fpsSince = performance.now();

  const countdownNumber = h('div', { class: 'overlay-big' });
  const countdownFirst = h('div', { class: 'overlay-text' });
  const countdown = h('div', { class: 'overlay countdown-overlay', hidden: true }, h('div', {}, h('div', { class: 'overlay-text' }, 'Passet startar om'), countdownNumber, countdownFirst));

  // The seconds before a hard segment (spec §6.3): what comes, and when.
  const prepareTitle = h('div', { class: 'prepare-title' });
  const prepareNext = h('div', { class: 'prepare-next' });
  const prepareTarget = h('div', { class: 'prepare-next' });
  const prepareBar = h('div', {});
  const prepareSound = iconButton('sound', 'Ljud', () => soundBtn.click());
  const prepareLeft = h('div', { class: 'prepare-left' });
  const prepare = h(
    'div',
    { class: 'prepare', hidden: true },
    prepareTitle,
    prepareNext,
    prepareTarget,
    h('div', { class: 'prepare-row' }, h('div', { class: 'progress' }, prepareBar), prepareSound),
    prepareLeft,
  );

  const chartCard = h('div', { class: 'chart-card' }, legend, canvas, h('div', { class: 'banners' }, banner, dragBanner), countdown, prepare, fps);

  // --- Totals below the chart ---
  const elapsed = stat('Tid');
  const distance = stat('Distans');
  const avgPower = stat('Medeleffekt');
  const work = stat('Arbete');

  // --- Side panel ---
  const gauge = wbalGauge([settings.zones.orange, settings.zones.yellow, settings.zones.green]);
  const power = stat('Effekt (W)', '–', 'stat power');
  const rate = stat('Dragtakt (drag/min)');
  const heartRate = stat('Puls (slag/min)');
  const segLeft = stat('Tid kvar');
  const empty = stat('Tid till tomt (est)');
  const next = stat('Nästa segment', '–', 'stat next');
  heartRate.el.hidden = true;
  segLeft.el.hidden = !structured;
  next.el.hidden = !structured;
  const simInfo = h('p', { class: 'hint small sim-info', hidden: !sim });

  // --- Pause ---
  const pauseClock = h('div', { class: 'overlay-big' });
  const resumeBtn = h('button', {}, icon('play'), 'Fortsätt');
  const pauseStopBtn = h('button', { class: 'secondary' }, icon('stop'), 'Avsluta pass');
  resumeBtn.addEventListener('click', () => togglePause());
  pauseStopBtn.addEventListener('click', () => requestStop());
  const pauseOverlay = h(
    'div',
    { class: 'overlay', hidden: true },
    h(
      'div',
      { class: 'overlay-card' },
      h('div', { class: 'overlay-head' }, h('h2', {}, 'Paus'), wallClock()),
      h('p', { class: 'overlay-text' }, 'Passet är pausat. Tidslinjen är frusen men W′-balansen räknar vidare.'),
      pauseClock,
      h('div', { class: 'overlay-buttons' }, resumeBtn, pauseStopBtn),
    ),
  );

  // --- Maximal effort (spec §7.2): large "MAX", time left and the running average ---
  const maxCanvas = h('canvas', { class: 'chart', role: 'img', 'aria-label': 'Effekt under maxinsatsen' });
  const maxLeft = stat('Kvar', '–', 'stat left');
  const maxAvg = stat('Medeleffekt (W)', '–', 'stat avg');
  const maxNow = stat('Aktuell effekt (W)');
  const maxRate = stat('Dragtakt');
  const maxBanner = h('p', { class: 'banner', hidden: true }, 'Återansluter till PM5 – testet fortsätter');
  const abortBtn = h('button', { class: 'danger solid big wide' }, 'Avbryt test');
  abortBtn.addEventListener('click', () => requestStop());
  const maxLegend = h('div', { class: 'legend' }, h('span', { class: 'axis' }, 'Effekt (W)'), legendKey('dot', 'Effekt'), legendKey('avg', 'Snitt'));
  const maxScreen = h(
    'div',
    { class: 'max-screen', hidden: true },
    h('div', { class: 'live-head' }, h('div', { class: 'titles' }, h('h1', {}, `${maxLength !== null ? testName(maxLength) : ''} maxtest`)), wallClock()),
    maxBanner,
    h('div', { class: 'max-word' }, 'MAX'),
    h(
      'div',
      { class: 'max-body' },
      h('div', { class: 'max-stats' }, maxLeft.el, maxAvg.el, maxNow.el, maxRate.el),
      h('div', { class: 'chart-card' }, maxLegend, maxCanvas),
    ),
    abortBtn,
  );

  root.append(
    h(
      'div',
      { class: 'live' },
      h(
        'div',
        { class: 'live-main' },
        h(
          'div',
          { class: 'live-head' },
          connDot,
          h('div', { class: 'titles' }, h('h1', {}, workout?.name ?? 'Fri åkning'), subtitle),
          h('div', { class: 'controls' }, soundBtn, pauseBtn, fullscreenBtn, stopBtn),
          wallClock(),
        ),
        // The strip is added once the timeline exists.
        description,
        chartCard,
        h('div', { class: 'live-stats' }, elapsed.el, distance.el, avgPower.el, work.el),
      ),
      h('aside', { class: 'live-side' }, gauge.el, h('div', { class: 'side-tiles' }, power.el, rate.el, heartRate.el, segLeft.el, empty.el, next.el), simInfo),
      pauseOverlay,
      maxScreen,
    ),
  );

  // --- Session ---
  let live: LiveSession | null = null;
  let chart: LiveChart | null = null;
  let maxChart: MaxChart | null = null;
  let strip: ReturnType<typeof workoutStrip> | null = null;
  let frame = 0;
  let stopping = false;
  let prevRemaining: number | null = null;
  let prevCountdown: number | null = null;
  let prevIndex = -1;
  let pausedAt: number | null = null;
  let wakeLock: WakeLockSentinel | null = null;
  let previous: TestResult | undefined;

  const stop = async (): Promise<void> => {
    if (!live || stopping) return;
    stopping = true;
    const session = await live.stop();
    await app.completeSession(session);
    app.sessionId = session.id;
    app.sessionBack = 'start';
    app.navigate('session');
  };
  function requestStop(): void {
    const r = live?.runner;
    if (r && r.timeline && !r.isComplete && !confirm('Avsluta passet i förtid? Det sparas som avbrutet.')) return;
    void stop();
  }
  function togglePause(): void {
    if (!live) return;
    if (live.runner.state === 'paused') live.runner.resume();
    else live.runner.pause();
  }

  /** A segment that takes W′ or effort to start well: an interval, the maximal effort, or work above CP. */
  const isHard = (s: TimelineSegment): boolean => s.isMax || s.kind === 'interval' || (s.targetW !== null && !!live?.signature && s.targetW > live.signature.cp);
  const targetText = (s: TimelineSegment): string => (s.isMax ? 'MAX' : s.targetW !== null ? `${Math.round(s.targetW)} W` : 'utan mål');

  const render = (): void => {
    const l = live;
    if (!l || !chart) return;
    l.tick();
    const runner = l.runner;
    const t = l.sessionTime();
    const cur = runner.current();
    const inMax = runner.state !== 'finished' && cur?.segment.isMax === true;

    maxScreen.hidden = !inMax;
    if (inMax) renderMax(l, cur.segment, cur.remaining);
    else chart.draw(l);
    strip?.update(runner.state === 'countdown' ? null : runner.timelineTime());

    fpsFrames++;
    const nowMs = performance.now();
    if (nowMs - fpsSince >= 1000) {
      fps.textContent = `${Math.round((fpsFrames * 1000) / (nowMs - fpsSince))} fps`;
      fpsFrames = 0;
      fpsSince = nowMs;
    }

    // Countdown, with beeps in the last three seconds like before a segment change.
    countdown.hidden = runner.state !== 'countdown';
    if (runner.state === 'countdown') {
      setText(countdownNumber, String(Math.ceil(-t)));
      const first = runner.timeline?.[0];
      setText(countdownFirst, first ? `Först: ${first.label} ${formatDuration(first.end - first.start)} · ${targetText(first)}` : 'Fri åkning');
      if (prevCountdown !== null && beepsDue(prevCountdown, -t) > 0) app.beeper.beep();
      prevCountdown = -t;
    }

    // Pause
    if (runner.state === 'paused') pausedAt ??= t;
    else pausedAt = null;
    pauseOverlay.hidden = pausedAt === null;
    if (pausedAt !== null) setText(pauseClock, formatDuration(t - pausedAt));
    const pauseIcon = runner.state === 'paused' ? 'play' : 'pause';
    if (pauseBtn.dataset.icon !== pauseIcon) {
      pauseBtn.dataset.icon = pauseIcon;
      pauseBtn.replaceChildren(icon(pauseIcon));
    }
    pauseBtn.disabled = runner.state !== 'running' && runner.state !== 'paused';
    const muted = String(app.beeper.muted);
    if (prepareSound.dataset.muted !== muted) {
      prepareSound.dataset.muted = muted;
      prepareSound.replaceChildren(icon(app.beeper.muted ? 'mute' : 'sound'));
    }

    // Drag factor: against the last test of the same length before a maximal effort (spec §7.3),
    // else against the plan's during the first minutes, while there is time to set the damper.
    const df = l.dragFactor();
    const refDf = previous?.dragFactor ?? planned?.athlete?.dragFactor;
    const beforeMain = isTest ? l.maxEffortAverage() === null : t < PLAN_DRAG_CHECK_S;
    dragBanner.hidden = !(refDf !== undefined && df !== null && beforeMain && dragFactorDiffers(df, refDf));
    if (!dragBanner.hidden) {
      setText(
        dragBanner,
        previous?.dragFactor !== undefined
          ? `Dragfaktor ${df} – förra testet gjordes med ${refDf}. Ställ dämparen så att den blir densamma.`
          : `Dragfaktor ${df} – planen är skriven för ${refDf}. Ställ dämparen så att den blir densamma.`,
      );
    }

    // Segment, description and beeps (spec §6.3)
    const desc = runner.state === 'countdown' || !cur ? (workout?.description ?? cur?.segment.description) : cur.segment.description;
    description.hidden = !desc;
    setText(description, desc ?? '');
    if (cur) {
      const seg = cur.segment;
      const length = seg.end - seg.start;
      setText(subtitle, runner.state === 'countdown' ? 'Nedräkning' : `${seg.block ? `${seg.block} · ` : ''}${seg.label} – ${formatDuration(length)}`);
      setText(segLeft.value, formatDuration(Math.ceil(cur.remaining)));
      setText(next.value, cur.next ? `${cur.next.label} ${formatDuration(cur.next.end - cur.next.start)} · ${targetText(cur.next)}` : 'Sista segmentet');
      if (runner.state === 'running' && cur.index === prevIndex && prevRemaining !== null && cur.next && beepsDue(prevRemaining, cur.remaining) > 0) {
        app.beeper.beep();
      }
      prevIndex = cur.index;
      prevRemaining = cur.remaining;

      const soon = runner.state === 'running' && cur.next !== null && cur.remaining <= PREPARE_S && length > PREPARE_S && isHard(cur.next) && !inMax;
      prepare.hidden = !soon;
      if (soon && cur.next) {
        setText(prepareTitle, `${seg.label} ${formatDuration(length)}`);
        setText(prepareNext, `Nästa: ${cur.next.label}`);
        setText(prepareTarget, `${formatDuration(cur.next.end - cur.next.start)} @ ${targetText(cur.next)}`);
        prepareBar.style.width = `${Math.min(100, ((length - cur.remaining) / length) * 100)}%`;
        setText(prepareLeft, formatDuration(Math.ceil(cur.remaining)));
      }
    }

    // W′ gauge (spec §5.7)
    const frac = l.wbalFraction();
    const sig = l.signature;
    if (frac === null || !sig || l.wbal === null) gauge.update(null);
    else {
      const zone = wbalZone(frac, settings.zones);
      // No W′ warnings in test mode (spec §5.7, §7.2).
      const note = frac < 0 ? 'Över modellen' : zone === 'red' && !isTest ? 'Avsluta intervallet' : `MPA ${formatPower(l.mpa())}`;
      gauge.update({ fraction: frac, wbal: l.wbal, wPrime: sig.wPrime, zone, note, warn: !isTest });
    }

    // Values
    const p = l.currentPowerAvg();
    setText(power.value, String(Math.round(p)));
    const sr = l.strokeRate();
    setText(rate.value, sr ? String(Math.round(sr)) : '–');
    const hr = l.heartRate();
    heartRate.el.hidden = hr === null;
    if (hr !== null) {
      const share = heartRateShare(hr, planned?.athlete);
      setWithNote(heartRate.value, String(hr), share ? `${Math.round(share.fraction * 100)} % av ${share.of === 'threshold' ? 'tröskel' : 'max'}` : undefined);
    }
    empty.el.hidden = !sig;
    const tte = l.timeToEmpty();
    setText(empty.value, tte === null ? '–' : formatDuration(tte));
    const total = runner.duration;
    const tl = Math.max(0, runner.timelineTime());
    if (total !== null) setWithNote(elapsed.value, formatDuration(tl), `/ ${formatDuration(total)}`);
    else setWithNote(elapsed.value, formatDuration(Math.max(0, t)));
    setText(distance.value, formatDistance(l.distance()));
    setText(avgPower.value, formatPower(l.avgPower()));
    setText(work.value, `${Math.round(l.workKJ())} kJ`);

    if (sim) {
      setText(
        simInfo,
        sim.mode === 'manual'
          ? `Simulator: ${sim.power} W ${sim.isPulling ? '' : '(står still) '}– ↑/↓ ±${MANUAL_STEP_W} W, mellanslag startar/stoppar`
          : `Simulator: följer målet (${sim.power} W)`,
      );
    }

    if (runner.state === 'finished') {
      void stop();
      return;
    }
    frame = requestAnimationFrame(render);
  };

  function renderMax(l: LiveSession, seg: TimelineSegment, remaining: number): void {
    maxChart ??= new MaxChart(maxCanvas);
    const avg = l.maxEffortAverage();
    maxChart.draw(l, seg, avg, previous?.avgPower ?? null);
    const length = seg.end - seg.start;
    setWithNote(maxLeft.value, formatDuration(Math.ceil(remaining)), `${formatDuration(Math.max(0, length - remaining))} / ${formatDuration(length)}`);
    setText(maxAvg.value, avg === null ? '–' : String(Math.round(avg)));
    setText(maxNow.value, String(Math.round(l.currentPowerAvg())));
    const sr = l.strokeRate();
    setText(maxRate.value, sr ? String(Math.round(sr)) : '–');
  }

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
  const showConnection = (): void => {
    connDot.dataset.state = app.connection;
    banner.hidden = app.connection !== 'reconnecting';
    maxBanner.hidden = banner.hidden;
  };
  const offConnection = source.onConnection(showConnection);
  showConnection();
  window.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibility);

  void (async () => {
    const signature = await app.activeSignature();
    if (maxLength !== null) previous = previousTest(await app.store.listTestResults(app.machine()), maxLength, source.kind === 'simulator');
    if (previous) maxLegend.append(legendKey('prev', `Förra testet (${Math.round(previous.avgPower)} W)`));
    let timeline = workout && structured ? expand(workout, signature, settings.tolerance) : null;
    // Fit the intensity so the planned W′ lands on the minimum in settings or the plan (not for tests).
    if (timeline && signature && !isTest) timeline = calibrate(timeline, signature, calibrationOptions(settings, planned?.calibration)).timeline;
    if (timeline) legend.append(legendKey('band', 'Målband'));
    if (signature) legend.append(legendKey('mpa', 'MPA'), legendKey('cp', 'CP'));
    if (workout && timeline) {
      strip = workoutStrip(workout, timeline);
      description.before(strip.el);
    }
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
    maxChart?.dispose();
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
