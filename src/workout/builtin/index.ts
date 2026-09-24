import { parseWorkout, type Workout } from '../schema';
import fourByFour from './4x4-threshold.json';
import eightByOne from './8x1-hard.json';
import thirtyMin from './30min-steady.json';
import test30 from './test-30s.json';
import test180 from './test-180s.json';
import test600 from './test-600s.json';

/** Built-in workouts (spec §6.4), validated at load. Free ride is a separate mode. */
export const BUILTIN_WORKOUTS: readonly Workout[] = [fourByFour, eightByOne, thirtyMin].map(parseWorkout);

/**
 * The three test workouts (spec §7.1). Warm-up 10 min at 55 % CP with two 10 s
 * pickups at 120 % CP [FÖRSLAG], 3 min easy at 40 % CP, the maximal effort, and
 * 5 min cool-down at 50 % CP.
 */
export const TEST_WORKOUTS: readonly Workout[] = [test30, test180, test600].map(parseWorkout);

export const ALL_WORKOUTS: readonly Workout[] = [...BUILTIN_WORKOUTS, ...TEST_WORKOUTS];

export const workoutById = (id: string | undefined): Workout | undefined => ALL_WORKOUTS.find((w) => w.id === id);
