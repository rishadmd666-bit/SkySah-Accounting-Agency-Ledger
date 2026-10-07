import { BDT, toLocalISODate, todayStr, uid, monthKey, fmtDate, daysBetween, escapeHtml } from './ledgerHelpers';
import {
  DB, save, toast, PAGES, goTo, currentPage, currentParams, openModal, closeModal, confirmAction,
  emptyState, downloadCSV, genRangeBounds, genRangeBarHtml, genRangeWire, registerChart,
  clientById, serviceById, invoiceById, accountById, clientName, initials,
  invoiceTotals, invoicePaid, invoiceGrossPaid, invoiceRefunded, creditBalance,
  clientOpenInvoices, allocateClientPayment, applyCreditToInvoice, invoiceStatus,
  statusBadgeClass, dueInvoices, clientFinancials, totalsAcrossRange, accountBalance,
  last6Months, nextInvoiceNumber
} from './ledgerCore';
import { printInvoiceDoc } from './ledgerPrinters';

declare const Chart: any;

/* ========================= RECURRING HELPERS ========================= */
export function missingRecurringMonths(client: any) {
  const startMonth = monthKey(client.startDate || todayStr());
  const nowMonth = monthKey(todayStr());
  let [sy, sm] = startMonth.split('-').map(Number);
  const [ny, nm] = nowMonth.split('-').map(Number);
  if (!sy || !sm) { sy = ny; sm = nm; }
  const months: string[] = [];
  let y = sy, m = sm, guard = 0;
  while ((y < ny || (y === ny && m <= nm)) && guard < 36) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
    guard++;
  }
  const billed = new Set(DB.invoices.filter((i: any) => i.recurring && i.clientId === client.id).map((i: any) => monthKey(i.date)));
  return months.filter(mk => !billed.has(mk));
}
export function allPendingRecurring() {
  const recClients = DB.clients.filter((c: any) => c.status === 'Active' && Number(c.monthlyPackage) > 0);
  const pairs: { client: any; monthKey: string }[] = [];
  recClients.forEach((c: any) => { missingRecurringMonths(c).forEach(mk => pairs.push({ client: c, monthKey: mk })); });
  return pairs;
}

export function invoiceMiniTable(invs: any[]) {
  const rows = invs.map(i => {
    const t = invoiceTotals(i);
    const st = invoiceStatus(i);
    return `<tr><td>${escapeHtml(i.number)}</td><td>${fmtDate(i.date)}</td><td class="num">${BDT(t.total)}</td><td><span class="badge ${statusBadgeClass(st)}">${st}</span></td></tr>`;
  }).join('');
  const mTot = invs.reduce((s, i) => s + invoiceTotals(i).total, 0);
  return `<table><thead><tr><th>Invoice</th><th>Date</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>${rows}</tbody>
    <tfoot class="total-foot"><tr><td colspan="2">TOTAL (${invs.length})</td><td class="num">${BDT(mTot)}</td><td></td></tr></tfoot></table>`;
}

/* ========================= DASHBOARD ========================= */
const dashboardRangeState = { preset: 'all' };
function dashboardRangeBounds() {
  const now = new Date();
  const p = dashboardRangeState.preset;
  if (p === 'today') { const t = todayStr(); return { from: t, to: t, label: 'আজ' }; }
  if (p === '7d') { const from = toLocalISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)); return { from, to: todayStr(), label: 'গত ৭ দিন' }; }
  if (p === 'month') { const from = toLocalISODate(new Date(now.getFullYear(), now.getMonth(), 1)); return { from, to: todayStr(), label: 'এই মাস' }; }
  if (p === 'year') { return { from: `${now.getFullYear()}-01-01`, to: todayStr(), label: 'এই বছর' }; }
  return { from: null, to: null, label: 'সর্বমোট (All Time)' };
}

function recentInvoicesTable() {
  const invs = [...DB.invoices].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8);
  if (!invs.length) return emptyState('fa-file-invoice', 'এখনো কোনো ইনভয়েস তৈরি হয়নি।');
  const rows = invs.map(i => {
    const t = invoiceTotals(i);
    const st = invoiceStatus(i);
    return `<tr style="cursor:pointer;" data-inv-view="${i.id}">
      <td>${escapeHtml(i.number)}</td>
      <td class="name-cell">${escapeHtml(clientName(i.clientId))}</td>
      <td>${fmtDate(i.date)}</td>
      <td>${fmtDate(i.dueDate)}</td>
      <td class="num">${BDT(t.total)}</td>
      <td><span class="badge ${statusBadgeClass(st)}">${st}</span></td>
    </tr>`;
  }).join('');
  const tot = invs.reduce((s, i) => s + invoiceTotals(i).total, 0);
  return `<table><thead><tr><th>Invoice</th><th>Client</th><th>Date</th><th>Due</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>${rows}</tbody>
    <tfoot class="total-foot"><tr><td colspan="4">TOTAL (${invs.length} shown)</td><td class="num">${BDT(tot)}</td><td></td></tr></tfoot></table>`;
}

PAGES['dashboard'] = function (root) {
  const { from, to, label: rangeLabel } = dashboardRangeBounds();
  const totals = totalsAcrossRange(from, to);
  const totalDue = DB.invoices.filter((i: any) => i.status !== 'Cancelled').reduce((s: number, i: any) => s + (invoiceTotals(i).total - invoicePaid(i.id)), 0);
  const overdueCount = DB.invoices.filter((i: any) => invoiceStatus(i) === 'Overdue').length;
  const activeClients = DB.clients.filter((c: any) => c.status === 'Active').length;
  const mrr = DB.clients.filter((c: any) => c.status === 'Active').reduce((s: number, c: any) => s + Number(c.monthlyPackage || 0), 0);
  const grossProfit = totals.grossProfit;
  const pendingRecurring = allPendingRecurring();
  const DATE_TABS = [['all', 'All Time'], ['today', 'Today'], ['7d', '7 Days'], ['month', 'This Month'], ['year', 'This Year']];

  root.innerHTML = `
    <div class="section-head">
      <div><h2>Financial Overview</h2><div class="desc">এক নজরে আপনার এজেন্সির আর্থিক অবস্থা — ${fmtDate(todayStr())}</div></div>
      <div class="section-actions">
        <button class="btn btn-gold" data-nav-go="invoices"><i class="fa-solid fa-plus"></i> Create Invoice</button>
        <button class="btn" data-nav-go="clients"><i class="fa-solid fa-user-plus"></i> Add Client</button>
      </div>
    </div>
    ${pendingRecurring.length ? `<div class="panel" style="border-left:3px solid var(--gold);"><div class="panel-body" style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;flex-wrap:wrap;gap:10px;">
      <div><i class="fa-solid fa-rotate" style="color:var(--gold);"></i>&nbsp; <b>${pendingRecurring.length}টি recurring invoice</b> pending — এখনো generate করা হয়নি।</div>
      <button class="btn btn-sm btn-gold" data-nav-go="recurring">Review & Generate</button>
    </div></div>` : ''}

    <div class="tabs" id="dashRangeTabs">
      ${DATE_TABS.map(([k, l]) => `<div class="tab ${dashboardRangeState.preset === k ? 'active' : ''}" data-range="${k}">${l}</div>`).join('')}
    </div>

    <div class="kpi-grid">
      <div class="kpi accent-gold"><div class="kpi-label">Total Revenue</div><div class="kpi-value num">${BDT(totals.revenue)}</div><div class="kpi-sub">${rangeLabel} — billed</div><i class="fa-solid fa-sack-dollar kpi-icon"></i></div>
      <div class="kpi accent-teal"><div class="kpi-label">Total Received</div><div class="kpi-value num">${BDT(totals.received)}</div><div class="kpi-sub">${rangeLabel} — cash collected</div><i class="fa-solid fa-hand-holding-dollar kpi-icon"></i></div>
      <div class="kpi accent-red"><div class="kpi-label">Total Due</div><div class="kpi-value num">${BDT(totalDue)}</div><div class="kpi-sub">${overdueCount} overdue invoice(s) — as of today</div><i class="fa-solid fa-hourglass-half kpi-icon"></i></div>
      <div class="kpi ${grossProfit >= 0 ? 'accent-teal' : 'accent-red'}"><div class="kpi-label">Gross Profit</div><div class="kpi-value num" style="color:${grossProfit >= 0 ? 'var(--teal)' : 'var(--red)'}">${BDT(grossProfit)}</div><div class="kpi-sub">${rangeLabel} — Revenue − Cost of Service</div><i class="fa-solid fa-chart-line kpi-icon"></i></div>
      <div class="kpi ${totals.netProfit >= 0 ? 'accent-teal' : 'accent-red'}"><div class="kpi-label">Net Profit</div><div class="kpi-value num" style="color:${totals.netProfit >= 0 ? 'var(--teal)' : 'var(--red)'}">${BDT(totals.netProfit)}</div><div class="kpi-sub">${rangeLabel} — After OPEX & Salary</div><i class="fa-solid fa-coins kpi-icon"></i></div>
    </div>
    <div class="panel"><div class="panel-head"><h3>Income Statement (Profit & Loss) — ${rangeLabel}</h3></div>
      <div class="panel-body">
        <div class="stat-line"><span class="muted">Revenue (Total Billed)</span><b class="num">${BDT(totals.revenue)}</b></div>
        <div class="stat-line"><span class="muted">Less: Cost of Service</span><b class="num" style="color:var(--red)">- ${BDT(totals.costOfService)}</b></div>
        <div class="stat-line" style="border-top:2px solid var(--ink);margin-top:4px;padding-top:8px;"><span style="font-weight:700;">Gross Profit</span><b class="num" style="font-weight:700;">${BDT(totals.grossProfit)}</b></div>
        <div class="stat-line" style="margin-top:8px;"><span class="muted">Less: Operating Expenses</span><b class="num" style="color:var(--red)">- ${BDT(totals.operatingExpense)}</b></div>
        <div class="stat-line"><span class="muted">Less: Team & Freelancer Salary</span><b class="num" style="color:var(--red)">- ${BDT(totals.salary)}</b></div>
        <div class="stat-line" style="border-top:2px solid var(--ink);margin-top:4px;padding-top:8px;"><span style="font-weight:700;">Net Profit</span><b class="num ${totals.netProfit >= 0 ? 'profit-pos' : 'profit-neg'}" style="font-weight:700;">${BDT(totals.netProfit)}</b></div>
      </div></div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Total Invoices</div><div class="kpi-value num">${DB.invoices.length}</div><div class="kpi-sub">${DB.invoices.filter((i: any) => invoiceStatus(i) === 'Paid').length} fully paid</div><i class="fa-solid fa-file-lines kpi-icon"></i></div>
      <div class="kpi accent-red"><div class="kpi-label">Overdue Invoices</div><div class="kpi-value num">${overdueCount}</div><div class="kpi-sub">Needs follow-up</div><i class="fa-solid fa-triangle-exclamation kpi-icon"></i></div>
      <div class="kpi accent-gold"><div class="kpi-label">Active Clients</div><div class="kpi-value num">${activeClients}</div><div class="kpi-sub">of ${DB.clients.length} total</div><i class="fa-solid fa-users kpi-icon"></i></div>
      <div class="kpi accent-teal"><div class="kpi-label">Recurring Revenue (MRR)</div><div class="kpi-value num">${BDT(mrr)}</div><div class="kpi-sub">Monthly package value</div><i class="fa-solid fa-rotate kpi-icon"></i></div>
      <div class="kpi"><div class="kpi-label">Collection Rate</div><div class="kpi-value num">${totals.revenue ? Math.round(totals.received / totals.revenue * 100) : 0}%</div><div class="kpi-sub">Received vs billed</div><i class="fa-solid fa-percent kpi-icon"></i></div>
    </div>

    <div class="chart-grid">
      <div class="panel"><div class="panel-head"><h3>Revenue vs Expense+Salary vs Net Profit (last 6 months)</h3></div>
        <div class="panel-body"><canvas id="chMain" height="110"></canvas></div></div>
      <div class="panel"><div class="panel-head"><h3>Paid vs Due</h3></div>
        <div class="panel-body"><canvas id="chPaidDue" height="110"></canvas></div></div>
    </div>
    <div class="chart-grid2">
      <div class="panel"><div class="panel-head"><h3>Client-wise Revenue (Top 6)</h3></div>
        <div class="panel-body"><canvas id="chClient" height="130"></canvas></div></div>
      <div class="panel"><div class="panel-head"><h3>Service-wise Revenue</h3></div>
        <div class="panel-body"><canvas id="chService" height="130"></canvas></div></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Recent Invoices</h3><button class="btn btn-sm" data-nav-go="invoices">সব দেখুন</button></div>
      <div class="panel-body table-wrap">${recentInvoicesTable()}</div>
    </div>
  `;
  root.querySelectorAll('[data-nav-go]').forEach((b: any) => b.addEventListener('click', () => goTo(b.dataset.navGo)));
  root.querySelectorAll('[data-inv-view]').forEach((b: any) => b.addEventListener('click', () => goTo('invoices', { view: b.dataset.invView })));
  root.querySelectorAll('[data-range]').forEach((b: any) => b.addEventListener('click', () => { dashboardRangeState.preset = b.dataset.range; goTo('dashboard'); }));

  const months = last6Months();
  const revArr: number[] = [], expArr: number[] = [], profArr: number[] = [];
  months.forEach(m => {
    const rev = DB.invoices.filter((i: any) => i.status !== 'Cancelled' && monthKey(i.date) === m.key).reduce((s: number, i: any) => s + invoiceTotals(i).total, 0);
    const exp = DB.expenses.filter((e: any) => monthKey(e.date) === m.key).reduce((s: number, e: any) => s + Number(e.amount || 0), 0)
      + (DB.employeePayments || []).filter((p: any) => monthKey(p.date) === m.key).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    revArr.push(rev); expArr.push(exp); profArr.push(rev - exp);
  });

  registerChart('main', new Chart(document.getElementById('chMain'), {
    type: 'bar',
    data: {
      labels: months.map(m => m.label), datasets: [
        { type: 'bar', label: 'Revenue', data: revArr, backgroundColor: '#B4863A' },
        { type: 'bar', label: 'Expense+Salary', data: expArr, backgroundColor: '#A6392F99' },
        { type: 'line', label: 'Net Profit', data: profArr, borderColor: '#1F6E56', backgroundColor: '#1F6E56', tension: .3 },
      ]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 11, font: { size: 11 } } } }, scales: { y: { ticks: { callback: (v: any) => '৳' + v } } } }
  }));

  const paid = DB.invoices.filter((i: any) => i.status !== 'Cancelled').reduce((s: number, i: any) => s + invoicePaid(i.id), 0);
  registerChart('paidDue', new Chart(document.getElementById('chPaidDue'), {
    type: 'doughnut',
    data: { labels: ['Received', 'Due'], datasets: [{ data: [paid, Math.max(totalDue, 0)], backgroundColor: ['#1F6E56', '#A6392F'] }] },
    options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 11, font: { size: 11 } } } }, cutout: '62%' }
  }));

  const clientRevMap: Record<string, number> = {};
  DB.invoices.filter((i: any) => i.status !== 'Cancelled').forEach((i: any) => { clientRevMap[i.clientId] = (clientRevMap[i.clientId] || 0) + invoiceTotals(i).total; });
  const topClients = Object.entries(clientRevMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
  registerChart('client', new Chart(document.getElementById('chClient'), {
    type: 'bar',
    data: { labels: topClients.map(c => clientName(c[0])), datasets: [{ label: 'Revenue', data: topClients.map(c => c[1]), backgroundColor: '#16283D' }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: (v: any) => '৳' + v } } } }
  }));

  const svcRevMap: Record<string, number> = {};
  DB.invoices.filter((i: any) => i.status !== 'Cancelled').forEach((i: any) => (i.items || []).forEach((it: any) => {
    const name = it.name || (serviceById(it.serviceId) || {}).name || 'Other';
    const line = (it.qty || 1) * (it.price || 0);
    svcRevMap[name] = (svcRevMap[name] || 0) + line;
  }));
  const svcEntries = Object.entries(svcRevMap).sort((a, b) => b[1] - a[1]).slice(0, 7);
  registerChart('service', new Chart(document.getElementById('chService'), {
    type: 'pie',
    data: { labels: svcEntries.map(s => s[0]), datasets: [{ data: svcEntries.map(s => s[1]), backgroundColor: ['#B4863A', '#1F6E56', '#16283D', '#A6392F', '#8C6526', '#6E7583', '#DCD4BF'] }] },
    options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } }
  }));
};

/* ========================= CLIENTS ========================= */
PAGES['clients'] = function (root, params) {
  if (params && params.view) { return renderClientProfile(root, params.view); }
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Clients</h2><div class="desc">${DB.clients.length} client(s) registered</div></div>
      <div class="section-actions"><button class="btn btn-gold" id="addClientBtn"><i class="fa-solid fa-plus"></i> Add Client</button></div>
    </div>
    <div class="panel"><div class="panel-body table-wrap" id="clientTableWrap"></div></div>
  `;
  document.getElementById('addClientBtn')?.addEventListener('click', () => clientForm());
  renderClientTable();
};

function renderClientTable() {
  const wrap = document.getElementById('clientTableWrap');
  if (!wrap) return;
  if (!DB.clients.length) { wrap.innerHTML = emptyState('fa-users', 'কোনো ক্লায়েন্ট নেই। "Add Client" চাপুন।'); return; }
  const rows = DB.clients.map((c: any) => {
    const f = clientFinancials(c.id);
    return `<tr>
      <td class="name-cell"><span class="client-avatar">${initials(c.name)}</span><div><div style="font-weight:600;cursor:pointer;" data-view="${c.id}">${escapeHtml(c.name)}</div><div class="muted" style="font-size:11.5px;">${escapeHtml(c.company || '')}</div></div></td>
      <td>${escapeHtml(c.phone || '—')}</td>
      <td>${escapeHtml(c.industry || '—')}</td>
      <td class="num">${BDT(f.totalBilling)}</td>
      <td class="num" style="color:var(--red)">${BDT(f.due)}</td>
      <td><span class="badge ${statusBadgeClass(c.status)}">${c.status}</span></td>
      <td class="row-actions">
        <button class="icon-btn" data-view="${c.id}" title="View"><i class="fa-solid fa-eye"></i></button>
        <button class="icon-btn" data-edit="${c.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-btn" data-del="${c.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
  const cTot = DB.clients.reduce((a: any, c: any) => { const f = clientFinancials(c.id); a.bill += f.totalBilling; a.due += f.due; return a; }, { bill: 0, due: 0 });
  wrap.innerHTML = `<table><thead><tr><th>Client</th><th>Phone</th><th>Industry</th><th class="num">Billing</th><th class="num">Due</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody>
    <tfoot class="total-foot"><tr><td colspan="3">TOTAL (${DB.clients.length} clients)</td><td class="num">${BDT(cTot.bill)}</td><td class="num" style="color:var(--red);">${BDT(cTot.due)}</td><td colspan="2"></td></tr></tfoot></table>`;
  wrap.querySelectorAll('[data-view]').forEach((b: any) => b.addEventListener('click', () => goTo('clients', { view: b.dataset.view })));
  wrap.querySelectorAll('[data-edit]').forEach((b: any) => b.addEventListener('click', () => clientForm(clientById(b.dataset.edit))));
  wrap.querySelectorAll('[data-del]').forEach((b: any) => b.addEventListener('click', () => {
    const cli = clientById(b.dataset.del);
    const invCount = DB.invoices.filter((i: any) => i.clientId === cli.id).length;
    const payCount = DB.payments.filter((p: any) => p.clientId === cli.id).length;
    const hasHistory = invCount > 0 || payCount > 0 || DB.expenses.some((e: any) => e.clientId === cli.id) || DB.contracts.some((ct: any) => ct.clientId === cli.id) || DB.quotations.some((q: any) => q.clientId === cli.id);
    if (!hasHistory) {
      confirmAction(`"${cli.name}" ডিলিট করবেন? এই ক্লায়েন্টের কোনো financial record নেই, তাই এটি সম্পূর্ণভাবে মুছে ফেলা নিরাপদ।`, () => {
        DB.clients = DB.clients.filter((c: any) => c.id !== cli.id); save(); toast('Client deleted'); renderClientTable();
      });
      return;
    }
    openModal({
      title: `"${cli.name}" — Delete or Archive?`,
      bodyHtml: `<p style="font-size:13.5px;line-height:1.6;">এই ক্লায়েন্টের সাথে <b>${invCount}টি invoice</b> ও <b>${payCount}টি payment</b> record যুক্ত আছে। দুটি option থেকে বেছে নিন —</p>
        <div style="margin-top:12px;padding:12px 14px;background:var(--teal-bg);border-left:3px solid var(--teal);margin-bottom:10px;">
          <b style="color:var(--teal);"><i class="fa-solid fa-box-archive"></i> Archive (সুপারিশকৃত)</b>
          <div class="hint" style="margin-top:4px;color:#3a5a4f;">ক্লায়েন্টকে "Inactive" করে তালিকা থেকে সরিয়ে দেওয়া হবে, কিন্তু সব invoice/payment/report অক্ষত থাকবে — hisab-e কোনো গরমিল হবে না।</div>
        </div>
        <div style="padding:12px 14px;background:var(--red-bg);border-left:3px solid var(--red);">
          <b style="color:var(--red);"><i class="fa-solid fa-trash"></i> Permanently Delete</b>
          <div class="hint" style="margin-top:4px;color:#7a3530;">ক্লায়েন্ট এবং তার সব invoice, payment, quotation, contract একেবারে মুছে যাবে। <b>এই কাজ ফিরিয়ে আনা যাবে না।</b></div>
        </div>`,
      footHtml: `<button class="btn" id="cDelCancel">Cancel</button><button class="btn" id="cDelArchive" style="border-color:var(--teal);color:var(--teal);"><i class="fa-solid fa-box-archive"></i> Archive Instead</button><button class="btn btn-danger" id="cDelPerm" style="border-color:var(--red);"><i class="fa-solid fa-trash"></i> Permanently Delete</button>`
    });
    document.getElementById('cDelCancel')!.onclick = closeModal;
    document.getElementById('cDelArchive')!.onclick = () => { cli.status = 'Inactive'; save(); closeModal(); toast('Client archived (marked Inactive)'); renderClientTable(); };
    document.getElementById('cDelPerm')!.onclick = () => {
      const id = cli.id;
      DB.invoices = DB.invoices.filter((i: any) => i.clientId !== id);
      DB.payments = DB.payments.filter((p: any) => p.clientId !== id);
      DB.refunds = (DB.refunds || []).filter((r: any) => r.clientId !== id);
      DB.expenses.forEach((e: any) => { if (e.clientId === id) e.clientId = ''; });
      DB.contracts = DB.contracts.filter((ct: any) => ct.clientId !== id);
      DB.quotations = DB.quotations.filter((q: any) => q.clientId !== id);
      DB.creditLedger = (DB.creditLedger || []).filter((cr: any) => cr.clientId !== id);
      DB.adsFunds = (DB.adsFunds || []).filter((a: any) => a.clientId !== id);
      DB.clients = DB.clients.filter((c: any) => c.id !== id);
      save(); closeModal(); toast('Client and all related records permanently deleted'); renderClientTable();
    };
  }));
}

export function clientForm(existing?: any) {
  const c = existing || { status: 'Active', paymentTerms: 'Net 15' };
  openModal({
    title: existing ? 'Edit Client' : 'Add New Client',
    bodyHtml: `<div class="form-grid">
      <div class="field"><label>Client Name *</label><input id="f_name" value="${escapeHtml(c.name || '')}"/></div>
      <div class="field"><label>Company Name</label><input id="f_company" value="${escapeHtml(c.company || '')}"/></div>
      <div class="field"><label>Phone</label><input id="f_phone" value="${escapeHtml(c.phone || '')}"/></div>
      <div class="field"><label>Email</label><input id="f_email" value="${escapeHtml(c.email || '')}"/></div>
      <div class="field full"><label>Address</label><input id="f_address" value="${escapeHtml(c.address || '')}"/></div>
      <div class="field"><label>Website</label><input id="f_website" value="${escapeHtml(c.website || '')}"/></div>
      <div class="field"><label>Industry</label><input id="f_industry" value="${escapeHtml(c.industry || '')}"/></div>
      <div class="field"><label>Assigned Manager</label><input id="f_manager" value="${escapeHtml(c.manager || '')}"/></div>
      <div class="field"><label>Start Date</label><input type="date" id="f_start" value="${c.startDate || todayStr()}"/></div>
      <div class="field"><label>Status</label><select id="f_status">
        <option ${c.status === 'Active' ? 'selected' : ''}>Active</option><option ${c.status === 'Inactive' ? 'selected' : ''}>Inactive</option></select></div>
      <div class="field"><label>Payment Terms</label><select id="f_terms">
        ${['Due on Receipt', 'Net 7', 'Net 15', 'Net 30'].map(t => `<option ${c.paymentTerms === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select></div>
      <div class="field"><label>Monthly Package (৳)</label><input type="number" id="f_monthly" value="${c.monthlyPackage || 0}" min="0"/></div>
      <div class="field full"><label>Contract Value (৳)</label><input type="number" id="f_contract" value="${c.contractValue || 0}" min="0"/></div>
    </div>`,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-primary" id="cSave">${existing ? 'Save Changes' : 'Add Client'}</button>`
  });
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    const name = (document.getElementById('f_name') as HTMLInputElement).value.trim();
    if (!name) { toast('Client name is required', true); return; }
    const data = {
      id: c.id || uid('cli'), name,
      company: (document.getElementById('f_company') as HTMLInputElement).value.trim(),
      phone: (document.getElementById('f_phone') as HTMLInputElement).value.trim(),
      email: (document.getElementById('f_email') as HTMLInputElement).value.trim(),
      address: (document.getElementById('f_address') as HTMLInputElement).value.trim(),
      website: (document.getElementById('f_website') as HTMLInputElement).value.trim(),
      industry: (document.getElementById('f_industry') as HTMLInputElement).value.trim(),
      manager: (document.getElementById('f_manager') as HTMLInputElement).value.trim(),
      startDate: (document.getElementById('f_start') as HTMLInputElement).value,
      status: (document.getElementById('f_status') as HTMLSelectElement).value,
      paymentTerms: (document.getElementById('f_terms') as HTMLSelectElement).value,
      monthlyPackage: Number((document.getElementById('f_monthly') as HTMLInputElement).value || 0),
      contractValue: Number((document.getElementById('f_contract') as HTMLInputElement).value || 0),
    };
    if (existing) { Object.assign(existing, data); } else { DB.clients.push(data); }
    save(); closeModal(); toast('Client saved'); goTo('clients');
  };
}

function renderClientProfile(root: HTMLElement, clientId: string) {
  const c = clientById(clientId);
  if (!c) { root.innerHTML = emptyState('fa-user', 'Client not found.'); return; }
  const f = clientFinancials(clientId);
  const credit = creditBalance(clientId);
  const invs = DB.invoices.filter((i: any) => i.clientId === clientId).sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
  const clientAds = (DB.adsFunds || []).filter((a: any) => a.clientId === clientId).sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
  const totalClientAds = clientAds.reduce((s: number, a: any) => s + Number(a.amount || 0), 0);
  root.innerHTML = `
    <div class="section-head">
      <div>
        <button class="btn btn-ghost btn-sm" id="backBtn" style="padding-left:0;"><i class="fa-solid fa-arrow-left"></i> All Clients</button>
        <h2 style="margin-top:6px;">${escapeHtml(c.name)}</h2>
        <div class="desc">${escapeHtml(c.company || '')} · ${escapeHtml(c.industry || '')} · <span class="badge ${statusBadgeClass(c.status)}">${c.status}</span></div>
      </div>
      <div class="section-actions">
        <button class="btn" id="editClientBtn"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn" id="clientAdsBtn"><i class="fa-solid fa-bullhorn"></i> Ads Spend (${BDT(totalClientAds)})</button>
        <button class="btn" id="clientPayBtn"><i class="fa-solid fa-layer-group"></i> Record Payment</button>
        <button class="btn btn-gold" id="newInvForClient"><i class="fa-solid fa-plus"></i> New Invoice</button>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi accent-gold"><div class="kpi-label">Total Billing</div><div class="kpi-value num">${BDT(f.totalBilling)}</div><i class="fa-solid fa-file-invoice-dollar kpi-icon"></i></div>
      <div class="kpi accent-teal"><div class="kpi-label">Received</div><div class="kpi-value num">${BDT(f.received)}</div><i class="fa-solid fa-hand-holding-dollar kpi-icon"></i></div>
      <div class="kpi accent-red"><div class="kpi-label">Due</div><div class="kpi-value num">${BDT(f.due)}</div><i class="fa-solid fa-hourglass-half kpi-icon"></i></div>
      <div class="kpi"><div class="kpi-label">Expense (Allocated)</div><div class="kpi-value num">${BDT(f.expense)}</div><i class="fa-solid fa-receipt kpi-icon"></i></div>
      <div class="kpi ${f.profit >= 0 ? 'accent-teal' : 'accent-red'}"><div class="kpi-label">Profit</div><div class="kpi-value num" style="color:${f.profit >= 0 ? 'var(--teal)' : 'var(--red)'}">${BDT(f.profit)}</div><i class="fa-solid fa-chart-line kpi-icon"></i></div>
    </div>
    ${credit > 0.5 ? `<div class="panel" style="border-left:3px solid var(--gold);"><div class="panel-body" style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;">
      <div><b>Available Advance Credit:</b> <span class="num" style="color:var(--gold-deep);">${BDT(credit)}</span> <span class="muted" style="font-size:12px;">— এই ক্রেডিট পরবর্তী ইনভয়েসে apply করা যাবে।</span></div>
    </div></div>` : ''}
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Client Details</h3></div>
        <div class="panel-body">
          <div class="stat-line"><span class="muted">Phone</span><b>${escapeHtml(c.phone || '—')}</b></div>
          <div class="stat-line"><span class="muted">Email</span><b>${escapeHtml(c.email || '—')}</b></div>
          <div class="stat-line"><span class="muted">Website</span><b>${escapeHtml(c.website || '—')}</b></div>
          <div class="stat-line"><span class="muted">Address</span><b>${escapeHtml(c.address || '—')}</b></div>
          <div class="stat-line"><span class="muted">Assigned Manager</span><b>${escapeHtml(c.manager || '—')}</b></div>
          <div class="stat-line"><span class="muted">Start Date</span><b>${fmtDate(c.startDate)}</b></div>
          <div class="stat-line"><span class="muted">Payment Terms</span><b>${escapeHtml(c.paymentTerms || '—')}</b></div>
          <div class="stat-line"><span class="muted">Monthly Package</span><b class="num">${BDT(c.monthlyPackage)}</b></div>
          <div class="stat-line"><span class="muted">Contract Value</span><b class="num">${BDT(c.contractValue)}</b></div>
          <div class="stat-line"><span class="muted">Total Ad Spend (Log)</span><b class="num" style="color:var(--gold-deep);">${BDT(totalClientAds)} (${clientAds.length} entries)</b></div>
        </div></div>
      <div class="panel"><div class="panel-head"><h3>Invoice History</h3></div>
        <div class="panel-body table-wrap">${invs.length ? invoiceMiniTable(invs) : emptyState('fa-file-invoice', 'No invoices yet.')}</div></div>
    </div>
    <div class="panel"><div class="panel-head"><h3>Client Ad Spend History (${clientAds.length})</h3><button class="btn btn-sm" id="goAdsPageBtn">Open Full Ads Spend Log</button></div>
      <div class="panel-body table-wrap">
        ${clientAds.length ? `<table><thead><tr><th>Date</th><th>Platform</th><th class="num">Amount</th><th>Notes</th></tr></thead><tbody>
          ${clientAds.map((a: any) => `<tr><td>${fmtDate(a.date)}</td><td><span class="pill">${escapeHtml(a.platform || '—')}</span></td><td class="num">${BDT(a.amount)}</td><td>${escapeHtml(a.notes || '')}</td></tr>`).join('')}
        </tbody><tfoot class="total-foot"><tr><td colspan="2">TOTAL AD SPEND</td><td class="num">${BDT(totalClientAds)}</td><td></td></tr></tfoot></table>` : emptyState('fa-bullhorn', 'এই ক্লায়েন্টের কোনো Ad Spend রেকর্ড নেই।')}
      </div>
    </div>
  `;
  document.getElementById('backBtn')?.addEventListener('click', () => goTo('clients'));
  document.getElementById('editClientBtn')?.addEventListener('click', () => clientForm(c));
  document.getElementById('clientAdsBtn')?.addEventListener('click', () => goTo('ads-fund'));
  document.getElementById('goAdsPageBtn')?.addEventListener('click', () => goTo('ads-fund'));
  document.getElementById('clientPayBtn')?.addEventListener('click', () => clientPaymentForm(clientId));
  document.getElementById('newInvForClient')?.addEventListener('click', () => invoiceForm(null, c.id));
}

/* ========================= INVOICES ========================= */
const invoiceRangeState = { preset: 'all', from: '', to: '' };
PAGES['invoices'] = function (root, params) {
  if (params && params.view) { return renderInvoiceDetail(root, params.view); }
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Invoices</h2><div class="desc">${DB.invoices.length} invoice(s) total</div></div>
      <div class="section-actions">
        <button class="btn" id="exportInvBtn"><i class="fa-solid fa-download"></i> Export CSV</button>
        <button class="btn btn-gold" id="addInvBtn" ${!DB.clients.length ? 'disabled title="Add a client first"' : ''}><i class="fa-solid fa-plus"></i> Create Invoice</button>
      </div>
    </div>
    <div class="filter-bar">
      <select id="filStatus"><option value="">All Status</option><option>Paid</option><option>Partially Paid</option><option>Pending</option><option>Overdue</option><option>Cancelled</option></select>
      <select id="filClient"><option value="">All Clients</option>${DB.clients.map((c: any) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select>
      <input type="text" id="filSearch" placeholder="Search invoice # …"/>
      ${genRangeBarHtml(invoiceRangeState, 'inv')}
    </div>
    <div class="panel"><div class="panel-body table-wrap" id="invTableWrap"></div></div>
  `;
  document.getElementById('addInvBtn')?.addEventListener('click', () => invoiceForm());
  document.getElementById('exportInvBtn')?.addEventListener('click', exportInvoicesCSV);
  ['filStatus', 'filClient', 'filSearch'].forEach(id => document.getElementById(id)?.addEventListener('input', renderInvoiceTable));
  genRangeWire(invoiceRangeState, 'inv', () => goTo('invoices'), renderInvoiceTable);
  renderInvoiceTable();
};

function renderInvoiceTable() {
  const wrap = document.getElementById('invTableWrap');
  if (!wrap) return;
  const st = (document.getElementById('filStatus') as HTMLSelectElement)?.value || '';
  const cl = (document.getElementById('filClient') as HTMLSelectElement)?.value || '';
  const q = ((document.getElementById('filSearch') as HTMLInputElement)?.value || '').toLowerCase();
  const { from, to } = genRangeBounds(invoiceRangeState);
  let list = [...DB.invoices];
  if (st) list = list.filter(i => invoiceStatus(i) === st);
  if (cl) list = list.filter(i => i.clientId === cl);
  if (q) list = list.filter(i => (i.number || '').toLowerCase().includes(q));
  if (from) list = list.filter(i => i.date >= from);
  if (to) list = list.filter(i => i.date <= to);
  list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!list.length) { wrap.innerHTML = emptyState('fa-file-invoice', 'কোনো ইনভয়েস পাওয়া যায়নি।'); return; }
  const rows = list.map(i => {
    const t = invoiceTotals(i);
    const status = invoiceStatus(i);
    const paid = invoicePaid(i.id);
    return `<tr>
      <td style="font-weight:600;cursor:pointer;" data-view="${i.id}">${escapeHtml(i.number)}</td>
      <td class="name-cell" style="cursor:pointer;" data-view="${i.id}">${escapeHtml(clientName(i.clientId))}</td>
      <td>${fmtDate(i.date)}</td>
      <td>${fmtDate(i.dueDate)}</td>
      <td class="num">${BDT(t.total)}</td>
      <td class="num" style="color:var(--teal)">${BDT(paid)}</td>
      <td class="num" style="color:var(--red)">${BDT(t.total - paid)}</td>
      <td><span class="badge ${statusBadgeClass(status)}">${status}</span></td>
      <td class="row-actions">
        <button class="icon-btn" data-view="${i.id}" title="View"><i class="fa-solid fa-eye"></i></button>
        <button class="icon-btn" data-edit="${i.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-btn" data-del="${i.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
  const iTot = list.reduce((a, i) => { const t = invoiceTotals(i).total, pd = invoicePaid(i.id); a.total += t; a.paid += pd; a.due += (t - pd); return a; }, { total: 0, paid: 0, due: 0 });
  wrap.innerHTML = `<table><thead><tr><th>Invoice</th><th>Client</th><th>Date</th><th>Due</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Due</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody>
    <tfoot class="total-foot"><tr><td colspan="4">TOTAL (${list.length} invoices)</td><td class="num">${BDT(iTot.total)}</td><td class="num" style="color:var(--teal);">${BDT(iTot.paid)}</td><td class="num" style="color:var(--red);">${BDT(iTot.due)}</td><td colspan="2"></td></tr></tfoot></table>`;
  wrap.querySelectorAll('[data-view]').forEach((b: any) => b.addEventListener('click', () => goTo('invoices', { view: b.dataset.view })));
  wrap.querySelectorAll('[data-edit]').forEach((b: any) => b.addEventListener('click', () => invoiceForm(invoiceById(b.dataset.edit))));
  /* AUDIT FIX 4: Deleting an invoice also cleans up its refunds and creditLedger references so no orphan refunds remain! */
  wrap.querySelectorAll('[data-del]').forEach((b: any) => b.addEventListener('click', () => {
    const targetInv = invoiceById(b.dataset.del);
    confirmAction(`Invoice ${targetInv?.number || ''} ডিলিট করবেন? এর সব payment, refund ও credit records-ও মুছে যাবে।`, () => {
      const id = b.dataset.del;
      DB.payments = DB.payments.filter((p: any) => p.invoiceId !== id);
      DB.refunds = (DB.refunds || []).filter((r: any) => r.invoiceId !== id);
      DB.creditLedger = (DB.creditLedger || []).filter((c: any) => c.invoiceId !== id);
      DB.invoices = DB.invoices.filter((i: any) => i.id !== id);
      save(); toast('Invoice deleted'); renderInvoiceTable();
    });
  }));
}

let invoiceLineItems: any[] = [];
export function invoiceForm(existing?: any, presetClientId?: string) {
  invoiceLineItems = existing ? JSON.parse(JSON.stringify(existing.items || [])) : [];
  if (!invoiceLineItems.length) invoiceLineItems.push({ serviceId: '', name: '', qty: 1, price: 0, discount: 0, tax: 0 });
  const inv = existing || { number: null, date: todayStr(), dueDate: todayStr(), clientId: presetClientId || '', discount: 0, tax: 0, method: 'Bank', notes: '', recurring: false, recurringPeriod: 'Monthly', status: 'Pending' };
  openModal({
    wide: true,
    title: existing ? `Edit Invoice ${inv.number}` : 'Create Invoice',
    bodyHtml: `
      <div class="form-grid cols-3">
        <div class="field"><label>Invoice Number</label><input id="f_number" value="${existing ? escapeHtml(inv.number) : 'Auto-generated on save'}" readonly style="background:#F1EEE3;color:var(--muted);"/></div>
        <div class="field"><label>Client *</label><select id="f_client">
          <option value="">Select client…</option>
          ${DB.clients.map((c: any) => `<option value="${c.id}" ${inv.clientId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Payment Method (default)</label><select id="f_method">
          ${['Cash', 'Bank', 'bKash', 'Nagad', 'Card', 'PayPal', 'Stripe', 'Wise', 'Other'].map(m => `<option ${inv.method === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select></div>
        <div class="field"><label>Invoice Date</label><input type="date" id="f_date" value="${inv.date}"/></div>
        <div class="field"><label>Due Date</label><input type="date" id="f_due" value="${inv.dueDate}"/></div>
        <div class="field"><label>Recurring?</label><select id="f_recurring">
          <option value="no" ${!inv.recurring ? 'selected' : ''}>One-time</option>
          <option value="yes" ${inv.recurring ? 'selected' : ''}>Recurring</option>
        </select></div>
      </div>
      <div style="margin-top:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <label style="font-size:12px;color:var(--muted);font-weight:600;">LINE ITEMS</label>
          <button class="btn btn-sm" id="addLineBtn"><i class="fa-solid fa-plus"></i> Add Line</button>
        </div>
        <table class="li-table"><thead><tr><th style="width:26%;">Service</th><th>Qty</th><th>Unit Price</th><th>Disc %</th><th>Tax %</th><th class="num">Line Total</th><th></th></tr></thead>
        <tbody id="lineItemsBody"></tbody></table>
      </div>
      <div class="form-grid" style="margin-top:14px;">
        <div class="field"><label>Overall Discount (%)</label><input type="number" id="f_discount" value="${inv.discount || 0}" min="0" max="100"/></div>
        <div class="field"><label>Overall Tax / VAT (%)</label><input type="number" id="f_tax" value="${inv.tax || 0}" min="0"/></div>
        <div class="field"><label>VAT Mode</label><select id="f_vatmode">
          <option value="exclusive" ${(!inv.vatMode || inv.vatMode === 'exclusive') ? 'selected' : ''}>Exclusive (VAT added on top)</option>
          <option value="inclusive" ${inv.vatMode === 'inclusive' ? 'selected' : ''}>Inclusive (price already includes VAT)</option>
        </select></div>
        <div class="field full"><label>Notes</label><textarea id="f_notes">${escapeHtml(inv.notes || '')}</textarea></div>
      </div>
      <div class="li-totals" id="liTotals"></div>
    `,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-primary" id="cSave">${existing ? 'Save Changes' : 'Create Invoice'}</button>`
  });
  renderLineItems();
  document.getElementById('addLineBtn')?.addEventListener('click', () => { invoiceLineItems.push({ serviceId: '', name: '', qty: 1, price: 0, discount: 0, tax: 0 }); renderLineItems(); });
  document.getElementById('f_discount')?.addEventListener('input', updateLiTotals);
  document.getElementById('f_tax')?.addEventListener('input', updateLiTotals);
  document.getElementById('f_vatmode')?.addEventListener('change', updateLiTotals);
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    const clientId = (document.getElementById('f_client') as HTMLSelectElement).value;
    if (!clientId) { toast('Please select a client', true); return; }
    const cleanItems = invoiceLineItems.filter(l => l.name);
    if (!cleanItems.length) { toast('Add at least one line item', true); return; }
    for (const l of cleanItems) {
      if (Number(l.qty) <= 0 || !isFinite(Number(l.qty))) { toast(`"${l.name}" — quantity অবশ্যই 0-এর বেশি হতে হবে`, true); return; }
      if (Number(l.price) < 0 || !isFinite(Number(l.price))) { toast(`"${l.name}" — negative price দেওয়া যাবে না`, true); return; }
      if (Number(l.discount) < 0 || Number(l.discount) > 100) { toast(`"${l.name}" — discount 0-100% এর মধ্যে হতে হবে`, true); return; }
      if (Number(l.tax) < 0) { toast(`"${l.name}" — negative tax দেওয়া যাবে না`, true); return; }
    }
    const overallDiscount = Number((document.getElementById('f_discount') as HTMLInputElement).value || 0);
    const overallTax = Number((document.getElementById('f_tax') as HTMLInputElement).value || 0);
    if (overallDiscount < 0 || overallDiscount > 100) { toast('Overall discount 0-100% এর মধ্যে হতে হবে', true); return; }
    if (overallTax < 0) { toast('Negative tax দেওয়া যাবে না', true); return; }
    const dueDateVal = (document.getElementById('f_due') as HTMLInputElement).value, dateVal = (document.getElementById('f_date') as HTMLInputElement).value;
    if (dateVal && dueDateVal && dueDateVal < dateVal) { toast('Due date, invoice date-এর আগে হতে পারবে না', true); return; }
    const data = {
      id: inv.id || uid('inv'),
      number: existing ? inv.number : nextInvoiceNumber(),
      clientId, date: dateVal, dueDate: dueDateVal,
      method: (document.getElementById('f_method') as HTMLSelectElement).value,
      items: cleanItems,
      discount: overallDiscount,
      tax: overallTax,
      vatMode: (document.getElementById('f_vatmode') as HTMLSelectElement).value,
      notes: (document.getElementById('f_notes') as HTMLTextAreaElement).value,
      recurring: (document.getElementById('f_recurring') as HTMLSelectElement).value === 'yes',
      recurringPeriod: 'Monthly',
      status: existing ? existing.status : 'Pending',
    };
    if (existing) { Object.assign(existing, data); } else { DB.invoices.push(data); }
    save(); closeModal(); toast('Invoice saved'); goTo('invoices', { view: data.id });
  };
}

function renderLineItems() {
  const body = document.getElementById('lineItemsBody');
  if (!body) return;
  body.innerHTML = invoiceLineItems.map((li, idx) => {
    const base = (li.qty || 0) * (li.price || 0);
    const afterDisc = base * (1 - (li.discount || 0) / 100);
    const lineTotal = afterDisc * (1 + (li.tax || 0) / 100);
    return `<tr data-idx="${idx}">
      <td><select class="li-service">
        <option value="">Custom…</option>
        <optgroup label="Services">${DB.services.map((s: any) => `<option value="${s.id}" ${li.serviceId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</optgroup>
        ${DB.packages.length ? `<optgroup label="Packages">${DB.packages.map((p: any) => `<option value="${p.id}" ${li.serviceId === p.id ? 'selected' : ''}>📦 ${escapeHtml(p.name)}</option>`).join('')}</optgroup>` : ''}
      </select>
      ${li.isPackage ? `<div class="hint" style="margin-top:4px;">📦 Package sale</div>` : ''}
      ${!li.serviceId ? `<input class="li-name" placeholder="Item name" value="${escapeHtml(li.name || '')}" style="margin-top:4px;"/>` : ''}
      </td>
      <td><input type="number" class="li-qty" value="${li.qty || 1}" min="0" style="width:60px;"/></td>
      <td><input type="number" class="li-price" value="${li.price || 0}" min="0" style="width:90px;"/></td>
      <td><input type="number" class="li-disc" value="${li.discount || 0}" min="0" max="100" style="width:60px;"/></td>
      <td><input type="number" class="li-tax" value="${li.tax || 0}" min="0" style="width:60px;"/></td>
      <td class="num">${BDT(lineTotal)}</td>
      <td><button class="icon-btn li-remove"><i class="fa-solid fa-xmark"></i></button></td>
    </tr>`;
  }).join('');
  body.querySelectorAll('tr').forEach((tr: any) => {
    const idx = Number(tr.dataset.idx);
    const svcSel = tr.querySelector('.li-service') as HTMLSelectElement;
    svcSel.addEventListener('change', () => {
      const val = svcSel.value;
      invoiceLineItems[idx].serviceId = val;
      const svc = serviceById(val);
      const pkg = !svc ? DB.packages.find((p: any) => p.id === val) : null;
      if (svc) { invoiceLineItems[idx].name = svc.name; invoiceLineItems[idx].price = svc.price; invoiceLineItems[idx].tax = svc.tax || 0; invoiceLineItems[idx].isPackage = false; }
      else if (pkg) { invoiceLineItems[idx].name = pkg.name; invoiceLineItems[idx].price = pkg.price; invoiceLineItems[idx].isPackage = true; }
      else { invoiceLineItems[idx].name = ''; invoiceLineItems[idx].isPackage = false; }
      renderLineItems();
    });
    const nameInp = tr.querySelector('.li-name') as HTMLInputElement;
    if (nameInp) nameInp.addEventListener('input', () => { invoiceLineItems[idx].name = nameInp.value; updateLiTotals(); });
    tr.querySelector('.li-qty').addEventListener('input', (e: any) => { invoiceLineItems[idx].qty = Number(e.target.value || 0); renderLineItems(); });
    tr.querySelector('.li-price').addEventListener('input', (e: any) => { invoiceLineItems[idx].price = Number(e.target.value || 0); renderLineItems(); });
    tr.querySelector('.li-disc').addEventListener('input', (e: any) => { invoiceLineItems[idx].discount = Number(e.target.value || 0); renderLineItems(); });
    tr.querySelector('.li-tax').addEventListener('input', (e: any) => { invoiceLineItems[idx].tax = Number(e.target.value || 0); renderLineItems(); });
    tr.querySelector('.li-remove').addEventListener('click', () => {
      invoiceLineItems.splice(idx, 1);
      if (!invoiceLineItems.length) invoiceLineItems.push({ serviceId: '', name: '', qty: 1, price: 0, discount: 0, tax: 0 });
      renderLineItems();
    });
  });
  updateLiTotals();
}

function updateLiTotals() {
  const discountEl = document.getElementById('f_discount') as HTMLInputElement;
  const taxEl = document.getElementById('f_tax') as HTMLInputElement;
  const vatModeEl = document.getElementById('f_vatmode') as HTMLSelectElement;
  const tmp = { items: invoiceLineItems, discount: Number(discountEl?.value || 0), tax: Number(taxEl?.value || 0), vatMode: vatModeEl?.value };
  const t = invoiceTotals(tmp);
  const el = document.getElementById('liTotals');
  if (el) {
    el.innerHTML = `
      <div><span>Subtotal (Excl. Tax)</span><span class="num">${BDT(t.subtotal)}</span></div>
      <div><span>Discount</span><span class="num">- ${BDT(t.discountAmt)}</span></div>
      <div><span>${t.vatMode === 'inclusive' ? 'VAT (included in price)' : 'Total VAT / Tax'}</span><span class="num">${t.vatMode === 'inclusive' ? '' : '+ '}${BDT(t.taxAmt)}</span></div>
      <div class="grand"><span>Total</span><span class="num">${BDT(t.total)}</span></div>
    `;
  }
}

function renderInvoiceTimeline(inv: any, total: number, pays: any[], refunds: any[]) {
  const events: any[] = [];
  events.push({ date: inv.date, type: 'created', label: 'Invoice Created', amount: total, icon: 'fa-file-circle-plus', color: 'var(--navy-3)' });
  pays.forEach(p => events.push({ date: p.date, type: 'payment', label: 'Payment Received', amount: Number(p.amount || 0), method: p.method, txnId: p.txnId, icon: 'fa-circle-check', color: 'var(--teal)' }));
  (refunds || []).forEach(r => events.push({ date: r.date, type: 'refund', label: 'Refund Issued', amount: Number(r.amount || 0), method: r.method, notes: r.notes, icon: 'fa-rotate-left', color: 'var(--red)' }));
  if (inv.status === 'Cancelled') {
    events.push({ date: inv.cancelledDate || inv.date, type: 'cancelled', label: 'Invoice Cancelled', icon: 'fa-ban', color: 'var(--muted)' });
  }
  const typeOrder: Record<string, number> = { created: 0, payment: 1, refund: 1, cancelled: 2 };
  events.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (typeOrder[a.type] - typeOrder[b.type]));
  let net = 0;
  const rows = events.map(e => {
    if (e.type === 'payment') net += e.amount;
    if (e.type === 'refund') net -= e.amount;
    const due = total - net;
    let detail = '';
    if (e.type === 'created') detail = `Invoice total set to ${BDT(total)}`;
    else if (e.type === 'payment') detail = `${escapeHtml(e.method || '')}${e.txnId ? ' · Txn: ' + escapeHtml(e.txnId) : ''}`;
    else if (e.type === 'refund') detail = `${escapeHtml(e.method || '')}${e.notes ? ' · ' + escapeHtml(e.notes) : ''}`;
    else if (e.type === 'cancelled') detail = 'No further payments will be tracked on this invoice.';
    const iconClass = e.icon.startsWith('fa-') ? 'fa-solid ' + e.icon : e.icon;
    return `<tr>
      <td style="white-space:nowrap;">${fmtDate(e.date)}</td>
      <td style="white-space:nowrap;"><i class="${iconClass}" style="color:${e.color};margin-right:6px;"></i>${e.label}</td>
      <td style="color:var(--muted);font-size:12px;">${detail}</td>
      <td class="num" style="color:${e.type === 'refund' ? 'var(--red)' : e.type === 'payment' ? 'var(--teal)' : 'var(--ink)'}">${e.amount != null ? (e.type === 'refund' ? '- ' : '') + BDT(e.amount) : '—'}</td>
      <td class="num" style="font-weight:600;">${e.type !== 'cancelled' ? BDT(due) : '—'}</td>
    </tr>`;
  }).join('');
  return `<table><thead><tr><th>Date</th><th>Event</th><th>Detail</th><th class="num">Amount</th><th class="num">Balance Due After</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderInvoiceDetail(root: HTMLElement, invId: string) {
  const inv = invoiceById(invId);
  if (!inv) { root.innerHTML = emptyState('fa-file-invoice', 'Invoice not found.'); return; }
  const c = clientById(inv.clientId) || {};
  const t = invoiceTotals(inv);
  const paid = invoicePaid(inv.id);
  const refunded = invoiceRefunded(inv.id);
  const status = invoiceStatus(inv);
  const pays = DB.payments.filter((p: any) => p.invoiceId === inv.id).sort((a: any, b: any) => (a.date || '').localeCompare(b.date));
  const refunds = (DB.refunds || []).filter((r: any) => r.invoiceId === inv.id).sort((a: any, b: any) => (a.date || '').localeCompare(b.date));
  const credit = creditBalance(inv.clientId);
  const due = t.total - paid;
  root.innerHTML = `
    <div class="section-head">
      <div>
        <button class="btn btn-ghost btn-sm" id="backBtn" style="padding-left:0;"><i class="fa-solid fa-arrow-left"></i> All Invoices</button>
        <h2 style="margin-top:6px;">${escapeHtml(inv.number)}</h2>
        <div class="desc">${escapeHtml(c.name || '')} · <span class="badge ${statusBadgeClass(status)}">${status}</span></div>
      </div>
      <div class="section-actions">
        <button class="btn" id="editInvBtn"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn" id="printInvBtn"><i class="fa-solid fa-print"></i> Print / PDF</button>
        ${status !== 'Cancelled' ? `<button class="btn btn-danger" id="cancelInvBtn">Cancel Invoice</button>` : ''}
        ${invoiceGrossPaid(inv.id) > 0.5 && status !== 'Cancelled' ? `<button class="btn" id="refundBtn"><i class="fa-solid fa-rotate-left"></i> Record Refund</button>` : ''}
        ${(credit > 0.5 && due > 0.5 && status !== 'Cancelled') ? `<button class="btn btn-gold" id="applyCreditBtn"><i class="fa-solid fa-coins"></i> Apply Credit (${BDT(Math.min(credit, due))})</button>` : ''}
        ${(due > 0.5 && status !== 'Cancelled') ? `<button class="btn btn-gold" id="addPayBtn"><i class="fa-solid fa-plus"></i> Record Payment</button>` : ''}
      </div>
    </div>
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Invoice Details</h3></div>
        <div class="panel-body">
          <div class="stat-line"><span class="muted">Client</span><b>${escapeHtml(c.name || '')}</b></div>
          <div class="stat-line"><span class="muted">Invoice Date</span><b>${fmtDate(inv.date)}</b></div>
          <div class="stat-line"><span class="muted">Due Date</span><b>${fmtDate(inv.dueDate)}</b></div>
          <div class="stat-line"><span class="muted">Recurring</span><b>${inv.recurring ? 'Yes — ' + inv.recurringPeriod : 'No'}</b></div>
          <table style="margin-top:12px;"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Line Total</th></tr></thead>
          <tbody>${(inv.items || []).map((li: any) => {
            const base = (li.qty || 0) * (li.price || 0); const afterDisc = base * (1 - (li.discount || 0) / 100); const line = afterDisc * (1 + (li.tax || 0) / 100);
            return `<tr><td>${escapeHtml(li.name)}</td><td class="num">${li.qty}</td><td class="num">${BDT(li.price)}</td><td class="num">${BDT(line)}</td></tr>`;
          }).join('')}</tbody></table>
          <div class="li-totals" style="margin-left:auto;">
            <div><span>Subtotal (Excl. Tax)</span><span class="num">${BDT(t.subtotal)}</span></div>
            <div><span>Discount</span><span class="num">- ${BDT(t.discountAmt)}</span></div>
            <div><span>Total VAT / Tax</span><span class="num">${t.vatMode === 'inclusive' ? '' : '+ '}${BDT(t.taxAmt)}</span></div>
            <div class="grand"><span>Total</span><span class="num">${BDT(t.total)}</span></div>
          </div>
          ${inv.notes ? `<div class="hint" style="margin-top:12px;">Note: ${escapeHtml(inv.notes)}</div>` : ''}
        </div></div>
      <div>
        <div class="panel"><div class="panel-head"><h3>Payment Summary</h3></div>
          <div class="panel-body">
            <div class="stat-line"><span class="muted">Total</span><b class="num">${BDT(t.total)}</b></div>
            <div class="stat-line"><span class="muted">Paid (gross)</span><b class="num" style="color:var(--teal)">${BDT(invoiceGrossPaid(inv.id))}</b></div>
            ${refunded > 0.5 ? `<div class="stat-line"><span class="muted">Refunded</span><b class="num" style="color:var(--red)">- ${BDT(refunded)}</b></div>` : ''}
            <div class="stat-line"><span class="muted">Net Received</span><b class="num" style="color:var(--teal)">${BDT(paid)}</b></div>
            <div class="stat-line"><span class="muted">Due</span><b class="num" style="color:var(--red)">${BDT(due)}</b></div>
            <div class="progress"><div style="width:${t.total ? Math.min(100, paid / t.total * 100) : 0}%"></div></div>
          </div></div>
        <div class="panel"><div class="panel-head"><h3>Payment & Activity Timeline</h3></div>
          <div class="panel-body table-wrap">${renderInvoiceTimeline(inv, t.total, pays, refunds)}</div></div>
      </div>
    </div>
  `;
  document.getElementById('backBtn')?.addEventListener('click', () => goTo('invoices'));
  document.getElementById('editInvBtn')?.addEventListener('click', () => invoiceForm(inv));
  document.getElementById('printInvBtn')?.addEventListener('click', () => printInvoiceDoc(inv, c, t, paid, refunded, status, DB.accounts));

  /* AUDIT FIX 5: Prevent cancelling an invoice while net payments > 0 without refunding or converting to credit! */
  const cancelBtn = document.getElementById('cancelInvBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    if (paid > 0.5) {
      openModal({
        title: `Cannot Cancel Paid Invoice (${inv.number})`,
        bodyHtml: `<p style="font-size:13.5px;line-height:1.6;">এই ইনভয়েসে ইতিমধ্যে <b>${BDT(paid)}</b> পেমেন্ট নেওয়া আছে। পেমেন্ট রেখে ইনভয়েস Cancel করলে ক্যাশ ব্যালেন্স ও ব্যালেন্স শিট গরমিল হয়ে যাবে। কীভাবে এগিয়ে যেতে চান?</p>`,
        footHtml: `<button class="btn" id="cnClose">Back</button>
          <button class="btn btn-gold" id="cnConvertCredit">Convert ${BDT(paid)} to Client Advance Credit & Cancel</button>`
      });
      document.getElementById('cnClose')!.onclick = closeModal;
      document.getElementById('cnConvertCredit')!.onclick = () => {
        // Convert existing payments on this invoice into client Advance Credit so Cash & Bank stays intact and Balance Sheet stays balanced!
        DB.payments = DB.payments.filter((p: any) => p.invoiceId !== inv.id);
        DB.refunds = (DB.refunds || []).filter((r: any) => r.invoiceId !== inv.id);
        DB.creditLedger.push({
          id: uid('cr'), clientId: inv.clientId, date: todayStr(), amount: paid, type: 'Advance',
          method: 'Bank', accountId: 'acc_bank', notes: `Converted from cancelled invoice ${inv.number}`
        });
        inv.status = 'Cancelled';
        inv.cancelledDate = todayStr();
        save(); closeModal();
        toast(`Invoice cancelled & ${BDT(paid)} moved to Client Advance Credit`);
        goTo('invoices', { view: inv.id });
      };
      return;
    }
    confirmAction('এই ইনভয়েসটি Cancel করবেন?', () => { inv.status = 'Cancelled'; inv.cancelledDate = todayStr(); save(); toast('Invoice cancelled'); goTo('invoices', { view: inv.id }); });
  });

  document.getElementById('addPayBtn')?.addEventListener('click', () => paymentForm(null, inv.id));
  document.getElementById('refundBtn')?.addEventListener('click', () => refundForm(inv));
  document.getElementById('applyCreditBtn')?.addEventListener('click', () => {
    const amt = Math.round(Math.min(credit, due) * 100) / 100;
    confirmAction(`${BDT(amt)} advance credit থেকে এই ইনভয়েসে apply করবেন?`, () => {
      applyCreditToInvoice(inv.clientId, inv.id, amt, todayStr());
      toast('Credit applied'); goTo('invoices', { view: inv.id });
    });
  });
}

function refundForm(inv: any) {
  const maxRefund = invoicePaid(inv.id);
  openModal({
    title: 'Record Refund — ' + inv.number,
    bodyHtml: `<div class="form-grid">
      <div class="field full"><label>Refund Amount (৳) * — max ${BDT(maxRefund)}</label><input type="number" id="f_amount" min="0" step="0.01" max="${maxRefund}"/></div>
      <div class="field"><label>Date</label><input type="date" id="f_date" value="${todayStr()}"/></div>
      <div class="field"><label>Method</label><select id="f_method">${['Cash', 'Bank', 'bKash', 'Nagad', 'Card', 'PayPal', 'Stripe', 'Wise', 'Other'].map(m => `<option>${m}</option>`).join('')}</select></div>
      <div class="field"><label>Refund From Account</label><select id="f_account">${DB.accounts.map((a: any) => `<option value="${a.id}" ${a.id === 'acc_bank' ? 'selected' : ''}>${escapeHtml(a.name)} (${BDT(accountBalance(a.id))})</option>`).join('')}</select></div>
      <div class="field full"><label>Reason / Notes</label><input id="f_notes"/></div>
    </div>`,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-danger" id="cSave" style="border-color:var(--red);">Record Refund</button>`
  });
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    const amount = Number((document.getElementById('f_amount') as HTMLInputElement).value || 0);
    if (!amount || amount <= 0 || !isFinite(amount)) { toast('Enter a valid positive amount', true); return; }
    if (amount > maxRefund + 0.5) { toast(`Refund amount can't exceed net received (${BDT(maxRefund)})`, true); return; }
    DB.refunds.push({
      id: uid('rf'), invoiceId: inv.id, clientId: inv.clientId, amount,
      date: (document.getElementById('f_date') as HTMLInputElement).value,
      method: (document.getElementById('f_method') as HTMLSelectElement).value,
      accountId: (document.getElementById('f_account') as HTMLSelectElement).value,
      notes: (document.getElementById('f_notes') as HTMLInputElement).value
    });
    save(); closeModal(); toast('Refund recorded'); goTo('invoices', { view: inv.id });
  };
}

export function exportInvoicesCSV() {
  const rows: any[][] = [['Invoice', 'Client', 'Date', 'Due Date', 'Total', 'Paid', 'Due', 'Status']];
  DB.invoices.forEach((i: any) => { const t = invoiceTotals(i); const paid = invoicePaid(i.id); rows.push([i.number, clientName(i.clientId), i.date, i.dueDate, t.total.toFixed(2), paid.toFixed(2), (t.total - paid).toFixed(2), invoiceStatus(i)]); });
  downloadCSV(rows, 'invoices.csv');
}

/* ========================= RECURRING BILLING PAGE ========================= */
PAGES['recurring'] = function (root) {
  const recClients = DB.clients.filter((c: any) => c.status === 'Active' && Number(c.monthlyPackage) > 0);
  const pendingPairs = allPendingRecurring();
  const recurringInvoices = DB.invoices.filter((i: any) => i.recurring).sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
  const monthLabel = (mk: string) => new Date(mk + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Recurring Billing Automation</h2><div class="desc">প্রতি মাসে subscription clients-দের জন্য invoice generate করুন</div></div>
      <div class="section-actions"><button class="btn btn-gold" id="genRecBtn" ${!pendingPairs.length ? 'disabled' : ''}><i class="fa-solid fa-bolt"></i> Generate All Pending (${pendingPairs.length})</button></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Recurring Clients — Status at a Glance</h3></div>
      <div class="panel-body table-wrap">
      ${recClients.length ? `<table><thead><tr><th>Client</th><th class="num">Monthly Amount</th><th>Payment Terms</th><th>Status</th><th></th></tr></thead><tbody>
        ${recClients.map((c: any) => {
          const pend = pendingPairs.filter(p => p.client.id === c.id);
          const upToDate = pend.length === 0;
          return `<tr>
            <td class="name-cell"><span class="client-avatar">${initials(c.name)}</span>${escapeHtml(c.name)}</td>
            <td class="num">${BDT(c.monthlyPackage)}</td>
            <td>${escapeHtml(c.paymentTerms || '—')}</td>
            <td>${upToDate ? `<span class="badge badge-active">Up to date</span>` : `<span class="badge badge-partial">${pend.length} month${pend.length > 1 ? 's' : ''} pending</span>`}</td>
            <td class="row-actions">${upToDate ? '' : `<button class="btn btn-sm btn-gold" data-gen-one="${c.id}">Generate Now</button>`}</td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot class="total-foot"><tr><td>TOTAL MRR (${recClients.length} clients)</td><td class="num">${BDT(recClients.reduce((s: number, c: any) => s + Number(c.monthlyPackage || 0), 0))}</td><td colspan="3"></td></tr></tfoot>
      </table>` : emptyState('fa-rotate', 'কোনো active monthly package client নেই।')}
      </div>
    </div>
    ${pendingPairs.length ? `<div class="panel"><div class="panel-head"><h3>Pending Invoice Detail (all missing months)</h3></div>
      <div class="panel-body table-wrap"><table><thead><tr><th>Client</th><th>Month</th><th class="num">Amount</th></tr></thead><tbody>${pendingPairs.map(p => `<tr><td>${escapeHtml(p.client.name)}</td><td>${monthLabel(p.monthKey)}</td><td class="num">${BDT(p.client.monthlyPackage)}</td></tr>`).join('')}</tbody><tfoot class="total-foot"><tr><td colspan="2">TOTAL PENDING (${pendingPairs.length} invoices)</td><td class="num" style="color:var(--red);">${BDT(pendingPairs.reduce((s, p) => s + Number(p.client.monthlyPackage || 0), 0))}</td></tr></tfoot></table></div></div>` : ''}
    <div class="panel"><div class="panel-head"><h3>Recurring Invoice History</h3></div>
      <div class="panel-body table-wrap">${recurringInvoices.length ? invoiceMiniTable(recurringInvoices) : emptyState('fa-file-invoice', 'এখনো কোনো recurring invoice নেই।')}</div></div>
  `;
  function generatePairs(pairs: { client: any; monthKey: string }[]) {
    let count = 0;
    pairs.forEach(({ client: c, monthKey: mk }) => {
      const [y, m] = mk.split('-').map(Number);
      const isCurrentMonth = mk === monthKey(todayStr());
      const invDate = isCurrentMonth ? new Date() : new Date(y, m - 1, 1);
      const svc = [{ serviceId: '', name: 'Monthly Retainer — ' + (c.company || c.name) + ' (' + new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + ')', qty: 1, price: c.monthlyPackage, discount: 0, tax: 0, isPackage: true }];
      const termsDays = ({ 'Due on Receipt': 0, 'Net 7': 7, 'Net 15': 15, 'Net 30': 30 } as Record<string, number>)[c.paymentTerms] ?? 15;
      const due = new Date(invDate); due.setDate(due.getDate() + termsDays);
      DB.invoices.push({
        id: uid('inv'), number: nextInvoiceNumber(), clientId: c.id, date: toLocalISODate(invDate), dueDate: toLocalISODate(due),
        method: 'Bank', items: svc, discount: 0, tax: 0, notes: 'Auto-generated recurring invoice', recurring: true, recurringPeriod: 'Monthly', status: 'Pending'
      });
      count++;
    });
    save(); toast(`${count} recurring invoice(s) generated`); goTo('recurring');
  }
  document.getElementById('genRecBtn')?.addEventListener('click', () => generatePairs(pendingPairs));
  root.querySelectorAll('[data-gen-one]').forEach((b: any) => b.addEventListener('click', () => {
    generatePairs(pendingPairs.filter(p => p.client.id === b.dataset.genOne));
  }));
};

/* ========================= PAYMENTS, DUE & REMINDERS ========================= */
const paymentRangeState = { preset: 'all', from: '', to: '' };
PAGES['payments'] = function (root) {
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Payments</h2><div class="desc">Complete payment history across all clients</div></div>
      <div class="section-actions">
        <button class="btn" id="exportPayBtn"><i class="fa-solid fa-download"></i> Export CSV</button>
        <button class="btn" id="clientPayBtn" ${!DB.clients.length ? 'disabled' : ''}><i class="fa-solid fa-layer-group"></i> Client Payment (Auto-Allocate)</button>
        <button class="btn btn-gold" id="addPayBtn" ${!DB.invoices.length ? 'disabled title="Create an invoice first"' : ''}><i class="fa-solid fa-plus"></i> Add Payment</button>
      </div>
    </div>
    <div class="filter-bar">${genRangeBarHtml(paymentRangeState, 'pay')}</div>
    <div class="panel"><div class="panel-body table-wrap" id="payTableWrap"></div></div>
  `;
  document.getElementById('addPayBtn')?.addEventListener('click', () => paymentForm());
  document.getElementById('clientPayBtn')?.addEventListener('click', () => clientPaymentForm());
  document.getElementById('exportPayBtn')?.addEventListener('click', () => {
    const { from, to } = genRangeBounds(paymentRangeState);
    const rows: any[][] = [['Payment ID', 'Client', 'Invoice', 'Amount', 'Date', 'Method', 'Transaction ID', 'Received By']];
    DB.payments.filter((p: any) => (!from || p.date >= from) && (!to || p.date <= to)).forEach((p: any) => rows.push([p.id, clientName(p.clientId), (invoiceById(p.invoiceId) || {}).number || '—', p.amount, p.date, p.method, p.txnId || '', p.receivedBy || '']));
    downloadCSV(rows, 'payments.csv');
  });
  genRangeWire(paymentRangeState, 'pay', renderPaymentsTable);
  renderPaymentsTable();
};

function renderPaymentsTable() {
  const wrap = document.getElementById('payTableWrap');
  if (!wrap) return;
  const { from, to } = genRangeBounds(paymentRangeState);
  const filteredPayments = DB.payments.filter((p: any) => (!from || p.date >= from) && (!to || p.date <= to));
  if (!filteredPayments.length) { wrap.innerHTML = emptyState('fa-money-bill-wave', 'এই সময়সীমায় কোনো payment নেই।'); return; }
  const groups: Record<string, any[]> = {};
  filteredPayments.forEach((p: any) => {
    const key = p.groupId || p.id;
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });
  const groupList = Object.values(groups).sort((a, b) => (b[0].date || '').localeCompare(a[0].date || ''));
  const rows = groupList.map(grp => {
    const first = grp[0];
    const totalAmt = grp.reduce((s, p) => s + Number(p.amount || 0), 0);
    const invoiceLabel = grp.length === 1 ? (invoiceById(first.invoiceId) || {}).number || '—' : `${grp.length} invoices`;
    const expandable = grp.length > 1;
    const groupKey = first.groupId || first.id;
    return `<tr class="${expandable ? 'pay-group-row' : ''}" ${expandable ? `data-toggle="${groupKey}"` : ''} style="${expandable ? 'cursor:pointer;' : ''}">
      <td>${fmtDate(first.date)}${expandable ? ` <i class="fa-solid fa-chevron-down" style="font-size:10px;color:var(--muted);margin-left:4px;" data-chevron="${groupKey}"></i>` : ''}</td>
      <td>${escapeHtml(clientName(first.clientId))}</td>
      <td>${expandable ? `<span class="pill">${escapeHtml(invoiceLabel)}</span>` : escapeHtml(invoiceLabel)}</td>
      <td class="num" style="color:var(--teal);font-weight:${expandable ? '700' : '400'};">${BDT(totalAmt)}</td>
      <td>${escapeHtml(first.method)}</td>
      <td>${escapeHtml(first.txnId || '—')}</td>
      <td>${escapeHtml(first.receivedBy || '—')}</td>
      <td class="row-actions">${expandable ? '' : `<button class="icon-btn" data-del="${first.id}"><i class="fa-solid fa-trash"></i></button>`}</td>
    </tr>
    ${expandable ? `<tr class="pay-detail-row" data-detail="${groupKey}" style="display:none;">
      <td colspan="8" style="padding:0;background:var(--paper);">
        <table style="width:100%;"><tbody>
        ${grp.map(p => { const inv = invoiceById(p.invoiceId); return `<tr><td style="width:14%;color:var(--muted);font-size:12px;">↳ ${fmtDate(p.date)}</td><td style="width:30%;">${escapeHtml(inv ? inv.number : '—')}</td><td class="num" style="width:14%;color:var(--teal);">${BDT(p.amount)}</td><td style="width:14%;">${escapeHtml(p.method)}</td><td style="width:14%;">${escapeHtml(p.txnId || '—')}</td><td style="text-align:right;width:14%;"><button class="icon-btn" data-del="${p.id}"><i class="fa-solid fa-trash"></i></button></td></tr>`; }).join('')}
        </tbody></table>
      </td>
    </tr>` : ''}`;
  }).join('');
  const payTotal = filteredPayments.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const refTotal = (DB.refunds || []).filter((r: any) => (!from || r.date >= from) && (!to || r.date <= to)).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  wrap.innerHTML = `<table><thead><tr><th>Date</th><th>Client</th><th>Invoice</th><th class="num">Amount</th><th>Method</th><th>Txn ID</th><th>Received By</th><th></th></tr></thead><tbody>${rows}</tbody>
    <tfoot class="total-foot">
      <tr class="subtotal"><td colspan="3">Gross Allocated (${filteredPayments.length} entries)</td><td class="num">${BDT(payTotal)}</td><td colspan="4"></td></tr>
      ${refTotal ? `<tr class="subtotal"><td colspan="3">Less: Refunds</td><td class="num" style="color:var(--red);">- ${BDT(refTotal)}</td><td colspan="4"></td></tr>` : ''}
      <tr><td colspan="3">NET ALLOCATED</td><td class="num" style="color:var(--teal);">${BDT(payTotal - refTotal)}</td><td colspan="4"></td></tr>
    </tfoot></table>`;
  wrap.querySelectorAll('[data-toggle]').forEach((tr: any) => tr.addEventListener('click', (e: any) => {
    if (e.target.closest('[data-del]')) return;
    const key = tr.dataset.toggle;
    const detail = wrap.querySelector(`[data-detail="${key}"]`) as HTMLElement;
    const chevron = wrap.querySelector(`[data-chevron="${key}"]`) as HTMLElement;
    if (detail) { const show = detail.style.display === 'none'; detail.style.display = show ? '' : 'none'; if (chevron) chevron.style.transform = show ? 'rotate(180deg)' : ''; }
  }));
  wrap.querySelectorAll('[data-del]').forEach((b: any) => b.addEventListener('click', (e: any) => {
    e.stopPropagation();
    confirmAction('এই payment রেকর্ডটি ডিলিট করবেন?', () => { DB.payments = DB.payments.filter((p: any) => p.id !== b.dataset.del); save(); toast('Payment deleted'); renderPaymentsTable(); });
  }));
}

export function paymentForm(existing?: any, presetInvoiceId?: string) {
  const p = existing || { date: todayStr(), method: 'Bank', accountId: 'acc_bank', invoiceId: presetInvoiceId || '' };
  const clientInvoices = DB.invoices.filter((i: any) => i.status !== 'Cancelled');
  openModal({
    title: existing ? 'Edit Payment' : 'Record Payment',
    bodyHtml: `<div class="form-grid">
      <div class="field full"><label>Invoice *</label><select id="f_invoice">
        <option value="">Select invoice…</option>
        ${clientInvoices.map((i: any) => { const t = invoiceTotals(i); const due = t.total - invoicePaid(i.id); return `<option value="${i.id}" ${p.invoiceId === i.id ? 'selected' : ''}>${escapeHtml(i.number)} — ${escapeHtml(clientName(i.clientId))} (Due: ${BDT(due)})</option>`; }).join('')}
      </select></div>
      <div class="field"><label>Amount (৳) *</label><input type="number" id="f_amount" value="${p.amount || ''}" min="0" step="0.01"/></div>
      <div class="field"><label>Date</label><input type="date" id="f_date" value="${p.date}"/></div>
      <div class="field"><label>Method</label><select id="f_method">${['Cash', 'Bank', 'bKash', 'Nagad', 'Card', 'PayPal', 'Stripe', 'Wise', 'Other'].map(m => `<option ${p.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div class="field"><label>Deposit To Account</label><select id="f_account">${DB.accounts.map((a: any) => `<option value="${a.id}" ${p.accountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Transaction ID</label><input id="f_txn" value="${escapeHtml(p.txnId || '')}"/></div>
      <div class="field"><label>Received By</label><input id="f_by" value="${escapeHtml(p.receivedBy || '')}"/></div>
      <div class="field full"><label>Notes</label><input id="f_notes" value="${escapeHtml(p.notes || '')}"/></div>
    </div>`,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-primary" id="cSave">${existing ? 'Save' : 'Record Payment'}</button>`
  });
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    const invoiceId = (document.getElementById('f_invoice') as HTMLSelectElement).value;
    const amount = Number((document.getElementById('f_amount') as HTMLInputElement).value || 0);
    if (!invoiceId) { toast('Select an invoice', true); return; }
    if (!amount || amount <= 0 || !isFinite(amount)) { toast('Enter a valid positive amount', true); return; }
    const inv = invoiceById(invoiceId);
    const due = invoiceTotals(inv).total - invoicePaid(inv.id) + (existing ? Number(existing.amount || 0) : 0);
    const date = (document.getElementById('f_date') as HTMLInputElement).value;
    const method = (document.getElementById('f_method') as HTMLSelectElement).value;
    const accountId = (document.getElementById('f_account') as HTMLSelectElement).value;
    const txnId = (document.getElementById('f_txn') as HTMLInputElement).value;
    const receivedBy = (document.getElementById('f_by') as HTMLInputElement).value;
    const notes = (document.getElementById('f_notes') as HTMLInputElement).value;

    const finalizeSave = (payAmount: number, extraCredit: number) => {
      const data = { id: p.id || uid('pay'), invoiceId, clientId: inv.clientId, amount: payAmount, date, method, accountId, txnId, receivedBy, notes };
      if (existing) Object.assign(existing, data); else DB.payments.push(data);
      if (extraCredit > 0.5) {
        DB.creditLedger.push({
          id: uid('cr'), clientId: inv.clientId, date, amount: extraCredit, type: 'Advance',
          method, accountId, notes: 'Overpayment on ' + inv.number + ' converted to advance credit'
        });
      }
      save(); closeModal(); toast(extraCredit > 0.5 ? `Payment recorded. ${BDT(extraCredit)} added as client advance credit.` : 'Payment recorded');
      if (currentPage === 'invoices' && currentParams.view) goTo('invoices', { view: currentParams.view }); else goTo('payments');
    };

    const proceedWithDupCheck = (payAmount: number, extraCredit: number) => {
      const dup = DB.payments.find((x: any) => x.id !== p.id && x.invoiceId === invoiceId && Math.abs(Number(x.amount) - amount) < 0.5 && x.date === date);
      if (dup) {
        confirmAction(`একই invoice-এ ${fmtDate(date)} তারিখে ${BDT(amount)} টাকার আরেকটি payment ইতিমধ্যে আছে। তবুও সংরক্ষণ করতে চান?`, () => finalizeSave(payAmount, extraCredit));
      } else {
        finalizeSave(payAmount, extraCredit);
      }
    };

    if (amount > due + 0.5) {
      const overpay = Math.round((amount - due) * 100) / 100;
      confirmAction(`Payment amount (${BDT(amount)}) এই ইনভয়েসের বাকি (${BDT(due)}) থেকে বেশি। অতিরিক্ত ${BDT(overpay)} ক্লায়েন্টের Advance Credit হিসেবে জমা হবে — এগিয়ে যাবেন?`, () => {
        proceedWithDupCheck(Math.round(due * 100) / 100, overpay);
      });
      return;
    }
    proceedWithDupCheck(amount, 0);
  };
}

export function clientPaymentForm(presetClientId?: string) {
  openModal({
    title: 'Client Payment (Auto-Allocate)',
    bodyHtml: `<p class="hint" style="margin-bottom:10px;">একটি amount দিলে সিস্টেম automatically ক্লায়েন্টের সবচেয়ে পুরনো unpaid invoice থেকে শুরু করে (FIFO) allocate করবে। বাকি টাকা থাকলে Advance Credit হিসেবে জমা হবে।</p>
    <div class="form-grid">
      <div class="field full"><label>Client *</label><select id="f_client">
        <option value="">Select client…</option>
        ${DB.clients.map((c: any) => `<option value="${c.id}" ${presetClientId === c.id ? 'selected' : ''}>${escapeHtml(c.name)} — Open due: ${BDT(clientFinancials(c.id).due)} · Credit: ${BDT(creditBalance(c.id))}</option>`).join('')}
      </select></div>
      <div class="field"><label>Amount (৳) *</label><input type="number" id="f_amount" min="0" step="0.01"/></div>
      <div class="field"><label>Date</label><input type="date" id="f_date" value="${todayStr()}"/></div>
      <div class="field"><label>Method</label><select id="f_method">${['Cash', 'Bank', 'bKash', 'Nagad', 'Card', 'PayPal', 'Stripe', 'Wise', 'Other'].map(m => `<option>${m}</option>`).join('')}</select></div>
      <div class="field"><label>Deposit To Account</label><select id="f_account">${DB.accounts.map((a: any) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select></div>
      <div class="field full"><label>Notes</label><input id="f_notes"/></div>
    </div>
    <div id="allocPreview" class="hint" style="margin-top:10px;"></div>`,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-primary" id="cSave">Allocate Payment</button>`
  });
  function updatePreview() {
    const clientId = (document.getElementById('f_client') as HTMLSelectElement).value;
    const amount = Number((document.getElementById('f_amount') as HTMLInputElement).value || 0);
    const box = document.getElementById('allocPreview')!;
    if (!clientId || !amount) { box.innerHTML = ''; return; }
    let remaining = amount; const lines: string[] = [];
    clientOpenInvoices(clientId).forEach((inv: any) => {
      if (remaining <= 0.5) return;
      const due = invoiceTotals(inv).total - invoicePaid(inv.id);
      const pay = Math.min(remaining, due);
      lines.push(`${escapeHtml(inv.number)}: ${BDT(pay)} (due was ${BDT(due)})`);
      remaining -= pay;
    });
    if (remaining > 0.5) lines.push(`Remaining → Advance Credit: ${BDT(remaining)}`);
    box.innerHTML = lines.length ? '<b>Allocation preview:</b><br>' + lines.join('<br>') : 'কোনো open invoice নেই — পুরো amount Advance Credit হবে।';
  }
  document.getElementById('f_client')?.addEventListener('change', updatePreview);
  document.getElementById('f_amount')?.addEventListener('input', updatePreview);
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    const clientId = (document.getElementById('f_client') as HTMLSelectElement).value;
    const amount = Number((document.getElementById('f_amount') as HTMLInputElement).value || 0);
    if (!clientId) { toast('Select a client', true); return; }
    if (!amount || amount <= 0 || !isFinite(amount)) { toast('Enter a valid positive amount', true); return; }
    const date = (document.getElementById('f_date') as HTMLInputElement).value;
    const method = (document.getElementById('f_method') as HTMLSelectElement).value;
    const accountId = (document.getElementById('f_account') as HTMLSelectElement).value;
    const notes = (document.getElementById('f_notes') as HTMLInputElement).value;
    const result = allocateClientPayment(clientId, amount, date, method, accountId, notes);
    closeModal();
    toast(result.creditAdded > 0.5 ? `Allocated across ${result.created.length} invoice(s). ${BDT(result.creditAdded)} added as advance credit.` : `Allocated across ${result.created.length} invoice(s).`);
    if (currentPage === 'clients' && currentParams.view === clientId) goTo('clients', { view: clientId }); else goTo('payments');
  };
}

PAGES['due'] = function (root) {
  const list = dueInvoices();
  const totalDue = list.reduce((s: number, i: any) => s + (invoiceTotals(i).total - invoicePaid(i.id)), 0);
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Due / Baki Management</h2><div class="desc">${list.length} invoice(s) pending payment</div></div>
      <div class="section-actions"><div class="kpi accent-red" style="padding:8px 16px;"><div class="kpi-label">Total Outstanding</div><div class="kpi-value num" style="font-size:19px;">${BDT(totalDue)}</div></div></div>
    </div>
    <div class="panel"><div class="panel-body table-wrap">
    ${!list.length ? emptyState('fa-circle-check', 'সব ইনভয়েস পরিশোধিত — কোনো বাকি নেই!') : (() => {
      const rows = list.sort((a: any, b: any) => (a.dueDate || '').localeCompare(b.dueDate || '')).map((i: any) => {
        const t = invoiceTotals(i); const due = t.total - invoicePaid(i.id); const status = invoiceStatus(i);
        const days = daysBetween(todayStr(), i.dueDate);
        return `<tr>
          <td>${escapeHtml(clientName(i.clientId))}</td>
          <td style="cursor:pointer;font-weight:600;" data-view="${i.id}">${escapeHtml(i.number)}</td>
          <td class="num" style="color:var(--red)">${BDT(due)}</td>
          <td>${fmtDate(i.dueDate)}</td>
          <td>${days < 0 ? `${Math.abs(days)} days overdue` : days === 0 ? 'Due today' : `in ${days} days`}</td>
          <td><span class="badge ${statusBadgeClass(status)}">${status}</span></td>
          <td class="row-actions"><button class="btn btn-sm" data-pay="${i.id}">Record Payment</button></td>
        </tr>`;
      }).join('');
      const dueTotal = list.reduce((s: number, i: any) => s + (invoiceTotals(i).total - invoicePaid(i.id)), 0);
      return `<table><thead><tr><th>Client</th><th>Invoice</th><th class="num">Due Amount</th><th>Due Date</th><th>Status</th><th>Badge</th><th></th></tr></thead><tbody>${rows}</tbody>
        <tfoot class="total-foot"><tr><td colspan="2">TOTAL DUE (${list.length} invoices)</td><td class="num" style="color:var(--red);">${BDT(dueTotal)}</td><td colspan="4"></td></tr></tfoot></table>`;
    })()}
    </div></div>
  `;
  root.querySelectorAll('[data-view]').forEach((b: any) => b.addEventListener('click', () => goTo('invoices', { view: b.dataset.view })));
  root.querySelectorAll('[data-pay]').forEach((b: any) => b.addEventListener('click', () => paymentForm(null, b.dataset.pay)));
};

PAGES['reminders'] = function (root) {
  const list = dueInvoices();
  const today = todayStr();
  function bucket(i: any) {
    const d = daysBetween(today, i.dueDate);
    if (d < 0) return { label: 'Overdue Reminder', cls: 'badge-overdue', note: `${Math.abs(d)} দিন অতিক্রান্ত` };
    if (d === 0) return { label: 'Due Today', cls: 'badge-partial', note: 'আজই due date' };
    if (d <= 3) return { label: 'Upcoming Reminder', cls: 'badge-pending', note: `${d} দিন বাকি` };
    return { label: 'Scheduled', cls: 'badge-draft', note: `${d} দিন বাকি` };
  }
  root.innerHTML = `
    <div class="section-head"><div><h2>Automatic Payment Reminders</h2><div class="desc">Due date অনুযায়ী client-দের reminder schedule</div></div></div>
    <div class="panel"><div class="panel-head"><h3>Reminder Queue</h3></div><div class="panel-body table-wrap">
    ${!list.length ? emptyState('fa-bell-slash', 'এই মুহূর্তে কোনো reminder পাঠানোর দরকার নেই।') : (() => {
      const rows = list.sort((a: any, b: any) => (a.dueDate || '').localeCompare(b.dueDate || '')).map((i: any) => {
        const c = clientById(i.clientId) || {}; const t = invoiceTotals(i); const due = t.total - invoicePaid(i.id); const b = bucket(i);
        return `<tr><td>${escapeHtml(c.name || '')}</td><td>${escapeHtml(c.phone || c.email || '—')}</td><td>${escapeHtml(i.number)}</td><td class="num">${BDT(due)}</td><td>${fmtDate(i.dueDate)}</td><td><span class="badge ${b.cls}">${b.label}</span></td><td class="muted">${b.note}</td></tr>`;
      }).join('');
      const remTotal = list.reduce((s: number, i: any) => s + (invoiceTotals(i).total - invoicePaid(i.id)), 0);
      return `<table><thead><tr><th>Client</th><th>Contact</th><th>Invoice</th><th class="num">Due</th><th>Due Date</th><th>Reminder</th><th>Note</th></tr></thead><tbody>${rows}</tbody>
        <tfoot class="total-foot"><tr><td colspan="3">TOTAL TO CHASE (${list.length} reminders)</td><td class="num" style="color:var(--red);">${BDT(remTotal)}</td><td colspan="3"></td></tr></tfoot></table>`;
    })()}
    </div></div>
  `;
};
