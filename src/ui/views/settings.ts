// Settings (spec §8.5): manual signature (§7.4), band and averaging, machine type,
// W′ zones and Skiba constants, and JSON backup (§11).
import { defaultPm5Signature, kOf, validateSignature, type FitnessSignature } from '../../model/signature';
import type { Machine } from '../../sources/DataSource';
import { exportBackup, importBackup, parseBackup } from '../../storage/backup';
import { validateSettings, type Settings } from '../../storage/settings';
import type { View } from '../app';
import { h } from '../dom';
import { formatDate } from '../format';

const MACHINE_LABEL: Record<Settings['machine'], string> = {
  auto: 'Automatisk (standard SkiErg)',
  skierg: 'SkiErg',
  rowerg: 'RowErg',
  bikeerg: 'BikeErg',
};

export const settingsView: View = (root, app) => {
  const numberInput = (value: number, step = 'any') => h('input', { type: 'number', step, value: String(value), inputmode: 'decimal' });
  const field = (label: string, input: HTMLElement, unit = '') => h('label', { class: 'field' }, h('span', {}, label), input, unit && h('span', { class: 'hint' }, unit));

  // --- Signature (§7.4) ---
  const machine: Machine = app.settings.machine === 'auto' ? 'skierg' : app.settings.machine;
  const current = h('p', { class: 'hint' }, 'Laddar…');
  const pp = numberInput(0, '1');
  const cp = numberInput(0, '1');
  const wPrime = numberInput(0, '100');
  const kText = h('span', { class: 'hint' });
  const sigError = h('p', { class: 'error', hidden: true });
  const sigSaved = h('p', { class: 'hint', hidden: true }, 'Signaturen är sparad och används från nästa pass.');
  const values = () => ({ pp: Number(pp.value), cp: Number(cp.value), wPrime: Number(wPrime.value) });
  const updateK = (): void => {
    const err = validateSignature(values());
    kText.textContent = err ? '' : `k = ${Math.round(kOf(values()))} s`;
  };
  [pp, cp, wPrime].forEach((i) => i.addEventListener('input', updateK));
  const saveSig = h('button', {}, 'Spara signatur');
  saveSig.addEventListener('click', async () => {
    const v = values();
    const err = validateSignature(v);
    sigError.hidden = err === null;
    sigSaved.hidden = true;
    if (err) {
      sigError.textContent = err;
      return;
    }
    const signature: FitnessSignature = { id: crypto.randomUUID(), machine, ...v, createdAt: new Date().toISOString(), source: 'manual' };
    await app.store.putSignature(signature);
    sigSaved.hidden = false;
    showCurrent(signature);
  });
  const showCurrent = (sig: FitnessSignature): void => {
    const origin = sig.id === 'pm5-default' ? 'standardvärden' : sig.source === 'test3p' ? `från test ${formatDate(sig.createdAt)}` : `inmatad ${formatDate(sig.createdAt)}`;
    current.textContent = `Aktiv för PM5: PP ${Math.round(sig.pp)} W · CP ${Math.round(sig.cp)} W · W′ ${Math.round(sig.wPrime).toLocaleString('sv-SE')} J · k ${Math.round(kOf(sig))} s (${origin})`;
    pp.value = String(Math.round(sig.pp));
    cp.value = String(Math.round(sig.cp));
    wPrime.value = String(Math.round(sig.wPrime));
    updateK();
  };
  void app.store.latestSignature(machine, false).then((sig) => showCurrent(sig ?? defaultPm5Signature(machine)));

  // --- Settings ---
  const s = app.settings;
  const tolerance = numberInput(s.tolerance * 100, '0.5');
  const avgStrokes = numberInput(s.powerAvgStrokes, '1');
  const machineSelect = h(
    'select',
    {},
    ...(Object.keys(MACHINE_LABEL) as Settings['machine'][]).map((m) => h('option', { value: m, selected: m === s.machine }, MACHINE_LABEL[m])),
  );
  const green = numberInput(s.zones.green * 100, '1');
  const yellow = numberInput(s.zones.yellow * 100, '1');
  const orange = numberInput(s.zones.orange * 100, '1');
  const skibaA = numberInput(s.skiba.a);
  const skibaB = numberInput(s.skiba.b, '0.001');
  const skibaC = numberInput(s.skiba.c);
  const setError = h('p', { class: 'error', hidden: true });
  const setSaved = h('p', { class: 'hint', hidden: true }, 'Inställningarna är sparade.');
  const saveSettings = h('button', {}, 'Spara inställningar');
  saveSettings.addEventListener('click', async () => {
    const next: Settings = {
      tolerance: Number(tolerance.value) / 100,
      powerAvgStrokes: Number(avgStrokes.value),
      machine: machineSelect.value as Settings['machine'],
      zones: { green: Number(green.value) / 100, yellow: Number(yellow.value) / 100, orange: Number(orange.value) / 100 },
      skiba: { a: Number(skibaA.value), b: Number(skibaB.value), c: Number(skibaC.value) },
    };
    const err = validateSettings(next);
    setError.hidden = err === null;
    setSaved.hidden = err !== null;
    if (err) setError.textContent = err;
    else await app.saveSettings(next);
  });

  // --- Backup (§11) ---
  const backupStatus = h('p', { class: 'hint' });
  const exportBtn = h('button', { class: 'secondary' }, 'Exportera (JSON)');
  exportBtn.addEventListener('click', async () => {
    const file = await exportBackup(app.store);
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
    h('a', { href: url, download: `skierg-backup-${file.exportedAt.slice(0, 10)}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    backupStatus.textContent = `Exporterade ${file.stores.sessions.length} pass.`;
  });
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const importBtn = h('button', { class: 'secondary' }, 'Importera…');
  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const backup = parseBackup(JSON.parse(await file.text()));
      if (!confirm(`Importera ${backup.stores.sessions.length} pass från ${formatDate(backup.exportedAt)}? Poster med samma id ersätts.`)) return;
      const counts = await importBackup(app.store, backup);
      await app.loadSettings();
      backupStatus.textContent = `Importerade ${counts.sessions} pass, ${counts.signatures} signaturer och ${counts.testResults} testresultat.`;
    } catch (err) {
      backupStatus.textContent = err instanceof Error ? err.message : String(err);
    }
  });

  root.append(
    h('nav', {}, h('button', { class: 'link', onclick: () => app.navigate('start') }, '← Start')),
    h('h1', {}, 'Inställningar'),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Signatur'),
      current,
      h('div', { class: 'fields' }, field('PP', pp, 'W'), field('CP', cp, 'W'), field('W′', wPrime, 'J'), kText),
      h('div', { class: 'row' }, saveSig),
      sigError,
      sigSaved,
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Pass och livevy'),
      h(
        'div',
        { class: 'fields' },
        field('Standardtolerans för målband', tolerance, '± %'),
        field('Drag i effektmedlet', avgStrokes),
        field('Maskintyp', machineSelect),
      ),
      h(
        'details',
        {},
        h('summary', {}, 'Avancerat'),
        h('p', { class: 'hint small' }, 'W′-zoner: nedre gräns i procent av W′ för grön, gul och orange. Under orange är rött.'),
        h('div', { class: 'fields' }, field('Grön från', green, '%'), field('Gul från', yellow, '%'), field('Orange från', orange, '%')),
        h('p', { class: 'hint small' }, 'Skiba-konstanter för återhämtning: τ = a · e^(−b · D) + c. Standard 546, 0,01, 316 (från cykling).'),
        h('div', { class: 'fields' }, field('a', skibaA), field('b', skibaB), field('c', skibaC)),
      ),
      h('div', { class: 'row' }, saveSettings),
      setError,
      setSaved,
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Backup'),
      h('p', { class: 'hint small' }, 'Hela databasen som en JSON-fil: pass, rådata, signaturer, testresultat och inställningar.'),
      h('div', { class: 'row' }, exportBtn, importBtn, fileInput),
      backupStatus,
    ),
  );
  return () => {};
};
