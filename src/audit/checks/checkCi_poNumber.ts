// checkCi_poNumber.ts — Check 13 for CI program
// Pure CI-letter invoices: PO# should be blank. Warn if populated.
// VOC and pass-through invoices: PO# must match poByInvoice config.
// poByInvoice keys are invoice base names (no extension).

import type { CheckResult, CiCoverMeta } from '../types';
import { getAuditRules } from '../auditRules';

export function checkCiPoNumber(
  fileName: string,
  coverMeta: CiCoverMeta,
): CheckResult {
  const fileBase = fileName.replace(/\.[^/.]+$/, '').trim();
  const rules = getAuditRules('ci');
  const poByInvoice = rules.poByInvoice ?? {};

  // Look up configured PO by invoice base name (case-insensitive key lookup)
  const configuredPo =
    poByInvoice[fileBase] ??
    poByInvoice[fileBase.toUpperCase()] ??
    null;

  const invoicedPo = coverMeta.poNumber?.trim() ?? '';

  if (configuredPo === null) {
    // Pure CI letter invoice — expect blank PO
    if (invoicedPo !== '') {
      return {
        checkId: 13,
        checkName: 'PO Number',
        status: 'warning',
        stats: `Pure CI invoice — PO# should be blank, but "${invoicedPo}" was found`,
        flaggedCount: 1,
        flaggedRows: [
          {
            invoiceFile: fileBase,
            invoicedPo,
            expected: '(blank)',
            issue: 'CI letter invoices do not carry a PO number — unexpected PO# found',
          },
        ],
      };
    }
    return {
      checkId: 13,
      checkName: 'PO Number',
      status: 'pass',
      stats: `Pure CI invoice — PO# is blank as expected`,
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  // VOC / pass-through invoice — PO must match
  const match = invoicedPo.toLowerCase() === configuredPo.toLowerCase();
  return {
    checkId: 13,
    checkName: 'PO Number',
    status: match ? 'pass' : 'fail',
    stats: match
      ? `PO# "${invoicedPo}" matches configured value for ${fileBase}`
      : `PO# mismatch — invoice has "${invoicedPo}", expected "${configuredPo}" for ${fileBase}`,
    flaggedCount: match ? 0 : 1,
    flaggedRows: match
      ? []
      : [
          {
            invoiceFile: fileBase,
            invoicedPo: invoicedPo || '(blank)',
            configuredPo,
            issue: 'PO# does not match configured value for this invoice',
          },
        ],
  };
}
