const pad = (n: number): string => String(n).padStart(2, '0');

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export function formatDistance(metres: number): string {
  return `${Math.round(metres).toLocaleString('sv-SE')} m`;
}

export function formatPower(watts: number | null | undefined): string {
  return watts === null || watts === undefined ? '–' : `${Math.round(watts)} W`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
}

/** "Idag", or e.g. "ons 8 okt." for a YYYY-MM-DD date. */
export function formatDay(date: string, today: string): string {
  if (date === today) return 'Idag';
  return new Date(`${date}T12:00:00`).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
}

const TEST_NAMES: Record<number, string> = { 30: '30 s', 180: '3 min', 360: '6 min', 720: '12 min' };

/** Name of a test length, e.g. "3 min". */
export const testName = (seconds: number): string => TEST_NAMES[seconds] ?? formatDuration(seconds);

/** "14,6" for 14 560 J. */
export const formatKJ = (joules: number): string => (joules / 1000).toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
