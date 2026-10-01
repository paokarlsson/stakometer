import type { RawLogEntry } from '../sources/rawlog';
import type { App, Cleanup } from './app';
import { downloadJson } from './components';
import { h } from './dom';

const SHOWN_LINES = 40;

/** Raw hex next to the parsed strokes (spec §12 step 0, §8.5 debug mode). */
function formatLine(e: RawLogEntry): string | null {
  const t = e.ts.toFixed(2).padStart(8);
  if (e.kind === 'raw') return `${t}  ${e.char.padEnd(5)} ${e.hex}`;
  if (e.kind === 'stroke') return `${t}  → drag #${e.strokeCount}: ${e.power} W, ${e.strokeRate}/min, ${e.distance.toFixed(1)} m`;
  return null; // statuses arrive 4–10 times per second; they are in the file but not shown
}

export function debugPanel(app: App): { el: HTMLElement; cleanup: Cleanup } {
  const toggle = h('input', { type: 'checkbox', checked: app.debugLogging });
  const count = h('span', { class: 'hint' });
  const pre = h('pre', { class: 'log' });
  const download = h('button', { class: 'secondary' }, 'Ladda ned logg (JSON)');
  const clear = h('button', { class: 'secondary' }, 'Rensa');
  let frame = 0;

  const render = (): void => {
    frame = 0;
    const log = app.rawLog.entries;
    count.textContent = `${log.length} rader`;
    const lines: string[] = [];
    for (let i = log.length - 1; i >= 0 && lines.length < SHOWN_LINES; i--) {
      const line = formatLine(log[i]!);
      if (line) lines.push(line);
    }
    pre.textContent = lines.reverse().join('\n');
    pre.hidden = lines.length === 0;
    download.disabled = log.length === 0;
  };
  const schedule = (): void => {
    frame ||= requestAnimationFrame(render);
  };

  toggle.addEventListener('change', () => app.setDebugLogging(toggle.checked));
  clear.addEventListener('click', () => {
    app.rawLog.clear();
    render();
  });
  download.addEventListener('click', () => {
    const file = app.rawLog.toFile();
    downloadJson(file, `skierg-rawlog-${file.recordedAt.replace(/[:.]/g, '-')}.json`);
  });
  const off = app.rawLog.added.on(schedule);

  const el = h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Felsökning'),
    h('label', { class: 'choice' }, toggle, ' Logga rådata från PM5'),
    h(
      'p',
      { class: 'hint small' },
      'Slå på, anslut PM5 och åk minst 20 drag. Loggen följer med genom passet. Ladda sedan ned den och lägg filen i tests/fixtures/.',
    ),
    h('div', { class: 'row' }, download, clear, count),
    pre,
  );
  render();
  return {
    el,
    cleanup: () => {
      off();
      cancelAnimationFrame(frame);
    },
  };
}
