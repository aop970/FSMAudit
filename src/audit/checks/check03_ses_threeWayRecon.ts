// Check 3 (SES) — Three-Way Punch Reconciliation
// Invoice Detail total hours vs Punch Detail hours vs Shift Report (Actual) hours.
// Total tolerance: ≤ 2 hours.

import type { CheckResult, LaborRow, SesPunchRow, ShiftRow } from '../types';

const TOTAL_TOL = 2.0;

export function check03SesThreeWayRecon(
  detailRows: LaborRow[],
  punchRows: SesPunchRow[],
  shiftRows: ShiftRow[],
): CheckResult {
  const noPunch = punchRows.length === 0;
  const noShift = shiftRows.length === 0;

  if (noPunch && noShift) {
    return {
      checkId: 3,
      checkName: 'Three-Way Punch Recon',
      status: 'na',
      stats: 'No punch or shift files uploaded',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  // Sum all invoice Detail hours — SES rows represent billable work regardless of category
  const invoiceHrs = detailRows.reduce((s, r) => s + r.timeHours, 0);

  // Sum all punch Time Hours
  const punchHrs = punchRows.reduce((s, r) => s + r.timeHours, 0);

  // Sum all shift Actual Time values (in minutes) ÷ 60
  const shiftHrs = shiftRows.reduce((s, r) => s + r.actualMinutes / 60, 0);

  const flaggedRows: Record<string, unknown>[] = [];
  const variances: { label: string; value: number }[] = [];

  if (!noPunch && !noShift) {
    // All three sources available — compute all pairwise variances
    const ivp = Math.abs(invoiceHrs - punchHrs);
    const ivs = Math.abs(invoiceHrs - shiftHrs);
    const pvs = Math.abs(punchHrs - shiftHrs);
    variances.push(
      { label: 'Invoice vs Punch', value: ivp },
      { label: 'Invoice vs Shift', value: ivs },
      { label: 'Punch vs Shift',   value: pvs },
    );
    const anyFail = variances.some((v) => v.value > TOTAL_TOL);
    flaggedRows.push({
      invoiceHrs: invoiceHrs.toFixed(2),
      punchHrs:   punchHrs.toFixed(2),
      shiftHrs:   shiftHrs.toFixed(2),
      invoiceVsPunch: (invoiceHrs - punchHrs).toFixed(2),
      invoiceVsShift: (invoiceHrs - shiftHrs).toFixed(2),
      punchVsShift:   (punchHrs - shiftHrs).toFixed(2),
      status: anyFail ? 'FAIL' : 'PASS',
    });
    const failLabels = variances.filter((v) => v.value > TOTAL_TOL).map((v) => v.label);
    const status = anyFail ? 'fail' : 'pass';
    return {
      checkId: 3,
      checkName: 'Three-Way Punch Recon',
      status,
      stats: anyFail
        ? `Variance exceeds ${TOTAL_TOL}h tolerance: ${failLabels.join(', ')}`
        : `Invoice ${invoiceHrs.toFixed(2)}h | Punch ${punchHrs.toFixed(2)}h | Shift ${shiftHrs.toFixed(2)}h — all within ${TOTAL_TOL}h tolerance`,
      flaggedCount: anyFail ? 1 : 0,
      flaggedRows: anyFail ? flaggedRows : [],
    };
  }

  if (noPunch) {
    // Only shift available
    const ivs = Math.abs(invoiceHrs - shiftHrs);
    const fail = ivs > TOTAL_TOL;
    flaggedRows.push({
      invoiceHrs: invoiceHrs.toFixed(2),
      shiftHrs:   shiftHrs.toFixed(2),
      invoiceVsShift: (invoiceHrs - shiftHrs).toFixed(2),
      note: 'Punch file not uploaded — invoice vs shift only',
      status: fail ? 'FAIL' : 'PASS',
    });
    return {
      checkId: 3,
      checkName: 'Three-Way Punch Recon',
      status: fail ? 'fail' : 'pass',
      stats: fail
        ? `Invoice vs Shift variance ${ivs.toFixed(2)}h exceeds ${TOTAL_TOL}h tolerance (no punch file)`
        : `Invoice ${invoiceHrs.toFixed(2)}h vs Shift ${shiftHrs.toFixed(2)}h — within tolerance`,
      flaggedCount: fail ? 1 : 0,
      flaggedRows: fail ? flaggedRows : [],
    };
  }

  // Only punch available (noShift)
  const ivp = Math.abs(invoiceHrs - punchHrs);
  const fail = ivp > TOTAL_TOL;
  flaggedRows.push({
    invoiceHrs: invoiceHrs.toFixed(2),
    punchHrs:   punchHrs.toFixed(2),
    invoiceVsPunch: (invoiceHrs - punchHrs).toFixed(2),
    note: 'Shift report not uploaded — invoice vs punch only',
    status: fail ? 'FAIL' : 'PASS',
  });
  return {
    checkId: 3,
    checkName: 'Three-Way Punch Recon',
    status: fail ? 'fail' : 'pass',
    stats: fail
      ? `Invoice vs Punch variance ${ivp.toFixed(2)}h exceeds ${TOTAL_TOL}h tolerance (no shift report)`
      : `Invoice ${invoiceHrs.toFixed(2)}h vs Punch ${punchHrs.toFixed(2)}h — within tolerance`,
    flaggedCount: fail ? 1 : 0,
    flaggedRows: fail ? flaggedRows : [],
  };
}
