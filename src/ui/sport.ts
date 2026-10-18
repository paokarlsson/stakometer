// Labels and units per training form: strokes and drag factor on the SkiErg, cadence,
// speed and torque on a bike.
import type { Sport } from '../sources/DataSource';
import { sessionSport, type Session } from '../storage/types';

export interface SportLabels {
  name: string;
  /** Live tile and summary tile for strokes/min or rpm. */
  cadence: string;
  cadenceShort: string;
  /** Force tile: average drive force on the SkiErg, crank torque on a bike. */
  force: string;
  /** Whether speed (km/h) and the drag factor are shown. */
  showSpeed: boolean;
  showDragFactor: boolean;
  /** "Fri åkning" / "Fri cykling". */
  free: string;
  /** Unit of the power average in the legend, e.g. "3 drag". */
  avgUnit: string;
}

export const SPORT_LABELS: Record<Sport, SportLabels> = {
  skierg: {
    name: 'SkiErg',
    cadence: 'Dragtakt (drag/min)',
    cadenceShort: 'Dragtakt',
    force: 'Kraft (N)',
    showSpeed: false,
    showDragFactor: true,
    free: 'Fri åkning',
    avgUnit: 'drag',
  },
  bike: {
    name: 'Cykel',
    cadence: 'Kadens (rpm)',
    cadenceShort: 'Kadens',
    force: 'Vridmoment (Nm)',
    showSpeed: true,
    showDragFactor: false,
    free: 'Fri cykling',
    avgUnit: 'mätningar',
  },
};

/** Where a session's data came from, e.g. "PM5", "Cykeltrainer" or "Cykelsimulator". */
export function sourceLabel(session: Pick<Session, 'source' | 'sport' | 'machine'>): string {
  if (session.source === 'pm5') return 'PM5';
  if (session.source === 'trainer') return 'Cykeltrainer';
  return sessionSport(session) === 'bike' ? 'Cykelsimulator' : 'Simulator';
}
