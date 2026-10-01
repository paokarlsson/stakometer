// Import of a plan file from elitledet (spec §6.7): validated as a whole, nothing imported on error.
import { parsePlan } from '../workout/plan';
import type { App } from './app';

export async function importPlanFile(app: App, file: File): Promise<{ text: string; error: boolean }> {
  try {
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      throw new Error('Filen är inte giltig JSON.');
    }
    const plan = parsePlan(json);
    const existing = new Set((await app.store.listPlannedWorkouts()).map((w) => w.id));
    await app.store.putPlannedWorkouts(plan.workouts);
    const replaced = plan.workouts.filter((w) => existing.has(w.id)).length;
    return { text: `Importerade ${plan.workouts.length} pass från ${file.name}${replaced > 0 ? ` (${replaced} ersatte tidigare versioner)` : ''}.`, error: false };
  } catch (err) {
    return { text: `Planen importerades inte. ${err instanceof Error ? err.message : String(err)}`, error: true };
  }
}
