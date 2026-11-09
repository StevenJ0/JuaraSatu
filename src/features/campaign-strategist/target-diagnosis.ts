const DAY_MS = 86_400_000;

export type TargetPace = "target_met" | "on_track" | "behind" | "far_behind";
export type TargetDiagnosis = {
  targetUnits: number; paidUnits: number; gapUnits: number; daysLeft: number; daysElapsed: number;
  unitsPerDayNeeded: number; paidPerDaySoFar: number; pace: TargetPace;
};

/**
 * How far a preorder is from its paid-unit target, computed by code so the AI only reads it.
 * "behind" still keeps at least half of the needed daily pace; below that the gap needs new reach, not just reminders.
 */
export function diagnoseTarget(input: { targetUnits: number; paidUnits: number; startsAt: string; endsAt: string; now: string }): TargetDiagnosis {
  const now = Date.parse(input.now);
  const gapUnits = Math.max(input.targetUnits - input.paidUnits, 0);
  const daysLeft = Math.max(Math.ceil((Date.parse(input.endsAt) - now) / DAY_MS), 0);
  const daysElapsed = Math.max(Math.ceil((now - Date.parse(input.startsAt)) / DAY_MS), 1);
  const unitsPerDayNeeded = gapUnits === 0 ? 0 : Math.ceil(gapUnits / Math.max(daysLeft, 1));
  const paidPerDaySoFar = Math.round((input.paidUnits / daysElapsed) * 10) / 10;
  const pace: TargetPace = gapUnits === 0 ? "target_met"
    : paidPerDaySoFar >= unitsPerDayNeeded ? "on_track" : paidPerDaySoFar * 2 >= unitsPerDayNeeded ? "behind" : "far_behind";
  return { targetUnits: input.targetUnits, paidUnits: input.paidUnits, gapUnits, daysLeft, daysElapsed, unitsPerDayNeeded, paidPerDaySoFar, pace };
}
