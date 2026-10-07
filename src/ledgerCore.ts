import {
  LS_KEY, BDT, toLocalISODate, todayStr, uid, monthKey, fmtDate,
  daysBetween, escapeHtml, EXPENSE_TYPES, emptyDB, normalizeAndMigrateDB
} from './ledgerHelpers';
import { getAppAccounts } from './appAuth';
import { LOGO_DATA_URI } from './logo';
import { printInvoiceDoc, printStatementDoc, printGenericReportDoc, printQuotationDoc } from './ledgerPrinters';
import { buildSampleData } from './ledgerSample';

export let DB: any = emptyDB();
let onCloudSaveCallback: ((dbState: any) => void) | null = null;
let chartRefs: Record<string, any> = {};
let activeActorEmail = 'admin';
let activeActorName = 'Admin';
let activeActorRole = 'Admin';
let activeIsSystemOwner = false;
let activeAllowedPages: string[] = ['*'];
let activeCanDelete = true;
let prevSnapshot: any = null;

export function setActiveActor(
  email: string,
  name: string,
  role = 'Admin',
  allowedPages: string[] = ['*'],
  canDelete = true,
  isSystemOwner = false
) {
  activeActorEmail = email || 'admin';
  activeActorName = name || 'Admin';
  activeActorRole = role || 'Admin';
  activeIsSystemOwner = Boolean(isSystemOwner);
  activeAllowedPages = allowedPages && allowedPages.length ? allowedPages : ['dashboard'];
  activeCanDelete = isSystemOwner || role === 'Admin' ? true : Boolean(canDelete);
  renderSidebar();
}

export function isCurrentUserSystemOwner(): boolean {
  return activeIsSystemOwner;
}

export function isPageAllowedForCurrentUser(pageId: string): boolean {
  if (activeIsSystemOwner || activeActorRole === 'Admin' || activeAllowedPages.includes('*')) return true;
  return activeAllowedPages.includes(pageId);
}

export function canCurrentUserDelete(): boolean {
  if (activeIsSystemOwner || activeActorRole === 'Admin') return true;
  return activeCanDelete;
}

function takeSnapshot(state: any) {
  return {
    clients: new Map((state.clients || []).map((x: any) => [x.id, JSON.stringify(x)])),
    invoices: new Map((state.invoices || []).map((x: any) => [x.id, JSON.stringify(x)])),
    payments: new Map((state.payments || []).map((x: any) => [x.id, JSON.stringify(x)])),
    expenses: new Map((state.expenses || []).map((x: any) => [x.id, JSON.stringify(x)])),
    refunds: new Map((state.refunds || []).map((x: any) => [x.id, JSON.stringify(x)])),
    employees: new Map((state.employees || []).map((x: any) => [x.id, JSON.stringify(x)])),
    employeePayments: new Map((state.employeePayments || []).map((x: any) => [x.id, JSON.stringify(x)])),
    services: new Map((state.services || []).map((x: any) => [x.id, JSON.stringify(x)])),
    packages: new Map((state.packages || []).map((x: any) => [x.id, JSON.stringify(x)])),
    quotations: new Map((state.quotations || []).map((x: any) => [x.id, JSON.stringify(x)])),
    contracts: new Map((state.contracts || []).map((x: any) => [x.id, JSON.stringify(x)])),
    transfers: new Map((state.transfers || []).map((x: any) => [x.id, JSON.stringify(x)])),
    adsFunds: new Map((state.adsFunds || []).map((x: any) => [x.id, JSON.stringify(x)])),
    accounts: new Map((state.accounts || []).map((x: any) => [x.id, JSON.stringify(x)])),
  };
}

export function logAuditEvent(action: string, module: string, detail: string, amount?: number) {
  DB.auditLogs = DB.auditLogs || [];
  DB.auditLogs.unshift({
    id: uid('aud'),
    timestamp: new Date().toISOString(),
    actorName: activeActorName,
    actorEmail: activeActorEmail,
    action,
    module,
    detail,
    amount: amount != null ? Number(amount) : null
  });
  if (DB.auditLogs.length > 300) {
    DB.auditLogs = DB.auditLogs.slice(0, 300);
  }
}

function detectAndLogChanges() {
  if (!prevSnapshot) {
    prevSnapshot = takeSnapshot(DB);
    return;
  }
  const curr = takeSnapshot(DB);
  const cName = (cid: string) => {
    const c = (DB.clients || []).find((x: any) => x.id === cid);
    return c ? c.name : 'Client';
  };

  // Invoices diff
  (DB.invoices || []).forEach((inv: any) => {
    const oldStr = prevSnapshot.invoices.get(inv.id);
    const tot = invoiceTotals(inv).total;
    if (!oldStr) {
      logAuditEvent('Created', 'Invoice', `${inv.number} created for ${cName(inv.clientId)}`, tot);
    } else if (oldStr !== curr.invoices.get(inv.id)) {
      const oldObj = JSON.parse(oldStr);
      if (oldObj.status !== 'Cancelled' && inv.status === 'Cancelled') {
        logAuditEvent('Cancelled', 'Invoice', `${inv.number} (${cName(inv.clientId)}) marked Cancelled`, tot);
      } else {
        logAuditEvent('Updated', 'Invoice', `${inv.number} (${cName(inv.clientId)}) updated`, tot);
      }
    }
  });
  prevSnapshot.invoices.forEach((oldStr: string, id: string) => {
    if (!curr.invoices.has(id)) {
      const oldObj = JSON.parse(oldStr);
      logAuditEvent('Deleted', 'Invoice', `${oldObj.number || id} deleted`, invoiceTotals(oldObj).total);
    }
  });

  // Payments diff
  (DB.payments || []).forEach((p: any) => {
    if (!prevSnapshot.payments.has(p.id)) {
      const inv = (DB.invoices || []).find((x: any) => x.id === p.invoiceId);
      logAuditEvent('Recorded', 'Payment', `Payment for ${inv ? inv.number : cName(p.clientId)} via ${p.method || 'Bank'}`, p.amount);
    }
  });
  prevSnapshot.payments.forEach((oldStr: string, id: string) => {
    if (!curr.payments.has(id)) {
      const oldObj = JSON.parse(oldStr);
      logAuditEvent('Deleted', 'Payment', `Payment record (${oldObj.method || ''}) deleted`, oldObj.amount);
    }
  });

  // Refunds diff
  (DB.refunds || []).forEach((r: any) => {
    if (!prevSnapshot.refunds.has(r.id)) {
      const inv = (DB.invoices || []).find((x: any) => x.id === r.invoiceId);
      logAuditEvent('Issued', 'Refund', `Refund on ${inv ? inv.number : cName(r.clientId)}`, r.amount);
    }
  });

  // Expenses diff
  (DB.expenses || []).forEach((e: any) => {
    const oldStr = prevSnapshot.expenses.get(e.id);
    if (!oldStr) {
      logAuditEvent('Added', 'Expense', `${e.category}${e.vendor ? ' — ' + e.vendor : ''}`, e.amount);
    } else if (oldStr !== curr.expenses.get(e.id)) {
      logAuditEvent('Updated', 'Expense', `${e.category} updated`, e.amount);
    }
  });
  prevSnapshot.expenses.forEach((oldStr: string, id: string) => {
    if (!curr.expenses.has(id)) {
      const oldObj = JSON.parse(oldStr);
      logAuditEvent('Deleted', 'Expense', `Expense (${oldObj.category}) deleted`, oldObj.amount);
    }
  });

  // Clients diff
  (DB.clients || []).forEach((c: any) => {
    const oldStr = prevSnapshot.clients.get(c.id);
    if (!oldStr) {
      logAuditEvent('Added', 'Client', `New client "${c.name}" (${c.company || 'Individual'})`, c.monthlyPackage || 0);
    } else if (oldStr !== curr.clients.get(c.id)) {
      logAuditEvent('Updated', 'Client', `Client "${c.name}" profile updated (${c.status})`, c.monthlyPackage || 0);
    }
  });
  prevSnapshot.clients.forEach((oldStr: string, id: string) => {
    if (!curr.clients.has(id)) {
      const oldObj = JSON.parse(oldStr);
      logAuditEvent('Deleted', 'Client', `Client "${oldObj.name}" permanently deleted`);
    }
  });

  // Employee Payouts diff
  (DB.employeePayments || []).forEach((ep: any) => {
    if (!prevSnapshot.employeePayments.has(ep.id)) {
      const emp = (DB.employees || []).find((x: any) => x.id === ep.employeeId);
      logAuditEvent('Paid', 'Payroll', `Salary/Payout to ${emp ? emp.name : 'Team Member'} (${ep.note || ''})`, ep.amount);
    }
  });

  // Transfers diff
  (DB.transfers || []).forEach((t: any) => {
    if (!prevSnapshot.transfers.has(t.id)) {
      logAuditEvent('Transferred', 'Cash & Bank', `Fund transfer between accounts`, t.amount);
    }
  });

  // Quotations diff
  (DB.quotations || []).forEach((q: any) => {
    const oldStr = prevSnapshot.quotations.get(q.id);
    if (!oldStr) {
      logAuditEvent('Created', 'Quotation', `${q.number} for ${cName(q.clientId)}`, q.total);
    } else if (oldStr !== curr.quotations.get(q.id)) {
      logAuditEvent('Updated', 'Quotation', `${q.number} status: ${q.status}`, q.total);
    }
  });

  // Ads Fund diff
  (DB.adsFunds || []).forEach((a: any) => {
    const oldStr = prevSnapshot.adsFunds.get(a.id);
    if (!oldStr) {
      logAuditEvent('Added', 'Ads Fund', `${a.platform || 'Ad'} spend for ${cName(a.clientId)}`, a.amount);
    } else if (oldStr !== curr.adsFunds.get(a.id)) {
      logAuditEvent('Updated', 'Ads Fund', `${a.platform || 'Ad'} spend for ${cName(a.clientId)} updated`, a.amount);
    }
  });
  prevSnapshot.adsFunds.forEach((oldStr: string, id: string) => {
    if (!curr.adsFunds.has(id)) {
      const oldObj = JSON.parse(oldStr);
      logAuditEvent('Deleted', 'Ads Fund', `${oldObj.platform || 'Ad'} spend for ${cName(oldObj.clientId)} deleted`, oldObj.amount);
    }
  });

  prevSnapshot = curr;
}

export function setCloudSaveCallback(cb: (dbState: any) => void) {
  onCloudSaveCallback = cb;
}

export function loadLocalDB() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return emptyDB();
    return normalizeAndMigrateDB(JSON.parse(raw));
  } catch (e) {
    console.error(e);
    return emptyDB();
  }
}

export function setDBState(incoming: any, triggerSave = false) {
  DB = normalizeAndMigrateDB(incoming);
  prevSnapshot = takeSnapshot(DB);
  localStorage.setItem(LS_KEY, JSON.stringify(DB));
  if (triggerSave && onCloudSaveCallback) {
    onCloudSaveCallback(DB);
  }
  if (document.getElementById('content')) {
    goTo(currentPage, currentParams);
  }
}

export function save() {
  // SECURITY LOCK: Non-owner users can NEVER modify DB.appUsers (usernames, passwords, roles)
  if (!activeIsSystemOwner) {
    DB.appUsers = getAppAccounts();
  }
  detectAndLogChanges();
  localStorage.setItem(LS_KEY, JSON.stringify(DB));
  if (onCloudSaveCallback) {
    onCloudSaveCallback(DB);
  }
}

/* ---------------- Toast (AUDIT FIX: XSS-safe textContent) ---------------- */
export function toast(msg: string, isErr = false) {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

/* ---------------- Range filter helpers ---------------- */
export function genRangeBounds(state: any) {
  const now = new Date();
  if (state.preset === 'this_month') return { from: toLocalISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: todayStr() };
  if (state.preset === 'last_month') return { from: toLocalISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: toLocalISODate(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (state.preset === 'this_year') return { from: `${now.getFullYear()}-01-01`, to: todayStr() };
  if (state.preset === 'custom') return { from: state.from || null, to: state.to || null };
  return { from: null, to: null };
}
export function genRangeBarHtml(state: any, prefix: string) {
  return `<select id="${prefix}Preset">
    <option value="all" ${state.preset === 'all' ? 'selected' : ''}>All Time</option>
    <option value="this_month" ${state.preset === 'this_month' ? 'selected' : ''}>This Month</option>
    <option value="last_month" ${state.preset === 'last_month' ? 'selected' : ''}>Last Month</option>
    <option value="this_year" ${state.preset === 'this_year' ? 'selected' : ''}>This Year</option>
    <option value="custom" ${state.preset === 'custom' ? 'selected' : ''}>Custom Range</option>
  </select>
  <input type="date" id="${prefix}From" value="${state.from || ''}" style="display:${state.preset === 'custom' ? 'inline-block' : 'none'}"/>
  <input type="date" id="${prefix}To" value="${state.to || ''}" style="display:${state.preset === 'custom' ? 'inline-block' : 'none'}"/>`;
}
export function genRangeWire(state: any, prefix: string, onPresetChange: () => void, onDateChange?: () => void) {
  document.getElementById(prefix + 'Preset')?.addEventListener('change', (e: any) => { state.preset = e.target.value; onPresetChange(); });
  const f = document.getElementById(prefix + 'From'), t = document.getElementById(prefix + 'To');
  if (f) f.addEventListener('change', (e: any) => { state.from = e.target.value; (onDateChange || onPresetChange)(); });
  if (t) t.addEventListener('change', (e: any) => { state.to = e.target.value; (onDateChange || onPresetChange)(); });
}

/* ---------------- Lookup helpers ---------------- */
export const clientById = (id: string) => DB.clients.find((c: any) => c.id === id);
export const serviceById = (id: string) => DB.services.find((s: any) => s.id === id);
export const invoiceById = (id: string) => DB.invoices.find((i: any) => i.id === id);
export const accountById = (id: string) => DB.accounts.find((a: any) => a.id === id);
export const clientName = (id: string) => { const c = clientById(id); return c ? c.name : '—'; };
export const initials = (name: string) => (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
export const employeePaidTotal = (empId: string) => DB.employeePayments.filter((p: any) => p.employeeId === empId).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

/* ---------------- Computation engine (AUDIT FIXES APPLIED) ---------------- */
/* AUDIT FIX 1: No double taxation! Line-item tax and overall tax are both computed on net-of-discount price,
   and total taxAmt includes BOTH line-level tax and overall invoice tax so VAT Report & Journal are 100% accurate. */
export function invoiceTotals(inv: any) {
  let netItemsSub = 0;
  let lineTaxSum = 0;
  const overallDiscRatio = (Number(inv.discount || 0)) / 100;

  (inv.items || []).forEach((it: any) => {
    const lineBase = (Number(it.qty) || 1) * (Number(it.price) || 0);
    const lineDisc = lineBase * ((Number(it.discount) || 0) / 100);
    const lineNet = lineBase - lineDisc;
    netItemsSub += lineNet;
    const lineAfterOverallDisc = lineNet * (1 - overallDiscRatio);
    lineTaxSum += lineAfterOverallDisc * ((Number(it.tax) || 0) / 100);
  });

  const discAmt = netItemsSub * overallDiscRatio;
  const afterDisc = netItemsSub - discAmt;
  const taxPct = Number(inv.tax || 0);
  const vatMode = inv.vatMode === 'inclusive' ? 'inclusive' : 'exclusive';

  let overallTaxAmt = 0;
  let total = 0;
  if (vatMode === 'inclusive' && taxPct > 0) {
    overallTaxAmt = afterDisc * taxPct / (100 + taxPct);
    total = afterDisc + lineTaxSum;
  } else {
    overallTaxAmt = afterDisc * (taxPct / 100);
    total = afterDisc + lineTaxSum + overallTaxAmt;
  }
  const taxAmt = lineTaxSum + overallTaxAmt;
  const netBeforeVat = total - taxAmt;
  return { subtotal: netItemsSub, discountAmt: discAmt, taxAmt, lineTaxSum, overallTaxAmt, total, vatMode, netBeforeVat };
}

export function invoiceRefunded(invId: string) {
  return (DB.refunds || []).filter((r: any) => r.invoiceId === invId).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
}
export function invoiceGrossPaid(invId: string) {
  return DB.payments.filter((p: any) => p.invoiceId === invId).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
}
export function invoicePaid(invId: string) {
  return invoiceGrossPaid(invId) - invoiceRefunded(invId);
}
export function creditBalance(clientId: string) {
  return (DB.creditLedger || []).filter((c: any) => c.clientId === clientId).reduce((s: number, c: any) => s + (c.type === 'Advance' ? Number(c.amount || 0) : -Number(c.amount || 0)), 0);
}
export function clientOpenInvoices(clientId: string) {
  return DB.invoices.filter((i: any) => i.clientId === clientId && i.status !== 'Cancelled' && (invoiceTotals(i).total - invoicePaid(i.id)) > 0.5)
    .sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''));
}

/* AUDIT FIX 2: Advance Credit Cash-Flow & Balance Sheet Integrity!
   When a client pays an advance with no open invoice, the cash actually enters the selected accountId
   via a creditLedger deposit entry (`accountId`), and when that credit is later applied to an invoice,
   it marks `isCreditApplication: true` and `accountId: ''` so it settles the invoice without double-counting cash inflow! */
export function allocateClientPayment(clientId: string, amount: number, date: string, method: string, accountId: string, notes: string) {
  let remaining = amount;
  const created: any[] = [];
  const groupId = uid('grp');
  clientOpenInvoices(clientId).forEach((inv: any) => {
    if (remaining <= 0.5) return;
    const due = invoiceTotals(inv).total - invoicePaid(inv.id);
    const pay = Math.min(remaining, due);
    if (pay > 0.5) {
      const rec = { id: uid('pay'), invoiceId: inv.id, clientId, amount: Math.round(pay * 100) / 100, date, method, accountId, txnId: '', receivedBy: 'Admin', notes: (notes ? notes + ' — ' : '') + 'Auto-allocated', groupId, groupTotal: amount };
      DB.payments.push(rec);
      created.push({ invoice: inv, amount: rec.amount });
      remaining -= pay;
    }
  });
  let creditAdded = 0;
  if (remaining > 0.5) {
    creditAdded = Math.round(remaining * 100) / 100;
    DB.creditLedger.push({
      id: uid('cr'), clientId, date, amount: creditAdded, type: 'Advance',
      method, accountId: accountId || 'acc_bank',
      notes: notes || 'Advance payment (deposited into account)'
    });
  }
  save();
  return { created, creditAdded };
}

export function applyCreditToInvoice(clientId: string, invoiceId: string, amount: number, date: string) {
  const rec = {
    id: uid('pay'), invoiceId, clientId, amount, date, method: 'Credit',
    accountId: '', isCreditApplication: true,
    txnId: '', receivedBy: 'Admin', notes: 'Applied from advance credit'
  };
  DB.payments.push(rec);
  DB.creditLedger.push({ id: uid('cr'), clientId, date, amount, type: 'Applied', notes: 'Applied to ' + (invoiceById(invoiceId) || {}).number, invoiceId });
  save();
}

export function invoiceStatus(inv: any) {
  if (inv.status === 'Cancelled') return 'Cancelled';
  const total = invoiceTotals(inv).total;
  const paid = invoicePaid(inv.id);
  if (paid <= 0) {
    return (inv.dueDate && inv.dueDate < todayStr()) ? 'Overdue' : 'Pending';
  }
  if (paid >= total - 0.5) return 'Paid';
  return (inv.dueDate && inv.dueDate < todayStr()) ? 'Overdue' : 'Partially Paid';
}

export function statusBadgeClass(st: string) {
  return ({
    'Paid': 'badge-paid', 'Partially Paid': 'badge-partial', 'Pending': 'badge-pending',
    'Overdue': 'badge-overdue', 'Cancelled': 'badge-cancelled', 'Draft': 'badge-draft',
    'Sent': 'badge-sent', 'Accepted': 'badge-accepted', 'Rejected': 'badge-rejected',
    'Converted': 'badge-paid', 'Active': 'badge-active', 'Inactive': 'badge-inactive'
  } as Record<string, string>)[st] || 'badge-pending';
}

export function dueInvoices() {
  return DB.invoices.filter((i: any) => i.status !== 'Cancelled' && ['Pending', 'Partially Paid', 'Overdue'].includes(invoiceStatus(i)));
}

export function clientFinancials(clientId: string) {
  const invs = DB.invoices.filter((i: any) => i.clientId === clientId && i.status !== 'Cancelled');
  const totalBilling = invs.reduce((s: number, i: any) => s + invoiceTotals(i).total, 0);
  const received = invs.reduce((s: number, i: any) => s + invoicePaid(i.id), 0);
  const due = totalBilling - received;
  const expense = DB.expenses.filter((e: any) => e.clientId === clientId).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const profit = totalBilling - expense;
  return { totalBilling, received, due, expense, profit, invoiceCount: invs.length };
}

export function clientAdsFundSummary(clientId: string, from: string | null, to: string | null) {
  const rows = DB.adsFunds.filter((a: any) => a.clientId === clientId && a.type === 'Ad Spend' && (!from || a.date >= from) && (!to || a.date <= to));
  const spend = rows.reduce((s: number, a: any) => s + Number(a.amount || 0), 0);
  return { spend, count: rows.length };
}
export function allClientsAdsFundTotals(from: string | null, to: string | null) {
  let spend = 0, count = 0;
  DB.clients.forEach((c: any) => { const s = clientAdsFundSummary(c.id, from, to); spend += s.spend; count += s.count; });
  return { spend, count };
}

export function expenseCategories() { return DB.expenseCategories || []; }
export function categoryNames() { return expenseCategories().map((c: any) => c.name); }
export function categoryType(name: string) {
  const c = expenseCategories().find((c: any) => c.name.toLowerCase() === String(name || '').trim().toLowerCase());
  return c ? c.type : 'opex';
}
export const isCOS = (name: string) => categoryType(name) === 'cos';
export function typeLabel(t: string) { return EXPENSE_TYPES[t] || EXPENSE_TYPES.opex; }
export function typeBadge(t: string) {
  return t === 'cos'
    ? `<span class="badge badge-amber" title="Direct cost of delivering client work">Cost of Service</span>`
    : `<span class="badge badge-grey" title="Cost of running the agency">Operating</span>`;
}

/* AUDIT FIX 3: Reconciled Income Statement & Balance Sheet!
   1. Cash received (`received`) counts actual cash payments + cash advances deposited, minus refunds (excluding non-cash credit applications).
   2. Refunds issued reduce accrual ` due ` on the invoice (not revenue), unless the invoice is credited/adjusted, so Retained Earnings in Balance Sheet and Net Profit in P&L use the exact same formula (`revenue - expense - salary`). */
export function totalsAcrossRange(dateFrom: string | null, dateTo: string | null) {
  const inRange = (d: string) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
  const revenue = DB.invoices.filter((i: any) => i.status !== 'Cancelled' && inRange(i.date)).reduce((s: number, i: any) => s + invoiceTotals(i).total, 0);
  const cashPayments = DB.payments.filter((p: any) => !p.isCreditApplication && p.method !== 'Credit' && inRange(p.date)).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const cashAdvances = (DB.creditLedger || []).filter((c: any) => c.type === 'Advance' && c.accountId && inRange(c.date)).reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
  const refunded = (DB.refunds || []).filter((r: any) => inRange(r.date)).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  const received = cashPayments + cashAdvances - refunded;

  const expenseList = DB.expenses.filter((e: any) => inRange(e.date));
  const expense = expenseList.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const costOfService = expenseList.filter((e: any) => isCOS(e.category)).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const operatingExpense = expense - costOfService;
  const salary = (DB.employeePayments || []).filter((p: any) => inRange(p.date)).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const totalCost = expense + salary;
  const grossProfit = revenue - costOfService;
  const netProfit = grossProfit - operatingExpense - salary;
  return { revenue, received, refunded, expense, costOfService, operatingExpense, salary, totalCost, grossProfit, netProfit, profit: netProfit };
}

export function accountBalance(accId: string) {
  const acc = accountById(accId);
  if (!acc) return 0;
  let bal = Number(acc.opening || 0);
  DB.payments.filter((p: any) => p.accountId === accId && !p.isCreditApplication).forEach((p: any) => bal += Number(p.amount || 0));
  (DB.creditLedger || []).filter((c: any) => c.type === 'Advance' && c.accountId === accId).forEach((c: any) => bal += Number(c.amount || 0));
  DB.expenses.filter((e: any) => e.accountId === accId).forEach((e: any) => bal -= Number(e.amount || 0));
  (DB.refunds || []).filter((r: any) => r.accountId === accId).forEach((r: any) => bal -= Number(r.amount || 0));
  (DB.employeePayments || []).filter((p: any) => p.accountId === accId).forEach((p: any) => bal -= Number(p.amount || 0));
  DB.transfers.forEach((t: any) => {
    if (t.from === accId) bal -= Number(t.amount || 0);
    if (t.to === accId) bal += Number(t.amount || 0);
  });
  return bal;
}

export function last6Months() {
  const arr = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push({ key: toLocalISODate(d).slice(0, 7), label: d.toLocaleDateString('en-GB', { month: 'short' }) });
  }
  return arr;
}
export function nextInvoiceNumber() {
  DB.invoiceSeq = (DB.invoiceSeq || 1000) + 1;
  return 'INV-' + DB.invoiceSeq;
}
export function nextQuoteNumber() {
  DB.quoteSeq = (DB.quoteSeq || 100) + 1;
  return 'QTE-' + DB.quoteSeq;
}

/* ---------------- Navigation & Modal ---------------- */
export const NAV = [
  { group: 'Overview', items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-gauge-high' },
  ]},
  { group: 'Sales', items: [
    { id: 'clients', label: 'Clients', icon: 'fa-solid fa-users' },
    { id: 'quotations', label: 'Quotations', icon: 'fa-solid fa-file-signature' },
    { id: 'invoices', label: 'Invoices', icon: 'fa-solid fa-file-invoice-dollar' },
    { id: 'recurring', label: 'Recurring Billing', icon: 'fa-solid fa-rotate' },
    { id: 'payments', label: 'Payments', icon: 'fa-solid fa-money-bill-wave' },
    { id: 'due', label: 'Due / Baki', icon: 'fa-solid fa-triangle-exclamation', badgeFn: () => dueInvoices().length },
    { id: 'reminders', label: 'Payment Reminders', icon: 'fa-solid fa-bell' },
  ]},
  { group: 'Catalog', items: [
    { id: 'services', label: 'Services', icon: 'fa-solid fa-layer-group' },
    { id: 'packages', label: 'Packages', icon: 'fa-solid fa-box-archive' },
    { id: 'contracts', label: 'Contracts', icon: 'fa-solid fa-file-contract' },
  ]},
  { group: 'Money', items: [
    { id: 'expenses', label: 'Expenses', icon: 'fa-solid fa-receipt' },
    { id: 'ads-fund', label: 'Client Ads Fund', icon: 'fa-solid fa-bullhorn' },
    { id: 'employees', label: 'Team & Freelancers', icon: 'fa-solid fa-user-tie' },
    { id: 'accounts', label: 'Cash & Bank', icon: 'fa-solid fa-building-columns' },
    { id: 'ledger', label: 'Account Statement', icon: 'fa-solid fa-book' },
  ]},
  { group: 'Insights', items: [
    { id: 'profitability', label: 'Client Profitability', icon: 'fa-solid fa-chart-pie' },
    { id: 'service-profit', label: 'Service-wise Profit', icon: 'fa-solid fa-chart-column' },
    { id: 'reports', label: 'Financial Reports', icon: 'fa-solid fa-file-lines' },
    { id: 'journal', label: 'Journal', icon: 'fa-solid fa-book-journal-whills' },
    { id: 'balance-sheet', label: 'Balance Sheet', icon: 'fa-solid fa-scale-balanced' },
    { id: 'audit-log', label: 'Audit Trail / Activity', icon: 'fa-solid fa-clipboard-check' },
  ]},
];

export let currentPage = 'dashboard';
export let currentParams: any = {};
export const PAGES: Record<string, (root: HTMLElement, params?: any) => void> = {};

export function destroyCharts() {
  Object.values(chartRefs).forEach(c => c && typeof c.destroy === 'function' && c.destroy());
  chartRefs = {};
}
export function registerChart(key: string, instance: any) {
  if (chartRefs[key] && typeof chartRefs[key].destroy === 'function') {
    chartRefs[key].destroy();
  }
  chartRefs[key] = instance;
}

export function renderSidebar() {
  const el = document.getElementById('sidebar');
  if (!el) return;
  let html = `<div class="brand"><img src="${LOGO_DATA_URI}" alt="SkySah" class="brand-mark" style="border:none;box-shadow:none;object-fit:contain;width:40px;height:40px;"/><div><div class="brand-name">SkySah Accounting</div><div class="brand-sub">Agency Accounting</div></div></div>`;
  NAV.forEach(g => {
    const visibleItems = g.items.filter((it: any) => !it.hidden && isPageAllowedForCurrentUser(it.id));
    if (!visibleItems.length) return;
    html += `<div class="nav-group-label">${g.group}</div>`;
    visibleItems.forEach((it: any) => {
      const badge = it.badgeFn ? it.badgeFn() : 0;
      html += `<div class="nav-item ${currentPage === it.id ? 'active' : ''}" data-nav="${it.id}">
        <i class="${it.icon}"></i><span>${it.label}</span>
        ${badge > 0 ? `<span class="nav-badge">${badge}</span>` : ''}
      </div>`;
    });
  });
  el.innerHTML = html;
  el.querySelectorAll('[data-nav]').forEach((n: any) => {
    n.addEventListener('click', () => { goTo(n.dataset.nav); closeMobileDrawer(); });
  });
}

export function closeMobileDrawer() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarBackdrop')?.classList.remove('show');
}

export function goTo(page: string, params: any = {}) {
  destroyCharts();
  if (!isPageAllowedForCurrentUser(page)) {
    const fallback = activeAllowedPages.find(p => p !== '*') || 'dashboard';
    if (page !== fallback && isPageAllowedForCurrentUser(fallback)) {
      toast('এই পেজে আপনার অ্যাক্সেস পারমিশন নেই (Access Denied)', true);
      page = fallback;
      params = {};
    } else {
      currentPage = page;
      renderSidebar();
      const contentEl = document.getElementById('content');
      if (contentEl) {
        contentEl.innerHTML = emptyState('fa-lock', 'এই মডিউলে আপনার অ্যাক্সেস নেই। অ্যাডমিনের সাথে যোগাযোগ করুন।');
      }
      return;
    }
  }
  currentPage = page;
  currentParams = params;
  renderSidebar();
  const titleMap: Record<string, string> = {};
  NAV.forEach(g => g.items.forEach(i => titleMap[i.id] = i.label));
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = titleMap[page] || 'SkySah Accounting';
  const renderFn = PAGES[page];
  const contentEl = document.getElementById('content');
  if (contentEl) {
    contentEl.innerHTML = '';
    if (renderFn) renderFn(contentEl, params);
    if (!canCurrentUserDelete()) {
      contentEl.querySelectorAll('[data-del], [data-delcat], #cancelInvBtn').forEach((btn: any) => {
        btn.style.display = 'none';
      });
    }
  }
  window.scrollTo(0, 0);
}

export function openModal({ title, bodyHtml, footHtml, wide }: { title: string; bodyHtml: string; footHtml?: string; wide?: boolean }) {
  const t = document.getElementById('modalTitle');
  const b = document.getElementById('modalBody');
  const f = document.getElementById('modalFoot');
  const m = document.getElementById('modal');
  const o = document.getElementById('modalOverlay');
  if (t) t.textContent = title;
  if (b) b.innerHTML = bodyHtml;
  if (f) f.innerHTML = footHtml || '';
  if (m) m.classList.toggle('wide', !!wide);
  if (o) o.classList.add('show');
}
export function closeModal() {
  document.getElementById('modalOverlay')?.classList.remove('show');
}
export function confirmAction(msg: string, onYes: () => void) {
  openModal({
    title: 'নিশ্চিত করুন',
    bodyHtml: `<p style="font-size:14px;">${escapeHtml(msg)}</p>`,
    footHtml: `<button class="btn" id="cfNo">বাতিল</button><button class="btn btn-danger" id="cfYes" style="border-color:var(--red);">নিশ্চিত / Confirm</button>`
  });
  const noBtn = document.getElementById('cfNo');
  const yesBtn = document.getElementById('cfYes');
  if (noBtn) noBtn.onclick = closeModal;
  if (yesBtn) yesBtn.onclick = () => { closeModal(); onYes(); };
}
export function emptyState(icon: string, text: string) {
  return `<div class="empty-state"><i class="${icon.startsWith('fa-') ? 'fa-solid ' + icon : icon}"></i>${text}</div>`;
}
export function downloadCSV(rows: any[][], filename: string) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported ' + filename);
}
export function loadSampleToDB() {
  const preservedUsers = Array.isArray(DB.appUsers) ? [...DB.appUsers] : [];
  const sample = buildSampleData(emptyDB, isCOS, invoiceTotals);
  sample.appUsers = preservedUsers;
  setDBState(sample, true);
}
