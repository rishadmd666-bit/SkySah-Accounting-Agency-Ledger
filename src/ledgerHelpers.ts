import Chart from 'chart.js/auto';

// Attach Chart to window so the existing Chart.js calls in ledgerEngine work seamlessly
(window as any).Chart = Chart;

export const LS_KEY = 'skylatch_ledger_v1';
export const BDT = (n: any) => '৳' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const toLocalISODate = (d: Date) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
export const todayStr = () => toLocalISODate(new Date());

export const monthsAgoDate = (n: number) => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - n, 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(now.getDate(), lastDay));
  return d;
};
export const uid = (p = 'id') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const monthKey = (d: string) => (d || '').slice(0, 7);
export const fmtDate = (d: string) => {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
export const escapeHtml = (s: any) => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

export const EXPENSE_TYPES: Record<string, string> = { cos: 'Cost of Service', opex: 'Operating Expense' };
export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'AI Tools', type: 'cos' },
  { name: 'Video Editing Software', type: 'cos' },
  { name: 'Design Software', type: 'cos' },
  { name: 'Stock Footage / Music', type: 'cos' },
  { name: 'Voice Over / Talent', type: 'cos' },
  { name: 'Freelancers (Client Work)', type: 'cos' },
  { name: 'Hosting (Client)', type: 'cos' },
  { name: 'Domain (Client)', type: 'cos' },
  { name: 'Client Ad Spend (Billed)', type: 'cos' },
  { name: 'Third-party Service (Client)', type: 'cos' },
  { name: 'Office Rent', type: 'opex' },
  { name: 'Utilities', type: 'opex' },
  { name: 'Internet', type: 'opex' },
  { name: 'Mobile / Recharge', type: 'opex' },
  { name: 'Transportation', type: 'opex' },
  { name: 'Equipment', type: 'opex' },
  { name: 'Own Marketing / Ads', type: 'opex' },
  { name: 'Website & Branding', type: 'opex' },
  { name: 'Bank / Payment Charges', type: 'opex' },
  { name: 'Training & Courses', type: 'opex' },
  { name: 'Office Supplies', type: 'opex' },
  { name: 'Food & Entertainment', type: 'opex' },
  { name: 'Legal & Professional', type: 'opex' },
  { name: 'Miscellaneous', type: 'opex' },
];

export const LEGACY_CATEGORY_MAP: Record<string, string> = {
  'Software': 'Video Editing Software',
  'AI Tools': 'AI Tools',
  'Hosting': 'Hosting (Client)',
  'Domain': 'Domain (Client)',
  'Meta Ads': 'Own Marketing / Ads',
  'Google Ads': 'Own Marketing / Ads',
  'Marketing': 'Own Marketing / Ads',
  'Freelancers': 'Freelancers (Client Work)',
  'Employee Salary': '__SALARY__',
};

export function emptyDB() {
  return {
    clients: [] as any[],
    services: [] as any[],
    packages: [] as any[],
    invoices: [] as any[],
    payments: [] as any[],
    expenses: [] as any[],
    employees: [] as any[],
    employeePayments: [] as any[],
    accounts: [
      { id: 'acc_cash', name: 'Cash', type: 'Cash', opening: 0 },
      { id: 'acc_bank', name: 'Bank Account', type: 'Bank', opening: 0 },
      { id: 'acc_bkash', name: 'bKash', type: 'Mobile Wallet', opening: 0 },
      { id: 'acc_nagad', name: 'Nagad', type: 'Mobile Wallet', opening: 0 },
      { id: 'acc_paypal', name: 'PayPal', type: 'Gateway', opening: 0 },
    ],
    transfers: [] as any[],
    quotations: [] as any[],
    contracts: [] as any[],
    refunds: [] as any[],
    creditLedger: [] as any[],
    invoiceSeq: 1000,
    quoteSeq: 100,
    adsFunds: [] as any[],
    appUsers: [] as any[],
    auditLogs: [] as any[],
    bsManual: { equipment: 0, otherAssets: 0, advanceToVendors: 0, payables: 0, salaryPayable: 0, loans: 0, ownerCapital: 0, drawings: 0 },
    expenseCategories: DEFAULT_EXPENSE_CATEGORIES.map(c => ({ ...c })),
  };
}

export function normalizeAndMigrateDB(parsed: any) {
  const base = emptyDB();
  if (!parsed || typeof parsed !== 'object') return base;
  const db: any = Object.assign(base, parsed);
  db.bsManual = Object.assign({ equipment: 0, otherAssets: 0, advanceToVendors: 0, payables: 0, salaryPayable: 0, loans: 0, ownerCapital: 0, drawings: 0 }, db.bsManual || {});
  db.adsFunds = db.adsFunds || [];
  db.appUsers = db.appUsers || [];
  db.auditLogs = db.auditLogs || [];
  db.refunds = db.refunds || [];
  db.creditLedger = db.creditLedger || [];
  db.transfers = db.transfers || [];
  db.quotations = db.quotations || [];
  db.contracts = db.contracts || [];

  if (!db.employeePayments || !db.employeePayments.length) {
    db.employeePayments = db.employeePayments || [];
    (db.employees || []).forEach((e: any) => {
      if (Number(e.paid) > 0) {
        db.employeePayments.push({ id: uid('epay'), employeeId: e.id, date: e.joinDate || todayStr(), amount: Number(e.paid), accountId: 'acc_bank', note: 'Migrated opening balance' });
      }
    });
  }
  const METHOD_TO_ACCOUNT_MIGRATE: Record<string, string> = { 'Cash': 'acc_cash', 'Bank': 'acc_bank', 'bKash': 'acc_bkash', 'Nagad': 'acc_nagad', 'Card': 'acc_bank', 'PayPal': 'acc_paypal', 'Other': 'acc_bank' };
  (db.expenses || []).forEach((e: any) => { if (!e.accountId) { e.accountId = METHOD_TO_ACCOUNT_MIGRATE[e.method] || 'acc_bank'; } });
  (db.employeePayments || []).forEach((p: any) => { if (!p.accountId) { p.accountId = 'acc_bank'; } });
  (db.invoices || []).forEach((inv: any) => {
    if (inv.recurring) { (inv.items || []).forEach((it: any) => { it.isPackage = true; }); }
  });

  const isLegacySave = !Array.isArray(parsed.expenseCategories) || !parsed.expenseCategories.length;
  if (isLegacySave) {
    db.expenseCategories = DEFAULT_EXPENSE_CATEGORIES.map(c => ({ ...c }));
    (db.expenses || []).forEach((e: any) => {
      const mapped = LEGACY_CATEGORY_MAP[e.category];
      if (!mapped || mapped === '__SALARY__') return;
      e.category = mapped;
    });
  }
  db.expenseCategories = db.expenseCategories
    .filter((c: any) => c && String(c.name || '').trim())
    .map((c: any) => ({ name: String(c.name).trim(), type: (c.type === 'cos' ? 'cos' : 'opex') }));
  const seen = new Set<string>();
  db.expenseCategories = db.expenseCategories.filter((c: any) => {
    const k = c.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  (db.expenses || []).forEach((e: any) => {
    const nm = String(e.category || '').trim();
    if (!nm) { e.category = 'Miscellaneous'; return; }
    if (!seen.has(nm.toLowerCase())) {
      db.expenseCategories.push({ name: nm, type: 'opex' });
      seen.add(nm.toLowerCase());
    }
  });
  return db;
}
