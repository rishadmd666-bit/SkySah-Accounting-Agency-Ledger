import { BDT, toLocalISODate, todayStr, monthKey, fmtDate, daysBetween, escapeHtml } from './ledgerHelpers';
import {
  DB, save, toast, PAGES, goTo, openModal, closeModal, emptyState, downloadCSV,
  genRangeBounds, genRangeBarHtml, genRangeWire, serviceById, invoiceById, accountById,
  clientName, invoiceTotals, invoicePaid, creditBalance, dueInvoices, clientFinancials,
  clientAdsFundSummary, allClientsAdsFundTotals, categoryType, typeLabel,
  totalsAcrossRange, accountBalance
} from './ledgerCore';
import { printGenericReportDoc } from './ledgerPrinters';
import { exportInvoicesCSV } from './ledgerPagesSales';

/* ========================= CLIENT PROFITABILITY ========================= */
PAGES['profitability'] = function (root) {
  const rows = DB.clients.map((c: any) => ({ c, f: clientFinancials(c.id) })).sort((a: any, b: any) => b.f.profit - a.f.profit);
  root.innerHTML = `
    <div class="section-head"><div><h2>Client Profitability</h2><div class="desc">Revenue vs allocated cost per client</div></div></div>
    <div class="panel"><div class="panel-body table-wrap">
    ${!rows.length ? emptyState('fa-chart-pie', 'কোনো client নেই।') : `<table><thead><tr><th>Client</th><th class="num">Revenue</th><th class="num">Cost</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead><tbody>
      ${rows.map(({ c, f }: any) => {
        const margin = f.totalBilling ? Math.round(f.profit / f.totalBilling * 100) : 0;
        return `<tr><td style="font-weight:600;cursor:pointer;" data-view="${c.id}">${escapeHtml(c.name)}</td><td class="num">${BDT(f.totalBilling)}</td><td class="num">${BDT(f.expense)}</td>
        <td class="num ${f.profit >= 0 ? 'profit-pos' : 'profit-neg'}">${BDT(f.profit)}</td><td class="num ${margin >= 0 ? 'profit-pos' : 'profit-neg'}">${margin}%</td></tr>`;
      }).join('')}
    </tbody>
    <tfoot class="total-foot"><tr>
      <td>TOTAL (${rows.length} clients)</td>
      <td class="num">${BDT(rows.reduce((s: number, r: any) => s + r.f.totalBilling, 0))}</td>
      <td class="num">${BDT(rows.reduce((s: number, r: any) => s + r.f.expense, 0))}</td>
      <td class="num ${rows.reduce((s: number, r: any) => s + r.f.profit, 0) >= 0 ? 'profit-pos' : 'profit-neg'}">${BDT(rows.reduce((s: number, r: any) => s + r.f.profit, 0))}</td>
      <td class="num">${(() => { const rv = rows.reduce((s: number, r: any) => s + r.f.totalBilling, 0); const pf = rows.reduce((s: number, r: any) => s + r.f.profit, 0); return rv ? Math.round(pf / rv * 100) : 0; })()}%</td>
    </tr></tfoot></table>`}
    </div></div>
  `;
  root.querySelectorAll('[data-view]').forEach((b: any) => b.addEventListener('click', () => goTo('clients', { view: b.dataset.view })));
};

/* ========================= SERVICE-WISE PROFIT ========================= */
const svcProfitRangeState = { preset: 'all', from: '', to: '' };
PAGES['service-profit'] = function (root) {
  const { from, to } = genRangeBounds(svcProfitRangeState);
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
  const map: Record<string, any> = {};
  DB.invoices.filter((i: any) => i.status !== 'Cancelled' && inRange(i.date)).forEach((i: any) => (i.items || []).forEach((it: any) => {
    const svc = serviceById(it.serviceId);
    const key = it.name || (svc || {}).name || 'Other';
    const qty = Number(it.qty || 1);
    const revenue = qty * (it.price || 0) * (1 - (it.discount || 0) / 100) * (1 + (it.tax || 0) / 100);
    const cost = svc ? (svc.cost || 0) * qty : 0;
    if (!map[key]) map[key] = { revenue: 0, cost: 0, qty: 0, isPackage: !!it.isPackage };
    map[key].revenue += revenue; map[key].cost += cost; map[key].qty += qty;
  }));
  const entries = Object.entries(map).sort((a, b) => b[1].revenue - a[1].revenue);
  const rangeLabel = !from && !to ? 'All Time' : `${from ? fmtDate(from) : '…'} — ${to ? fmtDate(to) : '…'}`;
  root.innerHTML = `
    <div class="section-head"><div><h2>Service-wise Profit</h2><div class="desc">কোন সার্ভিস বা প্যাকেজ থেকে সবচেয়ে বেশি বিক্রি ও লাভ আসছে — ${rangeLabel}</div></div></div>
    <div class="filter-bar">${genRangeBarHtml(svcProfitRangeState, 'svcp')}</div>
    <div class="panel"><div class="panel-body table-wrap">
    ${!entries.length ? emptyState('fa-chart-column', 'এই সময়সীমায় কোনো ইনভয়েস ডেটা নেই।') : `<table><thead><tr><th>Name</th><th>Type</th><th class="num">Qty Sold</th><th class="num">Revenue</th><th class="num">Cost</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead><tbody>
      ${entries.map(([name, v]: any) => {
        const profit = v.revenue - v.cost; const margin = v.revenue ? Math.round(profit / v.revenue * 100) : 0;
        return `<tr><td style="font-weight:600;">${escapeHtml(name)}</td><td>${v.isPackage ? `<span class="pill">📦 Package</span>` : `<span class="pill">Service</span>`}</td><td class="num">${v.qty}</td><td class="num">${BDT(v.revenue)}</td><td class="num">${BDT(v.cost)}</td><td class="num ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">${BDT(profit)}</td><td class="num ${margin >= 0 ? 'profit-pos' : 'profit-neg'}">${margin}%</td></tr>`;
      }).join('')}
    </tbody></table>`}
    </div></div>
  `;
  genRangeWire(svcProfitRangeState, 'svcp', () => goTo('service-profit'));
};

/* ========================= FINANCIAL REPORTS ========================= */
const reportRangeState = { preset: 'all', from: '', to: '', tab: 'all' };
let reportGroupBy = 'month';

function renderAgingReport() {
  const list = dueInvoices();
  const today = todayStr();
  const buckets: Record<string, number> = { 'Current (not yet due)': 0, '1-30 days': 0, '31-60 days': 0, '61-90 days': 0, '90+ days': 0 };
  const counts: Record<string, number> = { 'Current (not yet due)': 0, '1-30 days': 0, '31-60 days': 0, '61-90 days': 0, '90+ days': 0 };
  list.forEach((i: any) => {
    const due = invoiceTotals(i).total - invoicePaid(i.id);
    const overdueDays = daysBetween(i.dueDate, today);
    let key;
    if (overdueDays <= 0) key = 'Current (not yet due)';
    else if (overdueDays <= 30) key = '1-30 days';
    else if (overdueDays <= 60) key = '31-60 days';
    else if (overdueDays <= 90) key = '61-90 days';
    else key = '90+ days';
    buckets[key] += due; counts[key] += 1;
  });
  const grandTotal = Object.values(buckets).reduce((s, v) => s + v, 0);
  const dashboardDue = DB.invoices.filter((i: any) => i.status !== 'Cancelled').reduce((s: number, i: any) => s + (invoiceTotals(i).total - invoicePaid(i.id)), 0);
  const rows = Object.entries(buckets).map(([k, v]) => `<tr><td>${k}</td><td class="num">${counts[k]}</td><td class="num" style="${k !== 'Current (not yet due)' ? 'color:var(--red)' : ''}">${BDT(v)}</td></tr>`).join('');
  return `<table><thead><tr><th>Age Bucket</th><th class="num">Invoices</th><th class="num">Outstanding</th></tr></thead><tbody>${rows}</tbody>
    <tfoot class="total-foot"><tr><td>TOTAL OUTSTANDING</td><td class="num">${list.length}</td><td class="num" style="color:var(--red);">${BDT(grandTotal)}</td></tr></tfoot></table>
    <div class="hint" style="margin-top:8px;">Cross-check: Dashboard "Total Due" = ${BDT(dashboardDue)} ${Math.abs(dashboardDue - grandTotal) < 1 ? '✅ matches this report' : '⚠️ mismatch'}</div>`;
}

PAGES['reports'] = function (root) {
  const REPORT_TABS = [
    ['all', 'All Reports (Complete)'],
    ['pnl', 'Profit & Loss + Cash Flow'],
    ['period', 'Month / Day Breakdown'],
    ['clients', 'Client-wise Report'],
    ['services', 'Service-wise Report'],
    ['expenses', 'Expense & Payroll Report'],
    ['ads', 'Client Ad Spend Report'],
    ['vat_aging', 'VAT & Aging Report'],
  ];
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Financial Reports</h2><div class="desc">Profit & Loss, Cash Flow, Client-wise, Service-wise, Expense, Payroll, Ad Spend, Aging ও VAT — সব ধরনের রিপোর্ট এক জায়গায়</div></div>
      <div class="section-actions">
        <button class="btn btn-gold" id="printReportBtn"><i class="fa-solid fa-file-pdf"></i> Print / Save as PDF</button>
        <button class="btn" id="expInv"><i class="fa-solid fa-download"></i> Invoices CSV</button>
        <button class="btn" id="expExp"><i class="fa-solid fa-download"></i> Expenses CSV</button>
        <button class="btn" id="expPay"><i class="fa-solid fa-download"></i> Payments CSV</button>
        <button class="btn" id="expAds"><i class="fa-solid fa-download"></i> Ads Spend CSV</button>
      </div>
    </div>
    <div class="filter-bar">${genRangeBarHtml(reportRangeState, 'rep')}</div>
    <div class="tabs" id="reportTypeTabs">
      ${REPORT_TABS.map(([k, l]) => `<div class="tab ${reportRangeState.tab === k ? 'active' : ''}" data-rtab="${k}">${l}</div>`).join('')}
    </div>
    <div id="reportsBody"></div>
  `;
  document.getElementById('expInv')?.addEventListener('click', exportInvoicesCSV);
  document.getElementById('expExp')?.addEventListener('click', () => {
    const rows: any[][] = [['Date', 'Category', 'Type', 'Amount', 'Vendor', 'Method', 'Client', 'Description']];
    DB.expenses.forEach((e: any) => rows.push([e.date, e.category, typeLabel(categoryType(e.category)), e.amount, e.vendor || '', e.method || '', e.clientId ? clientName(e.clientId) : '', e.description || '']));
    downloadCSV(rows, 'expenses.csv');
  });
  document.getElementById('expPay')?.addEventListener('click', () => {
    const rows: any[][] = [['Date', 'Client', 'Invoice', 'Amount', 'Method', 'Account']];
    DB.payments.forEach((p: any) => rows.push([p.date, clientName(p.clientId), (invoiceById(p.invoiceId) || {}).number || '', p.amount, p.method, (accountById(p.accountId) || {}).name || '']));
    downloadCSV(rows, 'payments.csv');
  });
  document.getElementById('expAds')?.addEventListener('click', () => {
    const rows: any[][] = [['Date', 'Month', 'Client', 'Platform', 'Amount', 'Notes']];
    (DB.adsFunds || []).forEach((a: any) => rows.push([a.date, monthKey(a.date), clientName(a.clientId), a.platform || '', a.amount, a.notes || '']));
    downloadCSV(rows, 'ads-spend-report.csv');
  });
  document.querySelectorAll('#reportTypeTabs .tab').forEach((t: any) => t.addEventListener('click', () => {
    reportRangeState.tab = t.dataset.rtab;
    document.querySelectorAll('#reportTypeTabs .tab').forEach(el => el.classList.remove('active'));
    t.classList.add('active');
    renderReportsBody();
  }));
  genRangeWire(reportRangeState, 'rep', () => goTo('reports'), renderReportsBody);
  renderReportsBody();
};

function renderReportsBody() {
  const body = document.getElementById('reportsBody');
  if (!body) return;
  const { from, to } = genRangeBounds(reportRangeState);
  const totals = totalsAcrossRange(from, to);
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
  const mrr = DB.clients.filter((c: any) => c.status === 'Active').reduce((s: number, c: any) => s + Number(c.monthlyPackage || 0), 0);
  const collected = DB.payments.filter((p: any) => !p.isCreditApplication && monthKey(p.date) === monthKey(todayStr())).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const groupKey = (d: string) => reportGroupBy === 'day' ? d : monthKey(d);
  const groupLabel = (k: string) => reportGroupBy === 'day' ? fmtDate(k) : new Date(k + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // 1. Month-wise / Day-wise Revenue, COS, OPEX, Salary, Profit, Cash In, Ad Spend
  const buckets: Record<string, { rev: number; cos: number; opex: number; sal: number; rec: number; ads: number }> = {};
  const ensureBucket = (k: string) => {
    if (!buckets[k]) buckets[k] = { rev: 0, cos: 0, opex: 0, sal: 0, rec: 0, ads: 0 };
    return buckets[k];
  };
  DB.invoices.filter((i: any) => i.status !== 'Cancelled' && inRange(i.date)).forEach((i: any) => { ensureBucket(groupKey(i.date)).rev += invoiceTotals(i).total; });
  DB.payments.filter((p: any) => !p.isCreditApplication && p.method !== 'Credit' && inRange(p.date)).forEach((p: any) => { ensureBucket(groupKey(p.date)).rec += Number(p.amount || 0); });
  (DB.creditLedger || []).filter((c: any) => c.type === 'Advance' && c.accountId && inRange(c.date)).forEach((c: any) => { ensureBucket(groupKey(c.date)).rec += Number(c.amount || 0); });
  (DB.refunds || []).filter((r: any) => inRange(r.date)).forEach((r: any) => { ensureBucket(groupKey(r.date)).rec -= Number(r.amount || 0); });
  DB.expenses.filter((e: any) => inRange(e.date)).forEach((e: any) => {
    const b = ensureBucket(groupKey(e.date));
    if (categoryType(e.category) === 'cos') b.cos += Number(e.amount || 0);
    else b.opex += Number(e.amount || 0);
  });
  (DB.employeePayments || []).filter((p: any) => inRange(p.date)).forEach((p: any) => { ensureBucket(groupKey(p.date)).sal += Number(p.amount || 0); });
  (DB.adsFunds || []).filter((a: any) => inRange(a.date)).forEach((a: any) => { ensureBucket(groupKey(a.date)).ads += Number(a.amount || 0); });

  const bucketKeys = Object.keys(buckets).sort();
  const bucketRows = bucketKeys.map(k => {
    const b = buckets[k];
    const totalExp = b.cos + b.opex + b.sal;
    const gross = b.rev - b.cos;
    const net = b.rev - totalExp;
    return `<tr>
      <td style="font-weight:600;">${groupLabel(k)}</td>
      <td class="num">${BDT(b.rev)}</td>
      <td class="num" style="color:var(--teal);">${BDT(b.rec)}</td>
      <td class="num">${BDT(b.cos)}</td>
      <td class="num">${BDT(b.opex)}</td>
      <td class="num">${BDT(b.sal)}</td>
      <td class="num">${BDT( gross )}</td>
      <td class="num ${net >= 0 ? 'profit-pos' : 'profit-neg'}">${BDT(net)}</td>
      <td class="num" style="color:var(--gold-deep);">${BDT(b.ads)}</td>
    </tr>`;
  }).join('');

  // 2. Expense Report by Category
  const catMap: Record<string, number> = {};
  DB.expenses.filter((e: any) => inRange(e.date)).forEach((e: any) => { catMap[e.category] = (catMap[e.category] || 0) + Number(e.amount || 0); });
  let catRows = '';
  ['cos', 'opex'].forEach(t => {
    const entries = Object.entries(catMap).filter(([c]) => categoryType(c) === t).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return;
    const sub = entries.reduce((s, [, a]) => s + a, 0);
    catRows += `<tr class="group-head"><td colspan="3">${typeLabel(t)}</td></tr>`;
    catRows += entries.map(([cat, amt]) => `<tr><td>${escapeHtml(cat)}</td><td class="num">${BDT(amt)}</td><td class="num">${totals.expense ? (amt / totals.expense * 100).toFixed(1) : 0}%</td></tr>`).join('');
    catRows += `<tr class="group-sub"><td>${typeLabel(t)} Subtotal</td><td class="num">${BDT(sub)}</td><td class="num">${totals.expense ? (sub / totals.expense * 100).toFixed(1) : 0}%</td></tr>`;
  });

  // 3. Client-wise Financial Report (in selected range)
  const clientReportRows = DB.clients.map((c: any) => {
    const cInvs = DB.invoices.filter((i: any) => i.clientId === c.id && i.status !== 'Cancelled' && inRange(i.date));
    const billed = cInvs.reduce((s: number, i: any) => s + invoiceTotals(i).total, 0);
    const paidOnInvs = cInvs.reduce((s: number, i: any) => s + invoicePaid(i.id), 0);
    const due = billed - paidOnInvs;
    const allocExp = DB.expenses.filter((e: any) => e.clientId === c.id && inRange(e.date)).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
    const adSpend = (DB.adsFunds || []).filter((a: any) => a.clientId === c.id && inRange(a.date)).reduce((s: number, a: any) => s + Number(a.amount || 0), 0);
    const profit = billed - allocExp;
    const margin = billed ? Math.round(profit / billed * 100) : 0;
    return { c, invCount: cInvs.length, billed, paidOnInvs, due, allocExp, adSpend, profit, margin };
  }).filter((r: any) => r.billed > 0 || r.allocExp > 0 || r.adSpend > 0 || reportRangeState.preset === 'all')
    .sort((a: any, b: any) => b.billed - a.billed);

  // 4. Service & Package Breakdown Report (in selected range)
  const svcMap: Record<string, { qty: number; rev: number; cost: number; isPkg: boolean }> = {};
  DB.invoices.filter((i: any) => i.status !== 'Cancelled' && inRange(i.date)).forEach((i: any) => {
    const oDisc = (Number(i.discount || 0)) / 100;
    (i.items || []).forEach((it: any) => {
      const svc = serviceById(it.serviceId);
      const name = it.name || (svc || {}).name || 'Other';
      const qty = Number(it.qty || 1);
      const lineNet = qty * (Number(it.price) || 0) * (1 - (Number(it.discount) || 0) / 100) * (1 - oDisc);
      const lineTax = lineNet * ((Number(it.tax) || 0) / 100);
      const cost = svc ? (Number(svc.cost) || 0) * qty : 0;
      if (!svcMap[name]) svcMap[name] = { qty: 0, rev: 0, cost: 0, isPkg: !!it.isPackage };
      svcMap[name].qty += qty;
      svcMap[name].rev += lineNet + lineTax;
      svcMap[name].cost += cost;
    });
  });
  const svcEntries = Object.entries(svcMap).sort((a, b) => b[1].rev - a[1].rev);

  // 5. Cash Flow & Payment Method / Account Breakdown
  const cashInPayments = DB.payments.filter((p: any) => !p.isCreditApplication && p.method !== 'Credit' && inRange(p.date)).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const cashInAdvances = (DB.creditLedger || []).filter((c: any) => c.type === 'Advance' && c.accountId && inRange(c.date)).reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
  const cashOutRefunds = (DB.refunds || []).filter((r: any) => inRange(r.date)).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  const cashOutExpenses = DB.expenses.filter((e: any) => inRange(e.date)).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const cashOutSalary = (DB.employeePayments || []).filter((p: any) => inRange(p.date)).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const netCashFlow = (cashInPayments + cashInAdvances) - (cashOutRefunds + cashOutExpenses + cashOutSalary);

  const methodMap: Record<string, { inAmt: number; outAmt: number; count: number }> = {};
  const addMethod = (m: string, inAmt: number, outAmt: number) => {
    const k = m || 'Other';
    if (!methodMap[k]) methodMap[k] = { inAmt: 0, outAmt: 0, count: 0 };
    methodMap[k].inAmt += inAmt;
    methodMap[k].outAmt += outAmt;
    methodMap[k].count += 1;
  };
  DB.payments.filter((p: any) => !p.isCreditApplication && p.method !== 'Credit' && inRange(p.date)).forEach((p: any) => addMethod(p.method, Number(p.amount || 0), 0));
  (DB.creditLedger || []).filter((c: any) => c.type === 'Advance' && c.accountId && inRange(c.date)).forEach((c: any) => addMethod(c.method || 'Bank', Number(c.amount || 0), 0));
  DB.expenses.filter((e: any) => inRange(e.date)).forEach((e: any) => addMethod(e.method || 'Bank', 0, Number(e.amount || 0)));
  (DB.refunds || []).filter((r: any) => inRange(r.date)).forEach((r: any) => addMethod(r.method || 'Bank', 0, Number(r.amount || 0)));
  (DB.employeePayments || []).filter((p: any) => inRange(p.date)).forEach((p: any) => addMethod((accountById(p.accountId) || {}).name || 'Bank', 0, Number(p.amount || 0)));

  // 6. Team & Freelancer Payroll Report
  const empReportRows = DB.employees.map((e: any) => {
    const paidPeriod = (DB.employeePayments || []).filter((p: any) => p.employeeId === e.id && inRange(p.date)).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    const paidAll = (DB.employeePayments || []).filter((p: any) => p.employeeId === e.id).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    const committed = Number(e.salary || 0) + Number(e.bonus || 0);
    const due = Math.max(committed - paidAll, 0);
    return { e, paidPeriod, paidAll, committed, due };
  });

  // 7. Client Ad Spend Summary (Client & Platform)
  const adsAll = allClientsAdsFundTotals(from, to);
  const adsFiltered = (DB.adsFunds || []).filter((a: any) => inRange(a.date));
  const adsByClient: Record<string, { spend: number; count: number; platforms: Set<string> }> = {};
  const adsByPlat: Record<string, { spend: number; count: number }> = {};
  adsFiltered.forEach((a: any) => {
    const cid = a.clientId || 'unknown';
    if (!adsByClient[cid]) adsByClient[cid] = { spend: 0, count: 0, platforms: new Set() };
    adsByClient[cid].spend += Number(a.amount || 0);
    adsByClient[cid].count += 1;
    if (a.platform) adsByClient[cid].platforms.add(a.platform);

    const p = a.platform || 'Other';
    if (!adsByPlat[p]) adsByPlat[p] = { spend: 0, count: 0 };
    adsByPlat[p].spend += Number(a.amount || 0);
    adsByPlat[p].count += 1;
  });

  const rangeLabel = !from && !to ? 'All Time' : `${from ? fmtDate(from) : '…'} — ${to ? fmtDate(to) : '…'}`;
  const taxTotal = DB.invoices.filter((i: any) => i.status !== 'Cancelled' && inRange(i.date)).reduce((s: number, i: any) => s + invoiceTotals(i).taxAmt, 0);
  const inputVat = DB.expenses.filter((e: any) => e.vatEligible && inRange(e.date)).reduce((s: number, e: any) => s + Number(e.vatAmount || 0), 0);
  const netVat = taxTotal - inputVat;
  const agingHtml = renderAgingReport();

  const tab = reportRangeState.tab || 'all';
  const show = (section: string) => tab === 'all' || tab === section;

  const pnlAndCashFlowHtml = `
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Income Statement / Profit & Loss (${rangeLabel})</h3><span class="pill">Accrual Basis</span></div>
        <div class="panel-body">
          <div class="stat-line"><span class="muted">Revenue (Total Billed)</span><b class="num">${BDT(totals.revenue)}</b></div>
          <div class="stat-line"><span class="muted">Less: Cost of Service (Direct Client Cost)</span><b class="num" style="color:var(--red)">- ${BDT(totals.costOfService)}</b></div>
          <div class="stat-line" style="border-top:2px solid var(--ink);margin-top:4px;padding-top:8px;"><span style="font-weight:700;">Gross Profit</span><b class="num" style="font-weight:700;">${BDT(totals.grossProfit)} (${totals.revenue ? Math.round(totals.grossProfit / totals.revenue * 100) : 0}%)</b></div>
          <div class="stat-line" style="margin-top:8px;"><span class="muted">Less: Operating Expenses (OPEX)</span><b class="num" style="color:var(--red)">- ${BDT(totals.operatingExpense)}</b></div>
          <div class="stat-line"><span class="muted">Less: Team & Freelancer Salary</span><b class="num" style="color:var(--red)">- ${BDT(totals.salary)}</b></div>
          <div class="stat-line" style="border-top:2px solid var(--ink);margin-top:4px;padding-top:8px;"><span style="font-weight:700;">Net Profit</span><b class="num ${totals.netProfit >= 0 ? 'profit-pos' : 'profit-neg'}" style="font-weight:700;">${BDT(totals.netProfit)} (${totals.revenue ? Math.round(totals.netProfit / totals.revenue * 100) : 0}%)</b></div>
        </div></div>
      <div class="panel"><div class="panel-head"><h3>Cash Flow Statement (${rangeLabel})</h3><span class="pill">Cash Basis</span></div>
        <div class="panel-body">
          <div class="stat-line"><span class="muted">Cash In — Invoice Payments Collected</span><b class="num" style="color:var(--teal)">+ ${BDT(cashInPayments)}</b></div>
          <div class="stat-line"><span class="muted">Cash In — Client Advances Received</span><b class="num" style="color:var(--teal)">+ ${BDT(cashInAdvances)}</b></div>
          <div class="stat-line"><span class="muted">Less: Client Refunds Issued</span><b class="num" style="color:var(--red)">- ${BDT(cashOutRefunds)}</b></div>
          <div class="stat-line" style="border-top:1px dashed var(--line);padding-top:6px;"><span style="font-weight:600;">Net Cash Inflow from Clients</span><b class="num" style="color:var(--teal);font-weight:700;">${BDT(totals.received)}</b></div>
          <div class="stat-line" style="margin-top:6px;"><span class="muted">Less: Cash Paid for Expenses (COS + OPEX)</span><b class="num" style="color:var(--red)">- ${BDT(cashOutExpenses)}</b></div>
          <div class="stat-line"><span class="muted">Less: Cash Paid for Team & Freelancers</span><b class="num" style="color:var(--red)">- ${BDT(cashOutSalary)}</b></div>
          <div class="stat-line" style="border-top:2px solid var(--ink);margin-top:4px;padding-top:8px;"><span style="font-weight:700;">Net Cash Flow (${rangeLabel})</span><b class="num ${netCashFlow >= 0 ? 'profit-pos' : 'profit-neg'}" style="font-weight:700;">${BDT(netCashFlow)}</b></div>
        </div></div>
    </div>
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Cash & Bank Account Balances (Current)</h3></div>
        <div class="panel-body table-wrap">
          <table><thead><tr><th>Account</th><th>Type</th><th class="num">Opening</th><th class="num">Current Balance</th></tr></thead><tbody>
            ${DB.accounts.map((a: any) => `<tr><td style="font-weight:600;">${escapeHtml(a.name)}</td><td><span class="pill">${escapeHtml(a.type)}</span></td><td class="num">${BDT(a.opening || 0)}</td><td class="num" style="font-weight:700;">${BDT(accountBalance(a.id))}</td></tr>`).join('')}
          </tbody><tfoot class="total-foot"><tr><td colspan="2">TOTAL CASH & BANK</td><td class="num">${BDT(DB.accounts.reduce((s: number, a: any) => s + Number(a.opening || 0), 0))}</td><td class="num" style="color:var(--teal);">${BDT(DB.accounts.reduce((s: number, a: any) => s + accountBalance(a.id), 0))}</td></tr></tfoot></table>
        </div></div>
      <div class="panel"><div class="panel-head"><h3>Payment Method Breakdown (${rangeLabel})</h3></div>
        <div class="panel-body table-wrap">
          ${Object.keys(methodMap).length ? `<table><thead><tr><th>Method</th><th class="num">Txns</th><th class="num">Money In</th><th class="num">Money Out</th><th class="num">Net</th></tr></thead><tbody>
            ${Object.entries(methodMap).sort((a, b) => (b[1].inAmt + b[1].outAmt) - (a[1].inAmt + a[1].outAmt)).map(([m, v]) => `<tr><td style="font-weight:600;">${escapeHtml(m)}</td><td class="num">${v.count}</td><td class="num" style="color:var(--teal);">${BDT(v.inAmt)}</td><td class="num" style="color:var(--red);">${BDT(v.outAmt)}</td><td class="num" style="font-weight:600;">${BDT(v.inAmt - v.outAmt)}</td></tr>`).join('')}
          </tbody></table>` : emptyState('fa-credit-card', 'এই সময়সীমায় কোনো লেনদেন নেই।')}
        </div></div>
    </div>
  `;

  const periodBreakdownHtml = `
    <div class="panel"><div class="panel-head"><h3>${reportGroupBy === 'day' ? 'Day-wise' : 'Month-wise'} Complete Financial Breakdown (Revenue, Cost, Profit, Cash In & Ad Spend)</h3>
      <select id="groupByToggle" style="padding:5px 9px;border:1px solid var(--line);border-radius:var(--radius);font-size:12.5px;">
        <option value="month" ${reportGroupBy === 'month' ? 'selected' : ''}>Group by Month</option>
        <option value="day" ${reportGroupBy === 'day' ? 'selected' : ''}>Group by Day</option>
      </select></div>
      <div class="panel-body table-wrap">${bucketRows ? `<table><thead><tr><th>${reportGroupBy === 'day' ? 'Date' : 'Month'}</th><th class="num">Revenue (Billed)</th><th class="num">Cash Received</th><th class="num">Cost of Service</th><th class="num">OPEX</th><th class="num">Salary</th><th class="num">Gross Profit</th><th class="num">Net Profit</th><th class="num">Ad Spend (Log)</th></tr></thead><tbody>${bucketRows}</tbody>
      <tfoot class="total-foot"><tr><td>TOTAL (${bucketKeys.length})</td><td class="num">${BDT(totals.revenue)}</td><td class="num" style="color:var(--teal);">${BDT(totals.received)}</td><td class="num">${BDT(totals.costOfService)}</td><td class="num">${BDT(totals.operatingExpense)}</td><td class="num">${BDT(totals.salary)}</td><td class="num">${BDT(totals.grossProfit)}</td><td class="num ${totals.netProfit >= 0 ? 'profit-pos' : 'profit-neg'}">${BDT(totals.netProfit)}</td><td class="num" style="color:var(--gold-deep);">${BDT(adsAll.spend)}</td></tr></tfoot></table>` : emptyState('fa-calendar', 'এই সময়সীমায় কোনো ডেটা নেই।')}</div></div>
  `;

  const clientReportHtml = `
    <div class="panel"><div class="panel-head"><h3>Client-wise Financial Report (${rangeLabel})</h3><span class="muted" style="font-size:12px;">Billing, Received, Due, Allocated Cost, Net Profit ও Ad Spend</span></div>
      <div class="panel-body table-wrap">
        ${clientReportRows.length ? `<table><thead><tr><th>Client</th><th>Status</th><th class="num">Invoices</th><th class="num">Billed</th><th class="num">Received</th><th class="num">Due</th><th class="num">Allocated Cost</th><th class="num">Client Profit</th><th class="num">Margin</th><th class="num">Ad Spend (Log)</th></tr></thead><tbody>
          ${clientReportRows.map((r: any) => `<tr>
            <td style="font-weight:600;cursor:pointer;" data-client-go="${r.c.id}">${escapeHtml(r.c.name)}</td>
            <td><span class="badge ${r.c.status === 'Active' ? 'badge-active' : 'badge-inactive'}">${escapeHtml(r.c.status)}</span></td>
            <td class="num">${r.invCount}</td>
            <td class="num">${BDT(r.billed)}</td>
            <td class="num" style="color:var(--teal);">${BDT(r.paidOnInvs)}</td>
            <td class="num" style="color:${r.due > 0.5 ? 'var(--red)' : 'var(--muted)'};">${BDT(r.due)}</td>
            <td class="num">${BDT(r.allocExp)}</td>
            <td class="num ${r.profit >= 0 ? 'profit-pos' : 'profit-neg'}">${BDT(r.profit)}</td>
            <td class="num ${r.margin >= 0 ? 'profit-pos' : 'profit-neg'}">${r.margin}%</td>
            <td class="num" style="color:var(--gold-deep);">${BDT(r.adSpend)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot class="total-foot"><tr>
          <td colspan="2">TOTAL (${clientReportRows.length} clients)</td>
          <td class="num">${clientReportRows.reduce((s: number, r: any) => s + r.invCount, 0)}</td>
          <td class="num">${BDT(clientReportRows.reduce((s: number, r: any) => s + r.billed, 0))}</td>
          <td class="num" style="color:var(--teal);">${BDT(clientReportRows.reduce((s: number, r: any) => s + r.paidOnInvs, 0))}</td>
          <td class="num" style="color:var(--red);">${BDT(clientReportRows.reduce((s: number, r: any) => s + r.due, 0))}</td>
          <td class="num">${BDT(clientReportRows.reduce((s: number, r: any) => s + r.allocExp, 0))}</td>
          <td class="num">${BDT(clientReportRows.reduce((s: number, r: any) => s + r.profit, 0))}</td>
          <td></td>
          <td class="num" style="color:var(--gold-deep);">${BDT(clientReportRows.reduce((s: number, r: any) => s + r.adSpend, 0))}</td>
        </tr></tfoot></table>` : emptyState('fa-users', 'এই সময়সীমায় কোনো ক্লায়েন্ট ডেটা নেই।')}
      </div></div>
  `;

  const serviceReportHtml = `
    <div class="panel"><div class="panel-head"><h3>Service & Package Sales Report (${rangeLabel})</h3></div>
      <div class="panel-body table-wrap">
        ${svcEntries.length ? `<table><thead><tr><th>Service / Package</th><th>Type</th><th class="num">Qty Sold</th><th class="num">Revenue</th><th class="num">Allocated Cost</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead><tbody>
          ${svcEntries.map(([name, v]) => {
            const pf = v.rev - v.cost;
            const mg = v.rev ? Math.round(pf / v.rev * 100) : 0;
            return `<tr><td style="font-weight:600;">${escapeHtml(name)}</td><td><span class="pill">${v.isPkg ? '📦 Package' : 'Service'}</span></td><td class="num">${v.qty}</td><td class="num">${BDT(v.rev)}</td><td class="num">${BDT(v.cost)}</td><td class="num ${pf >= 0 ? 'profit-pos' : 'profit-neg'}">${BDT(pf)}</td><td class="num ${mg >= 0 ? 'profit-pos' : 'profit-neg'}">${mg}%</td></tr>`;
          }).join('')}
        </tbody>
        <tfoot class="total-foot"><tr><td colspan="2">TOTAL (${svcEntries.length} items)</td><td class="num">${svcEntries.reduce((s, [, v]) => s + v.qty, 0)}</td><td class="num">${BDT(svcEntries.reduce((s, [, v]) => s + v.rev, 0))}</td><td class="num">${BDT(svcEntries.reduce((s, [, v]) => s + v.cost, 0))}</td><td class="num">${BDT(svcEntries.reduce((s, [, v]) => s + (v.rev - v.cost), 0))}</td><td></td></tr></tfoot></table>` : emptyState('fa-layer-group', 'এই সময়সীমায় কোনো সার্ভিস বিক্রি হয়নি।')}
      </div></div>
  `;

  const expenseAndPayrollHtml = `
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Expense Report by Category (${rangeLabel})</h3></div>
        <div class="panel-body table-wrap">${catRows ? `<table><thead><tr><th>Category</th><th class="num">Amount</th><th class="num">% of Expense</th></tr></thead><tbody>${catRows}</tbody>
        <tfoot class="total-foot"><tr><td>TOTAL EXPENSE</td><td class="num" style="color:var(--red);">${BDT(totals.expense)}</td><td class="num">100%</td></tr></tfoot></table>` : emptyState('fa-receipt', 'কোনো expense নেই।')}</div></div>
      <div class="panel"><div class="panel-head"><h3>Team & Freelancer Payroll Report (${rangeLabel})</h3></div>
        <div class="panel-body table-wrap">
          ${empReportRows.length ? `<table><thead><tr><th>Name</th><th>Role / Type</th><th class="num">Committed</th><th class="num">Paid (${rangeLabel})</th><th class="num">Paid (All-time)</th><th class="num">Current Due</th></tr></thead><tbody>
            ${empReportRows.map(r => `<tr><td style="font-weight:600;">${escapeHtml(r.e.name)}</td><td><span class="pill">${escapeHtml(r.e.type)}</span></td><td class="num">${BDT(r.committed)}</td><td class="num" style="color:var(--gold-deep);font-weight:600;">${BDT(r.paidPeriod)}</td><td class="num" style="color:var(--teal);">${BDT(r.paidAll)}</td><td class="num" style="color:${r.due > 0 ? 'var(--red)' : 'var(--teal)'};">${BDT(r.due)}</td></tr>`).join('')}
          </tbody>
          <tfoot class="total-foot"><tr><td colspan="2">TOTAL TEAM (${empReportRows.length})</td><td class="num">${BDT(empReportRows.reduce((s, r) => s + r.committed, 0))}</td><td class="num">${BDT(empReportRows.reduce((s, r) => s + r.paidPeriod, 0))}</td><td class="num">${BDT(empReportRows.reduce((s, r) => s + r.paidAll, 0))}</td><td class="num" style="color:var(--red);">${BDT(empReportRows.reduce((s, r) => s + r.due, 0))}</td></tr></tfoot></table>` : emptyState('fa-user-tie', 'কোনো team member নেই।')}
        </div></div>
    </div>
  `;

  const adsReportHtml = `
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Client-wise Ad Spend Report (${rangeLabel})</h3><button class="btn btn-sm" id="repGoAdsBtn">Open Spend Log</button></div>
        <div class="panel-body table-wrap">
          ${Object.keys(adsByClient).length ? `<table><thead><tr><th>Client</th><th>Platforms</th><th class="num">Entries</th><th class="num">Total Spend</th><th class="num">% Share</th></tr></thead><tbody>
            ${Object.entries(adsByClient).sort((a, b) => b[1].spend - a[1].spend).map(([cid, v]) => `<tr><td style="font-weight:600;">${escapeHtml(clientName(cid))}</td><td>${Array.from(v.platforms).map(p => `<span class="pill" style="margin-right:4px;">${escapeHtml(p)}</span>`).join('')}</td><td class="num">${v.count}</td><td class="num" style="font-weight:600;">${BDT(v.spend)}</td><td class="num">${adsAll.spend ? (v.spend / adsAll.spend * 100).toFixed(1) : 0}%</td></tr>`).join('')}
          </tbody><tfoot class="total-foot"><tr><td colspan="2">TOTAL AD SPEND</td><td class="num">${adsFiltered.length}</td><td class="num">${BDT(adsAll.spend)}</td><td class="num">100%</td></tr></tfoot></table>` : emptyState('fa-bullhorn', 'এই সময়সীমায় কোনো Ad Spend নেই।')}
        </div></div>
      <div class="panel"><div class="panel-head"><h3>Platform-wise Ad Spend Report (${rangeLabel})</h3></div>
        <div class="panel-body table-wrap">
          ${Object.keys(adsByPlat).length ? `<table><thead><tr><th>Platform</th><th class="num">Entries</th><th class="num">Total Spend</th><th class="num">% Share</th></tr></thead><tbody>
            ${Object.entries(adsByPlat).sort((a, b) => b[1].spend - a[1].spend).map(([p, v]) => `<tr><td><span class="pill">${escapeHtml(p)}</span></td><td class="num">${v.count}</td><td class="num" style="font-weight:600;">${BDT(v.spend)}</td><td class="num">${adsAll.spend ? (v.spend / adsAll.spend * 100).toFixed(1) : 0}%</td></tr>`).join('')}
          </tbody><tfoot class="total-foot"><tr><td>TOTAL</td><td class="num">${adsFiltered.length}</td><td class="num">${BDT(adsAll.spend)}</td><td class="num">100%</td></tr></tfoot></table>` : emptyState('fa-bullhorn', 'এই সময়সীমায় কোনো Ad Spend নেই।')}
        </div></div>
    </div>
  `;

  const vatAndAgingHtml = `
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>VAT & Subscription Summary (${rangeLabel})</h3></div>
        <div class="panel-body">
          <div class="stat-line"><span class="muted">MRR (Expected Monthly Retainer Revenue)</span><b class="num">${BDT(mrr)}</b></div>
          <div class="stat-line"><span class="muted">Collected This Month</span><b class="num" style="color:var(--teal)">${BDT(collected)}</b></div>
          <div class="stat-line"><span class="muted">Output VAT (Billed on Invoices)</span><b class="num">${BDT(taxTotal)}</b></div>
          <div class="stat-line"><span class="muted">Input VAT (Eligible Purchases)</span><b class="num" style="color:var(--teal)">${BDT(inputVat)}</b></div>
          <div class="stat-line" style="border-top:2px solid var(--ink);margin-top:4px;padding-top:8px;"><span style="font-weight:700;">Net VAT Payable</span><b class="num ${netVat >= 0 ? 'profit-neg' : 'profit-pos'}">${BDT(netVat)}</b></div>
        </div></div>
      <div class="panel"><div class="panel-head"><h3>Aging Report (Outstanding Receivables)</h3></div>
        <div class="panel-body">${agingHtml}</div></div>
    </div>
  `;

  body.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi accent-gold"><div class="kpi-label">Revenue (Billed)</div><div class="kpi-value num">${BDT(totals.revenue)}</div><div class="kpi-sub">${rangeLabel}</div></div>
      <div class="kpi accent-teal"><div class="kpi-label">Cash Received</div><div class="kpi-value num">${BDT(totals.received)}</div><div class="kpi-sub">Net Cash Flow: ${BDT(netCashFlow)}</div></div>
      <div class="kpi ${totals.grossProfit >= 0 ? 'accent-teal' : 'accent-red'}"><div class="kpi-label">Gross Profit</div><div class="kpi-value num" style="color:${totals.grossProfit >= 0 ? 'var(--teal)' : 'var(--red)'}">${BDT(totals.grossProfit)}</div><div class="kpi-sub">COS: ${BDT(totals.costOfService)}</div></div>
      <div class="kpi ${totals.netProfit >= 0 ? 'accent-teal' : 'accent-red'}"><div class="kpi-label">Net Profit</div><div class="kpi-value num" style="color:${totals.netProfit >= 0 ? 'var(--teal)' : 'var(--red)'}">${BDT(totals.netProfit)}</div><div class="kpi-sub">OPEX+Salary: ${BDT(totals.operatingExpense + totals.salary)}</div></div>
      <div class="kpi"><div class="kpi-label">Client Ad Spend (Log)</div><div class="kpi-value num">${BDT(adsAll.spend)}</div><div class="kpi-sub">${adsAll.count} spend entries</div></div>
    </div>
    ${show('pnl') ? pnlAndCashFlowHtml : ''}
    ${show('period') ? periodBreakdownHtml : ''}
    ${show('clients') ? clientReportHtml : ''}
    ${show('services') ? serviceReportHtml : ''}
    ${show('expenses') ? expenseAndPayrollHtml : ''}
    ${show('ads') ? adsReportHtml : ''}
    ${show('vat_aging') ? vatAndAgingHtml : ''}
  `;
  document.getElementById('groupByToggle')?.addEventListener('change', (e: any) => { reportGroupBy = e.target.value; renderReportsBody(); });
  document.getElementById('repGoAdsBtn')?.addEventListener('click', () => goTo('ads-fund'));
  body.querySelectorAll('[data-client-go]').forEach((el: any) => el.addEventListener('click', () => goTo('clients', { view: el.dataset.clientGo })));
  document.getElementById('printReportBtn')?.addEventListener('click', () => {
    printGenericReportDoc('Financial Report', rangeLabel, body.innerHTML);
  });
}

/* ========================= JOURNAL ========================= */
function buildJournalEntries(from: string | null, to: string | null) {
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
  const acctName = (id: string) => (accountById(id) || {}).name || 'Cash & Bank';
  const entries: any[] = [];
  DB.invoices.filter((i: any) => i.status !== 'Cancelled' && inRange(i.date)).forEach((i: any) => {
    const t = invoiceTotals(i); const net = t.total - t.taxAmt;
    entries.push({ date: i.date, ref: i.number, desc: `Invoice ${i.number} — ${clientName(i.clientId)}`, debit: 'Accounts Receivable', credit: 'Sales Revenue', amount: net, source: `Invoice #${i.number}`, flow: 'accrual', account: '—' });
    if (t.taxAmt > 0.5) entries.push({ date: i.date, ref: i.number, desc: `VAT on Invoice ${i.number}`, debit: 'Accounts Receivable', credit: 'VAT Payable (Output)', amount: t.taxAmt, source: `Invoice #${i.number}`, flow: 'accrual', account: '—' });
  });
  DB.payments.filter((p: any) => !p.isCreditApplication && inRange(p.date)).forEach((p: any) => {
    const inv = invoiceById(p.invoiceId);
    entries.push({ date: p.date, ref: inv ? inv.number : '—', desc: `Payment received — ${clientName(p.clientId)}${inv ? ' (' + inv.number + ')' : ''}`, debit: acctName(p.accountId), credit: 'Accounts Receivable', amount: Number(p.amount || 0), source: `Payment ${p.id}`, flow: 'in', account: acctName(p.accountId) });
  });
  (DB.creditLedger || []).filter((c: any) => c.type === 'Advance' && c.accountId && inRange(c.date)).forEach((c: any) => {
    entries.push({ date: c.date, ref: 'ADV', desc: `Client advance received — ${clientName(c.clientId)}`, debit: acctName(c.accountId), credit: 'Client Advances (Liability)', amount: Number(c.amount || 0), source: `Credit ${c.id}`, flow: 'in', account: acctName(c.accountId) });
  });
  (DB.refunds || []).filter((r: any) => inRange(r.date)).forEach((r: any) => {
    const inv = invoiceById(r.invoiceId);
    entries.push({ date: r.date, ref: inv ? inv.number : '—', desc: `Refund issued — ${clientName(r.clientId)}`, debit: 'Accounts Receivable (Refund)', credit: acctName(r.accountId), amount: Number(r.amount || 0), source: `Refund ${r.id}`, flow: 'out', account: acctName(r.accountId) });
  });
  DB.expenses.filter((e: any) => inRange(e.date)).forEach((e: any) => {
    entries.push({ date: e.date, ref: '—', desc: `${e.category}${e.vendor ? ' — ' + e.vendor : ''}`, debit: `Expense — ${e.category}`, credit: acctName(e.accountId), amount: Number(e.amount || 0), source: `Expense ${e.id}`, flow: 'out', account: acctName(e.accountId) });
  });
  (DB.employeePayments || []).filter((p: any) => inRange(p.date)).forEach((p: any) => {
    const emp = DB.employees.find((x: any) => x.id === p.employeeId);
    entries.push({ date: p.date, ref: '—', desc: `Salary/Payout — ${emp ? emp.name : '—'}${p.note ? ' (' + p.note + ')' : ''}`, debit: 'Salary & Wages Expense', credit: acctName(p.accountId), amount: Number(p.amount || 0), source: `Payout ${p.id}`, flow: 'out', account: acctName(p.accountId) });
  });
  DB.transfers.filter((t: any) => inRange(t.date)).forEach((t: any) => {
    entries.push({ date: t.date, ref: '—', desc: `Internal transfer: ${acctName(t.from)} → ${acctName(t.to)}`, debit: acctName(t.to), credit: acctName(t.from), amount: Number(t.amount || 0), source: `Transfer ${t.id}`, flow: 'transfer', account: `${acctName(t.from)} → ${acctName(t.to)}` });
  });
  entries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return entries;
}

const journalRangeState = { preset: 'this_month', from: '', to: '' };
let journalViewMode = 'simple';
PAGES['journal'] = function (root) {
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Journal</h2><div class="desc">প্রতিটি transaction থেকে automatically তৈরি</div></div>
      <div class="section-actions"><button class="btn" id="expJournalBtn"><i class="fa-solid fa-download"></i> Export CSV</button></div>
    </div>
    <div class="filter-bar">
      ${genRangeBarHtml(journalRangeState, 'jrn')}
      <div class="tabs" id="journalModeTabs" style="margin-left:auto;">
        <div class="tab ${journalViewMode === 'simple' ? 'active' : ''}" data-mode="simple">Simple View</div>
        <div class="tab ${journalViewMode === 'accounting' ? 'active' : ''}" data-mode="accounting">Accounting View (Dr/Cr)</div>
      </div>
    </div>
    <div class="panel"><div class="panel-body table-wrap" id="journalWrap"></div></div>
  `;
  genRangeWire(journalRangeState, 'jrn', () => goTo('journal'), renderJournalBody);
  document.querySelectorAll('#journalModeTabs .tab').forEach((t: any) => t.addEventListener('click', () => { journalViewMode = t.dataset.mode; goTo('journal'); }));
  document.getElementById('expJournalBtn')?.addEventListener('click', () => {
    const { from, to } = genRangeBounds(journalRangeState);
    const entries = buildJournalEntries(from, to);
    const rows: any[][] = [['Date', 'Reference', 'Description', 'Debit Account', 'Credit Account', 'Amount', 'Source Document']];
    entries.forEach(e => rows.push([e.date, e.ref, e.desc, e.debit, e.credit, e.amount, e.source]));
    downloadCSV(rows, 'journal.csv');
  });
  renderJournalBody();
};

function renderJournalBody() {
  const wrap = document.getElementById('journalWrap');
  if (!wrap) return;
  const { from, to } = genRangeBounds(journalRangeState);
  const entries = buildJournalEntries(from, to);
  if (!entries.length) { wrap.innerHTML = emptyState('fa-book-journal-whills', 'এই সময়সীমায় কোনো transaction নেই।'); return; }
  if (journalViewMode === 'simple') {
    const cashEntries = entries.filter(e => e.flow === 'in' || e.flow === 'out');
    let running = 0;
    const rows = cashEntries.map(e => {
      running += (e.flow === 'in' ? e.amount : -e.amount);
      return `<tr>
        <td>${fmtDate(e.date)}</td>
        <td>${escapeHtml(e.desc)}</td>
        <td>${escapeHtml(e.account)}</td>
        <td class="num" style="color:var(--teal);font-weight:600;">${e.flow === 'in' ? BDT(e.amount) : '—'}</td>
        <td class="num" style="color:var(--red);font-weight:600;">${e.flow === 'out' ? BDT(e.amount) : '—'}</td>
        <td class="num" style="font-weight:600;">${BDT(running)}</td>
      </tr>`;
    }).join('');
    const totalIn = cashEntries.filter(e => e.flow === 'in').reduce((s, e) => s + e.amount, 0);
    const totalOut = cashEntries.filter(e => e.flow === 'out').reduce((s, e) => s + e.amount, 0);
    wrap.innerHTML = `<table><thead><tr><th>Date</th><th>What Happened</th><th>Account</th><th class="num">Money In</th><th class="num">Money Out</th><th class="num">Running Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot class="total-foot"><tr><td colspan="3">Total</td><td class="num" style="color:var(--teal);">${BDT(totalIn)}</td><td class="num" style="color:var(--red);">${BDT(totalOut)}</td><td class="num">${BDT(totalIn - totalOut)}</td></tr></tfoot></table>`;
  } else {
    const totalDebit = entries.reduce((s, e) => s + e.amount, 0);
    const rows = entries.map(e => `<tr>
      <td>${fmtDate(e.date)}</td><td>${escapeHtml(e.ref)}</td><td>${escapeHtml(e.desc)}</td>
      <td style="color:var(--navy-3);font-weight:600;">${escapeHtml(e.debit)}</td>
      <td style="color:var(--gold-deep);font-weight:600;">${escapeHtml(e.credit)}</td>
      <td class="num">${BDT(e.amount)}</td><td class="muted" style="font-size:11px;">${escapeHtml(e.source)}</td>
    </tr>`).join('');
    wrap.innerHTML = `<table><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>Debit Account</th><th>Credit Account</th><th class="num">Amount</th><th>Source Document</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot class="total-foot"><tr><td colspan="5">Total (Debit = Credit, always balanced)</td><td class="num">${BDT(totalDebit)}</td><td></td></tr></tfoot></table>`;
  }
}

/* ========================= BALANCE SHEET (AUDIT FIX: Exact reconciliation with Income Statement) ========================= */
function buildBalanceSheet() {
  const cashAndBank = DB.accounts.reduce((s: number, a: any) => s + accountBalance(a.id), 0);
  const byType: Record<string, number> = {};
  DB.accounts.forEach((a: any) => { byType[a.type] = (byType[a.type] || 0) + accountBalance(a.id); });
  const receivables = DB.invoices.filter((i: any) => i.status !== 'Cancelled').reduce((s: number, i: any) => s + (invoiceTotals(i).total - invoicePaid(i.id)), 0);
  const m = DB.bsManual || {};
  const fixedAssets = Number(m.equipment || 0);
  const currentAssets = cashAndBank + receivables + Number(m.advanceToVendors || 0) + Number(m.otherAssets || 0);
  const totalAssets = fixedAssets + currentAssets;

  const clientAdvances = DB.clients.reduce((s: number, c: any) => s + Math.max(creditBalance(c.id), 0), 0);
  const outputVatAll = DB.invoices.filter((i: any) => i.status !== 'Cancelled').reduce((s: number, i: any) => s + invoiceTotals(i).taxAmt, 0);
  const inputVatAll = DB.expenses.filter((e: any) => e.vatEligible).reduce((s: number, e: any) => s + Number(e.vatAmount || 0), 0);
  const vatPayable = Math.max(outputVatAll - inputVatAll, 0);
  const currentLiabilities = clientAdvances + vatPayable + Number(m.payables || 0) + Number(m.salaryPayable || 0);
  const nonCurrentLiabilities = Number(m.loans || 0);
  const totalLiabilities = currentLiabilities + nonCurrentLiabilities;

  /* AUDIT FIX: Retained Earnings uses the exact same accrual formula as Income Statement Net Profit
     (net of Output VAT so VAT isn't double-counted in both Liabilities and Equity), plus Opening Account Balances. */
  const revenueExclVat = DB.invoices.filter((i: any) => i.status !== 'Cancelled').reduce((s: number, i: any) => {
    const t = invoiceTotals(i);
    return s + (t.total - t.taxAmt);
  }, 0);
  const expenseAll = DB.expenses.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const salaryAll = (DB.employeePayments || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const openingAccountsTotal = DB.accounts.reduce((s: number, a: any) => s + Number(a.opening || 0), 0);
  const retainedEarnings = revenueExclVat - expenseAll - salaryAll + inputVatAll;
  const equity = Number(m.ownerCapital || 0) + openingAccountsTotal + retainedEarnings - Number(m.drawings || 0);

  const totalLiabEquity = totalLiabilities + equity;
  const diff = totalAssets - totalLiabEquity;
  return { byType, cashAndBank, receivables, m, fixedAssets, currentAssets, totalAssets, clientAdvances, vatPayable, currentLiabilities, nonCurrentLiabilities, totalLiabilities, retainedEarnings, openingAccountsTotal, equity, totalLiabEquity, diff };
}

PAGES['balance-sheet'] = function (root) {
  const bs = buildBalanceSheet();
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Balance Sheet</h2><div class="desc">As of ${fmtDate(todayStr())} — Assets = Liabilities + Equity</div></div>
      <div class="section-actions"><button class="btn" id="editManualBtn"><i class="fa-solid fa-pen"></i> Edit Manual Items</button><button class="btn btn-gold" id="printBsBtn"><i class="fa-solid fa-file-pdf"></i> Print / PDF</button></div>
    </div>
    <div id="bsContentWrap">
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Assets</h3></div>
        <div class="panel-body">
          <div class="hint" style="margin-bottom:4px;font-weight:700;color:var(--gold);">Non-Current Assets</div>
          <div class="stat-line"><span class="muted">Equipment / Fixed Assets</span><b class="num">${BDT(bs.m.equipment || 0)}</b></div>
          <div class="stat-line" style="border-top:1px dashed var(--line);padding-top:6px;"><span style="font-weight:600;">Total Non-Current Assets</span><b class="num" style="font-weight:600;">${BDT(bs.fixedAssets)}</b></div>
          <div class="hint" style="margin:12px 0 4px;font-weight:700;color:var(--gold);">Current Assets</div>
          ${Object.entries(bs.byType).map(([type, amt]) => `<div class="stat-line"><span class="muted">${escapeHtml(type)}</span><b class="num">${BDT(amt)}</b></div>`).join('')}
          <div class="stat-line"><span class="muted">Accounts Receivable (Due from clients)</span><b class="num">${BDT(bs.receivables)}</b></div>
          <div class="stat-line"><span class="muted">Advance to Vendors</span><b class="num">${BDT(bs.m.advanceToVendors || 0)}</b></div>
          <div class="stat-line"><span class="muted">Other Current Assets</span><b class="num">${BDT(bs.m.otherAssets || 0)}</b></div>
          <div class="stat-line" style="border-top:1px dashed var(--line);padding-top:6px;"><span style="font-weight:600;">Total Current Assets</span><b class="num" style="font-weight:600;">${BDT(bs.currentAssets)}</b></div>
          <div class="stat-line" style="border-top:2px solid var(--ink);margin-top:6px;padding-top:9px;"><span style="font-weight:700;">Total Assets</span><b class="num" style="font-weight:700;">${BDT(bs.totalAssets)}</b></div>
        </div></div>
      <div class="panel"><div class="panel-head"><h3>Liabilities</h3></div>
        <div class="panel-body">
          <div class="hint" style="margin-bottom:4px;font-weight:700;color:var(--gold);">Current Liabilities</div>
          <div class="stat-line"><span class="muted">Client Advances (prepaid credit)</span><b class="num">${BDT(bs.clientAdvances)}</b></div>
          <div class="stat-line"><span class="muted">VAT Payable (Output − Input, all-time)</span><b class="num">${BDT(bs.vatPayable)}</b></div>
          <div class="stat-line"><span class="muted">Accounts Payable (vendors)</span><b class="num">${BDT(bs.m.payables || 0)}</b></div>
          <div class="stat-line"><span class="muted">Salary Payable</span><b class="num">${BDT(bs.m.salaryPayable || 0)}</b></div>
          <div class="stat-line" style="border-top:1px dashed var(--line);padding-top:6px;"><span style="font-weight:600;">Total Current Liabilities</span><b class="num" style="font-weight:600;">${BDT(bs.currentLiabilities)}</b></div>
          <div class="hint" style="margin:12px 0 4px;font-weight:700;color:var(--gold);">Non-Current Liabilities</div>
          <div class="stat-line"><span class="muted">Long-term Loans</span><b class="num">${BDT(bs.m.loans || 0)}</b></div>
          <div class="stat-line" style="border-top:1px dashed var(--line);padding-top:6px;"><span style="font-weight:600;">Total Non-Current Liabilities</span><b class="num" style="font-weight:600;">${BDT(bs.nonCurrentLiabilities)}</b></div>
          <div class="stat-line" style="border-top:2px solid var(--ink);margin-top:6px;padding-top:9px;"><span style="font-weight:700;">Total Liabilities</span><b class="num" style="font-weight:700;">${BDT(bs.totalLiabilities)}</b></div>
        </div></div>
    </div>
    <div class="panel"><div class="panel-head"><h3>Owner's Equity</h3></div>
      <div class="panel-body">
        <div class="stat-line"><span class="muted">Owner Capital + Opening Account Balances</span><b class="num">${BDT(Number(bs.m.ownerCapital || 0) + bs.openingAccountsTotal)}</b></div>
        <div class="stat-line"><span class="muted">Retained Earnings (cumulative accrual profit)</span><b class="num ${bs.retainedEarnings >= 0 ? 'profit-pos' : 'profit-neg'}">${BDT(bs.retainedEarnings)}</b></div>
        <div class="stat-line"><span class="muted">Drawings</span><b class="num">- ${BDT(bs.m.drawings || 0)}</b></div>
        <div class="stat-line" style="border-top:2px solid var(--ink);margin-top:6px;padding-top:9px;"><span style="font-weight:700;">Total Equity</span><b class="num" style="font-weight:700;">${BDT(bs.equity)}</b></div>
      </div></div>
    <div class="panel"><div class="panel-head"><h3>Check: Assets = Liabilities + Equity</h3></div>
      <div class="panel-body">
        <div class="stat-line"><span>Total Liabilities + Equity</span><b class="num">${BDT(bs.totalLiabEquity)}</b></div>
        <div class="stat-line"><span>Total Assets</span><b class="num">${BDT(bs.totalAssets)}</b></div>
        <div class="stat-line" style="border-top:1px dashed var(--line);margin-top:6px;padding-top:9px;"><span style="font-weight:700;">Difference</span><b class="num" style="font-weight:700;color:${Math.abs(bs.diff) < 1 ? 'var(--teal)' : 'var(--red)'}">${BDT(bs.diff)} ${Math.abs(bs.diff) < 1 ? '✅ Balanced' : '⚠️'}</b></div>
      </div></div>
    </div>
  `;
  document.getElementById('editManualBtn')?.addEventListener('click', manualBsForm);
  document.getElementById('printBsBtn')?.addEventListener('click', () => {
    const content = document.getElementById('bsContentWrap')?.innerHTML || '';
    printGenericReportDoc('Balance Sheet', `As of ${fmtDate(todayStr())}`, content);
  });
};

function manualBsForm() {
  const m = DB.bsManual || {};
  openModal({
    title: 'Edit Manual Balance Sheet Items',
    bodyHtml: `<div class="form-grid">
      <div class="field"><label>Owner Capital (৳)</label><input type="number" id="f_ownerCapital" value="${m.ownerCapital || 0}"/></div>
      <div class="field"><label>Drawings (৳)</label><input type="number" id="f_drawings" value="${m.drawings || 0}"/></div>
      <div class="field"><label>Equipment / Fixed Assets (৳)</label><input type="number" id="f_equipment" value="${m.equipment || 0}"/></div>
      <div class="field"><label>Other Assets (৳)</label><input type="number" id="f_otherAssets" value="${m.otherAssets || 0}"/></div>
      <div class="field"><label>Advance to Vendors (৳)</label><input type="number" id="f_advanceToVendors" value="${m.advanceToVendors || 0}"/></div>
      <div class="field"><label>Payables — vendors owed (৳)</label><input type="number" id="f_payables" value="${m.payables || 0}"/></div>
      <div class="field"><label>Salary Payable (৳)</label><input type="number" id="f_salaryPayable" value="${m.salaryPayable || 0}"/></div>
      <div class="field"><label>Loans (৳)</label><input type="number" id="f_loans" value="${m.loans || 0}"/></div>
    </div>`,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-primary" id="cSave">Save</button>`
  });
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    DB.bsManual = {
      ownerCapital: Number((document.getElementById('f_ownerCapital') as HTMLInputElement).value || 0),
      drawings: Number((document.getElementById('f_drawings') as HTMLInputElement).value || 0),
      equipment: Number((document.getElementById('f_equipment') as HTMLInputElement).value || 0),
      otherAssets: Number((document.getElementById('f_otherAssets') as HTMLInputElement).value || 0),
      advanceToVendors: Number((document.getElementById('f_advanceToVendors') as HTMLInputElement).value || 0),
      payables: Number((document.getElementById('f_payables') as HTMLInputElement).value || 0),
      salaryPayable: Number((document.getElementById('f_salaryPayable') as HTMLInputElement).value || 0),
      loans: Number((document.getElementById('f_loans') as HTMLInputElement).value || 0),
    };
    save(); closeModal(); toast('Saved'); goTo('balance-sheet');
  };
}

/* ========================= AUDIT TRAIL / ACTIVITY LOG ========================= */
function fmtDateTime(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return escapeHtml(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function actionBadgeHtml(act: string) {
  const map: Record<string, string> = {
    'Created': 'badge-paid',
    'Added': 'badge-paid',
    'Recorded': 'badge-paid',
    'Paid': 'badge-paid',
    'Updated': 'badge-partial',
    'Transferred': 'badge-pending',
    'Cancelled': 'badge-overdue',
    'Deleted': 'badge-overdue',
    'Issued': 'badge-overdue',
  };
  return `<span class="badge ${map[act] || 'badge-pending'}">${escapeHtml(act)}</span>`;
}

export function openAuditTrailModal() {
  const logs: any[] = DB.auditLogs || [];
  openModal({
    wide: true,
    title: 'Audit Trail & Recent Ledger Activity',
    bodyHtml: `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <div class="hint">সাম্প্রতিক সব ইনভয়েস, পেমেন্ট, খরচ এবং ক্লায়েন্ট পরিবর্তনের অডিট রেকর্ড (${logs.length}টি এন্ট্রি)</div>
        <button class="btn btn-sm" id="audFullPageBtn"><i class="fa-solid fa-expand"></i> Full Audit Page & Filters</button>
      </div>
      <div class="table-wrap" style="max-height:58vh;overflow-y:auto;">
        ${!logs.length ? emptyState('fa-clipboard-check', 'এখনো কোনো পরিবর্তন রেকর্ড হয়নি। নতুন ইনভয়েস বা পেমেন্ট যোগ করলেই এখানে তাৎক্ষণিক অডিট লগ দেখা যাবে।') : `
          <table>
            <thead><tr><th>Time</th><th>User</th><th>Module</th><th>Action</th><th>Details</th><th class="num">Amount</th></tr></thead>
            <tbody>
              ${logs.slice(0, 60).map(l => `
                <tr>
                  <td style="white-space:nowrap;font-size:12px;color:var(--muted);">${fmtDateTime(l.timestamp)}</td>
                  <td><b>${escapeHtml(l.actorName || 'Owner')}</b><div class="muted" style="font-size:11px;">${escapeHtml(l.actorEmail || '')}</div></td>
                  <td><span class="pill">${escapeHtml(l.module)}</span></td>
                  <td>${actionBadgeHtml(l.action)}</td>
                  <td>${escapeHtml(l.detail)}</td>
                  <td class="num">${l.amount != null ? BDT(l.amount) : '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>
    `,
    footHtml: `<button class="btn" id="audExportCsvBtn"><i class="fa-solid fa-download"></i> Export CSV</button><button class="btn btn-primary" id="audCloseBtn">Close</button>`
  });
  document.getElementById('audCloseBtn')!.onclick = closeModal;
  document.getElementById('audFullPageBtn')!.onclick = () => { closeModal(); goTo('audit-log'); };
  document.getElementById('audExportCsvBtn')!.onclick = () => {
    const rows: any[][] = [['Timestamp', 'User Name', 'User Email', 'Module', 'Action', 'Details', 'Amount']];
    (DB.auditLogs || []).forEach((l: any) => rows.push([l.timestamp, l.actorName, l.actorEmail, l.module, l.action, l.detail, l.amount ?? '']));
    downloadCSV(rows, 'audit-trail.csv');
  };
}

const auditFilterState = { module: '', action: '', search: '' };
PAGES['audit-log'] = function (root) {
  const logs: any[] = DB.auditLogs || [];
  const modules = Array.from(new Set(logs.map(l => l.module))).filter(Boolean);
  const actions = Array.from(new Set(logs.map(l => l.action))).filter(Boolean);

  root.innerHTML = `
    <div class="section-head">
      <div><h2>Audit Trail / Activity Log</h2><div class="desc">এজেন্সির কে কখন কোন ইনভয়েস, পেমেন্ট বা খরচ তৈরি, আপডেট বা ডিলিট করেছে তার পূর্ণাঙ্গ হিসাব</div></div>
      <div class="section-actions">
        <button class="btn" id="expAuditBtn"><i class="fa-solid fa-download"></i> Export Audit CSV</button>
        <button class="btn btn-gold" id="printAuditBtn"><i class="fa-solid fa-file-pdf"></i> Print / Save PDF</button>
      </div>
    </div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);">
      <div class="kpi accent-gold"><div class="kpi-label">Total Logged Events</div><div class="kpi-value num">${logs.length}</div><i class="fa-solid fa-clipboard-check kpi-icon"></i></div>
      <div class="kpi accent-teal"><div class="kpi-label">Creations & Payments</div><div class="kpi-value num">${logs.filter(l => ['Created', 'Added', 'Recorded', 'Paid'].includes(l.action)).length}</div><i class="fa-solid fa-circle-plus kpi-icon"></i></div>
      <div class="kpi"><div class="kpi-label">Updates & Edits</div><div class="kpi-value num">${logs.filter(l => l.action === 'Updated').length}</div><i class="fa-solid fa-pen-to-square kpi-icon"></i></div>
      <div class="kpi accent-red"><div class="kpi-label">Deletions / Cancels / Refunds</div><div class="kpi-value num">${logs.filter(l => ['Deleted', 'Cancelled', 'Issued'].includes(l.action)).length}</div><i class="fa-solid fa-triangle-exclamation kpi-icon"></i></div>
    </div>
    <div class="filter-bar">
      <select id="audModFilter">
        <option value="">All Modules</option>
        ${modules.map(m => `<option value="${escapeHtml(m)}" ${auditFilterState.module === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
      </select>
      <select id="audActFilter">
        <option value="">All Actions</option>
        ${actions.map(a => `<option value="${escapeHtml(a)}" ${auditFilterState.action === a ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
      </select>
      <input type="text" id="audSearchInp" placeholder="Search invoice #, client, user…" value="${escapeHtml(auditFilterState.search)}"/>
    </div>
    <div class="panel"><div class="panel-body table-wrap" id="auditTableWrap"></div></div>
  `;

  const renderTable = () => {
    const wrap = document.getElementById('auditTableWrap');
    if (!wrap) return;
    const q = auditFilterState.search.trim().toLowerCase();
    const filtered = (DB.auditLogs || []).filter((l: any) =>
      (!auditFilterState.module || l.module === auditFilterState.module) &&
      (!auditFilterState.action || l.action === auditFilterState.action) &&
      (!q || (l.detail || '').toLowerCase().includes(q) || (l.actorName || '').toLowerCase().includes(q) || (l.actorEmail || '').toLowerCase().includes(q))
    );
    if (!filtered.length) {
      wrap.innerHTML = emptyState('fa-clipboard-check', 'এই ফিল্টারে কোনো অডিট লগ পাওয়া যায়নি। নতুন কোনো ইনভয়েস, পেমেন্ট বা খরচ সেভ করলেই এখানে রেকর্ড যুক্ত হবে।');
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Timestamp</th><th>User</th><th>Module</th><th>Action</th><th>Activity Detail</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${filtered.map((l: any) => `
            <tr>
              <td style="white-space:nowrap;font-size:12.5px;color:var(--muted);">${fmtDateTime(l.timestamp)}</td>
              <td><b>${escapeHtml(l.actorName || 'Owner')}</b><div class="muted" style="font-size:11px;">${escapeHtml(l.actorEmail || '')}</div></td>
              <td><span class="pill">${escapeHtml(l.module)}</span></td>
              <td>${actionBadgeHtml(l.action)}</td>
              <td>${escapeHtml(l.detail)}</td>
              <td class="num">${l.amount != null ? BDT(l.amount) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  };

  document.getElementById('audModFilter')?.addEventListener('change', (e: any) => { auditFilterState.module = e.target.value; renderTable(); });
  document.getElementById('audActFilter')?.addEventListener('change', (e: any) => { auditFilterState.action = e.target.value; renderTable(); });
  document.getElementById('audSearchInp')?.addEventListener('input', (e: any) => { auditFilterState.search = e.target.value; renderTable(); });
  document.getElementById('expAuditBtn')?.addEventListener('click', () => {
    const rows: any[][] = [['Timestamp', 'User Name', 'User Email', 'Module', 'Action', 'Details', 'Amount']];
    (DB.auditLogs || []).forEach((l: any) => rows.push([l.timestamp, l.actorName, l.actorEmail, l.module, l.action, l.detail, l.amount ?? '']));
    downloadCSV(rows, 'audit-trail.csv');
  });
  document.getElementById('printAuditBtn')?.addEventListener('click', () => {
    const wrapHtml = document.getElementById('auditTableWrap')?.innerHTML || '';
    printGenericReportDoc('Audit Trail / Activity Log', `Generated ${fmtDate(todayStr())}`, wrapHtml);
  });

  renderTable();
};
