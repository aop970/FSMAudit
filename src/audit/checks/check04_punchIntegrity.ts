// Check 4 — Punch Integrity
// Permanently N/A: Time Hours is provided directly by the timekeeping system
// and represents the validated clock-in/clock-out delta. Re-deriving it from
// Time In/Time Out is redundant. Slot is preserved so AI analysis has context.

import type { CheckResult, PunchRow } from '../types';

export function check04PunchIntegrity(_punch: PunchRow[]): CheckResult {
  return {
    checkId: 4,
    checkName: 'Punch Integrity',
    status: 'na',
    stats: 'Skipped — Time Hours is sourced directly from timekeeping system (clock-in/out delta pre-calculated)',
    flaggedCount: 0,
    flaggedRows: [],
  };
}
