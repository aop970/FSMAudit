// checkCi_customRules.ts — Check 15 for CI program
// Reuses the existing check15_customRules check for 'ci' program.
// CI doesn't use LaborRow for custom rules — pass empty arrays for a no-op pass.

import { check15CustomRules } from './check15_customRules';
import type { CheckResult, LaborRow } from '../types';

export function checkCiCustomRules(rows1: LaborRow[], rows2: LaborRow[]): CheckResult {
  return check15CustomRules(rows1, rows2);
}
