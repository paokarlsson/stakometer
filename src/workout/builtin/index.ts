import { parseWorkout, type Workout } from '../schema';
import fourByFour from './4x4-threshold.json';
import eightByOne from './8x1-hard.json';
import thirtyMin from './30min-steady.json';

/** Built-in workouts (spec §6.4), validated at load. Free ride is a separate mode. */
export const BUILTIN_WORKOUTS: readonly Workout[] = [fourByFour, eightByOne, thirtyMin].map(parseWorkout);
