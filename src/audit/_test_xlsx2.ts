import * as XLSX from 'xlsx';
// Access SSF via namespace
// @ts-ignore
const ssf = (XLSX as Record<string, unknown>).SSF ?? (XLSX.default as Record<string, unknown> | undefined)?.SSF;
console.log('SSF via namespace:', typeof XLSX.SSF);
console.log('SSF via any:', typeof ssf);
console.log('XLSX.default keys:', Object.keys(XLSX.default ?? {}).slice(0, 8));
// @ts-ignore
const xlsxAny = XLSX as Record<string, unknown>;
console.log('module.exports?.SSF:', typeof (xlsxAny['module.exports'] as Record<string, unknown>)?.SSF);
