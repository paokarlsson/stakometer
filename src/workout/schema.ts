/** Expanded workout segment (spec §6.2). Workout parsing and expansion arrive in step 2. */
export interface TimelineSegment {
  start: number; // s from session start
  end: number;
  kind: string;
  label: string; // e.g. "Intervall 2/4"
  targetW: number | null; // null = no target
  lo: number | null;
  hi: number | null;
  isMax: boolean;
}
