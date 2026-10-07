import { BDT, toLocalISODate, todayStr, uid, monthKey, fmtDate, daysBetween, escapeHtml } from './ledgerHelpers';
import {
  DB, save, toast, PAGES, goTo, openModal, closeModal, confirmAction,
  emptyState, downloadCSV, genRangeBounds, genRangeBarHtml, genRangeWire, registerChart,
  clientById, serviceById, invoiceById, accountById, clientName, initials, invoiceTotals,
  employeePaidTotal, expenseCategories, categoryNames, categoryType, isCOS,
  typeLabel, typeBadge, accountBalance, last6Months, nextInvoiceNumber, nextQuoteNumber, statusBadgeClass
} from './ledgerCore';
import { printStatementDoc, printQuotationDoc, printGenericReportDoc } from './ledgerPrinters';

declare const Chart: any;

/* ========================= SERVICES ========================= */
PAGES['services'] = function (root) {
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Services</h2><div class="desc">এজেন্সি যেসব সার্ভিস বিক্রি করে তার তালিকা ও pricing</div></div>
      <div class="section-actions"><button class="btn btn-gold" id="addSvcBtn"><i class="fa-solid fa-plus"></i> Add Service</button></div>
    </div>
    <div class="panel"><div class="panel-body table-wrap" id="svcTableWrap"></div></div>
  `;
  document.getElementById('addSvcBtn')?.addEventListener('click', () => serviceForm());
  renderServiceTable();
};

function renderServiceTable() {
  const wrap = document.getElementById('svcTableWrap');
  if (!wrap) return;
  if (!DB.services.length) { wrap.innerHTML = emptyState('fa-layer-group', 'কোনো সার্ভিস যোগ করা হয়নি।'); return; }
  const rows = DB.services.map((s: any) => {
    const margin = s.price ? Math.round((s.price - s.cost) / s.price * 100) : 0;
    return `<tr>
      <td style="font-weight:600;">${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.billingType)}</td>
      <td class="num">${BDT(s.price)}</td>
      <td class="num">${BDT(s.cost)}</td>
      <td class="num" style="color:${margin >= 0 ? 'var(--teal)' : 'var(--red)'}">${margin}%</td>
      <td>${s.tax || 0}%</td>
      <td class="row-actions">
        <button class="icon-btn" data-edit="${s.id}"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-btn" data-del="${s.id}"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
  const sPrice = DB.services.reduce((a: number, s: any) => a + Number(s.price || 0), 0);
  const sCost = DB.services.reduce((a: number, s: any) => a + Number(s.cost || 0), 0);
  const sMargin = sPrice ? Math.round((sPrice - sCost) / sPrice * 100) : 0;
  wrap.innerHTML = `<table><thead><tr><th>Service</th><th>Billing</th><th class="num">Price</th><th class="num">Cost</th><th class="num">Margin</th><th>Tax</th><th></th></tr></thead><tbody>${rows}</tbody>
    <tfoot class="total-foot"><tr><td colspan="2">TOTAL (${DB.services.length} services)</td><td class="num">${BDT(sPrice)}</td><td class="num">${BDT(sCost)}</td><td class="num" style="color:${sMargin >= 0 ? 'var(--teal)' : 'var(--red)'};">${sMargin}%</td><td colspan="2"></td></tr></tfoot></table>`;
  wrap.querySelectorAll('[data-edit]').forEach((b: any) => b.addEventListener('click', () => serviceForm(serviceById(b.dataset.edit))));
  wrap.querySelectorAll('[data-del]').forEach((b: any) => b.addEventListener('click', () => {
    confirmAction('এই সার্ভিসটি ডিলিট করবেন?', () => { DB.services = DB.services.filter((s: any) => s.id !== b.dataset.del); save(); toast('Service deleted'); renderServiceTable(); });
  }));
}

function serviceForm(existing?: any) {
  const s = existing || { billingType: 'Monthly', tax: 0, discount: 0 };
  openModal({
    title: existing ? 'Edit Service' : 'Add Service',
    bodyHtml: `<div class="form-grid">
      <div class="field full"><label>Service Name *</label><input id="f_name" value="${escapeHtml(s.name || '')}"/></div>
      <div class="field"><label>Price (৳)</label><input type="number" id="f_price" value="${s.price || 0}" min="0"/></div>
      <div class="field"><label>Cost (৳)</label><input type="number" id="f_cost" value="${s.cost || 0}" min="0"/></div>
      <div class="field"><label>Billing Type</label><select id="f_billing"><option ${s.billingType === 'Monthly' ? 'selected' : ''}>Monthly</option><option ${s.billingType === 'One-time' ? 'selected' : ''}>One-time</option></select></div>
      <div class="field"><label>Tax (%)</label><input type="number" id="f_tax" value="${s.tax || 0}" min="0"/></div>
    </div>`,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-primary" id="cSave">${existing ? 'Save' : 'Add Service'}</button>`
  });
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    const name = (document.getElementById('f_name') as HTMLInputElement).value.trim();
    if (!name) { toast('Service name required', true); return; }
    const data = { id: s.id || uid('svc'), name, price: Number((document.getElementById('f_price') as HTMLInputElement).value || 0), cost: Number((document.getElementById('f_cost') as HTMLInputElement).value || 0), billingType: (document.getElementById('f_billing') as HTMLSelectElement).value, tax: Number((document.getElementById('f_tax') as HTMLInputElement).value || 0) };
    if (existing) Object.assign(existing, data); else DB.services.push(data);
    save(); closeModal(); toast('Service saved'); renderServiceTable();
  };
}

/* ========================= PACKAGES ========================= */
PAGES['packages'] = function (root) {
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Packages</h2><div class="desc">Bundle multiple services into a pricing package</div></div>
      <div class="section-actions"><button class="btn btn-gold" id="addPkgBtn" ${!DB.services.length ? 'disabled title="Add a service first"' : ''}><i class="fa-solid fa-plus"></i> Add Package</button></div>
    </div>
    <div class="panel"><div class="panel-body" id="pkgWrap"></div></div>
  `;
  document.getElementById('addPkgBtn')?.addEventListener('click', () => packageForm());
  renderPackages();
};

function renderPackages() {
  const wrap = document.getElementById('pkgWrap');
  if (!wrap) return;
  if (!DB.packages.length) { wrap.innerHTML = emptyState('fa-box-archive', 'কোনো প্যাকেজ তৈরি হয়নি।'); return; }
  wrap.innerHTML = `<div class="grid-3">${DB.packages.map((p: any) => {
    const svcNames = (p.serviceIds || []).map((id: string) => (serviceById(id) || {}).name).filter(Boolean);
    return `<div class="panel" style="margin-bottom:0;">
      <div class="panel-head"><h3>${escapeHtml(p.name)}</h3><span class="pill">${escapeHtml(p.billingCycle)}</span></div>
      <div class="panel-body">
        <div class="kpi-value num" style="font-size:22px;margin-bottom:8px;">${BDT(p.price)}<span class="muted" style="font-size:12px;">/${p.billingCycle === 'Monthly' ? 'mo' : 'yr'}</span></div>
        <div class="hint" style="margin-bottom:10px;">${svcNames.map((n: string) => `<span class="pill" style="margin:2px 4px 2px 0;">${escapeHtml(n)}</span>`).join('')}</div>
        <div class="row-actions"><button class="icon-btn" data-edit="${p.id}"><i class="fa-solid fa-pen"></i></button><button class="icon-btn" data-del="${p.id}"><i class="fa-solid fa-trash"></i></button></div>
      </div></div>`;
  }).join('')}</div>`;
  wrap.querySelectorAll('[data-edit]').forEach((b: any) => b.addEventListener('click', () => packageForm(DB.packages.find((p: any) => p.id === b.dataset.edit))));
  wrap.querySelectorAll('[data-del]').forEach((b: any) => b.addEventListener('click', () => {
    confirmAction('প্যাকেজটি ডিলিট করবেন?', () => { DB.packages = DB.packages.filter((p: any) => p.id !== b.dataset.del); save(); toast('Package deleted'); renderPackages(); });
  }));
}

function packageForm(existing?: any) {
  const p = existing || { billingCycle: 'Monthly', serviceIds: [] };
  openModal({
    title: existing ? 'Edit Package' : 'Add Package',
    bodyHtml: `<div class="form-grid">
      <div class="field full"><label>Package Name *</label><input id="f_name" value="${escapeHtml(p.name || '')}"/></div>
      <div class="field"><label>Price (৳)</label><input type="number" id="f_price" value="${p.price || 0}" min="0"/></div>
      <div class="field"><label>Billing Cycle</label><select id="f_cycle"><option ${p.billingCycle === 'Monthly' ? 'selected' : ''}>Monthly</option><option ${p.billingCycle === 'Yearly' ? 'selected' : ''}>Yearly</option></select></div>
      <div class="field full"><label>Included Services</label>
        <div style="border:1px solid var(--line);padding:10px;max-height:150px;overflow-y:auto;background:#fff;">
        ${DB.services.map((s: any) => `<label style="display:flex;gap:8px;align-items:center;padding:4px 0;font-size:13px;"><input type="checkbox" value="${s.id}" class="svcChk" ${(p.serviceIds || []).includes(s.id) ? 'checked' : ''}/> ${escapeHtml(s.name)} <span class="muted num">(${BDT(s.price)})</span></label>`).join('') || '<div class="muted">No services yet.</div>'}
        </div>
      </div>
    </div>`,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-primary" id="cSave">${existing ? 'Save' : 'Add Package'}</button>`
  });
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    const name = (document.getElementById('f_name') as HTMLInputElement).value.trim();
    if (!name) { toast('Package name required', true); return; }
    const serviceIds = [...document.querySelectorAll('.svcChk:checked')].map((c: any) => c.value);
    const data = { id: p.id || uid('pkg'), name, price: Number((document.getElementById('f_price') as HTMLInputElement).value || 0), billingCycle: (document.getElementById('f_cycle') as HTMLSelectElement).value, serviceIds };
    if (existing) Object.assign(existing, data); else DB.packages.push(data);
    save(); closeModal(); toast('Package saved'); renderPackages();
  };
}

/* ========================= QUOTATIONS ========================= */
PAGES['quotations'] = function (root) {
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Quotations</h2><div class="desc">Client নেওয়ার আগে quotation পাঠান, accept হলে invoice-এ convert করুন</div></div>
      <div class="section-actions"><button class="btn btn-gold" id="addQtBtn" ${!DB.clients.length ? 'disabled title="Add a client first"' : ''}><i class="fa-solid fa-plus"></i> Create Quotation</button></div>
    </div>
    <div class="panel"><div class="panel-body table-wrap" id="qtWrap"></div></div>
  `;
  document.getElementById('addQtBtn')?.addEventListener('click', () => quoteForm());
  renderQuotesTable();
};

function renderQuotesTable() {
  const wrap = document.getElementById('qtWrap');
  if (!wrap) return;
  if (!DB.quotations.length) { wrap.innerHTML = emptyState('fa-file-signature', 'কোনো quotation তৈরি করা হয়নি।'); return; }
  const rows = [...DB.quotations].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((q: any) => `<tr>
    <td>${escapeHtml(q.number)}</td><td>${escapeHtml(clientName(q.clientId))}</td><td>${fmtDate(q.date)}</td><td>${fmtDate(q.validUntil)}</td><td class="num">${BDT(q.total)}</td>
    <td><span class="badge ${statusBadgeClass(q.status)}">${q.status}</span></td>
    <td class="row-actions">
      <button class="icon-btn" data-print="${q.id}" title="Print / Save as PDF"><i class="fa-solid fa-file-pdf"></i></button>
      ${['Draft', 'Sent'].includes(q.status) ? `<button class="icon-btn" data-edit="${q.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>` : ''}
      ${q.status === 'Draft' ? `<button class="btn btn-sm" data-send="${q.id}">Mark Sent</button>` : ''}
      ${q.status === 'Sent' ? `<button class="btn btn-sm" data-accept="${q.id}">Accept</button><button class="btn btn-sm btn-danger" data-reject="${q.id}">Reject</button>` : ''}
      ${q.status === 'Accepted' ? `<button class="btn btn-sm btn-gold" data-convert="${q.id}">Convert to Invoice</button>` : ''}
      <button class="icon-btn" data-del="${q.id}"><i class="fa-solid fa-trash"></i></button>
    </td>
  </tr>`).join('');
  const qLive = DB.quotations.filter((q: any) => q.status !== 'Rejected');
  const qAcc = DB.quotations.filter((q: any) => q.status === 'Accepted');
  wrap.innerHTML = `<table><thead><tr><th>Quote #</th><th>Client</th><th>Date</th><th>Valid Until</th><th class="num">Total</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody>
    <tfoot class="total-foot">
      <tr class="subtotal"><td colspan="4">Accepted (${qAcc.length})</td><td class="num" style="color:var(--teal);">${BDT(qAcc.reduce((s: number, q: any) => s + Number(q.total || 0), 0))}</td><td colspan="2"></td></tr>
      <tr class="subtotal"><td colspan="4">Open pipeline — excludes Rejected (${qLive.length})</td><td class="num">${BDT(qLive.reduce((s: number, q: any) => s + Number(q.total || 0), 0))}</td><td colspan="2"></td></tr>
      <tr><td colspan="4">TOTAL QUOTED (${DB.quotations.length})</td><td class="num">${BDT(DB.quotations.reduce((s: number, q: any) => s + Number(q.total || 0), 0))}</td><td colspan="2"></td></tr>
    </tfoot></table>`;
  wrap.querySelectorAll('[data-print]').forEach((b: any) => b.addEventListener('click', () => {
    const q = DB.quotations.find((x: any) => x.id === b.dataset.print);
    if (q) printQuotationDoc(q, clientById(q.clientId) || {});
  }));
  wrap.querySelectorAll('[data-edit]').forEach((b: any) => b.addEventListener('click', () => quoteForm(DB.quotations.find((q: any) => q.id === b.dataset.edit))));
  wrap.querySelectorAll('[data-send]').forEach((b: any) => b.addEventListener('click', () => { DB.quotations.find((q: any) => q.id === b.dataset.send).status = 'Sent'; save(); renderQuotesTable(); }));
  wrap.querySelectorAll('[data-accept]').forEach((b: any) => b.addEventListener('click', () => { DB.quotations.find((q: any) => q.id === b.dataset.accept).status = 'Accepted'; save(); toast('Quotation accepted'); renderQuotesTable(); }));
  wrap.querySelectorAll('[data-reject]').forEach((b: any) => b.addEventListener('click', () => { DB.quotations.find((q: any) => q.id === b.dataset.reject).status = 'Rejected'; save(); renderQuotesTable(); }));
  wrap.querySelectorAll('[data-del]').forEach((b: any) => b.addEventListener('click', () => {
    confirmAction('এই quotation ডিলিট করবেন?', () => { DB.quotations = DB.quotations.filter((q: any) => q.id !== b.dataset.del); save(); toast('Deleted'); renderQuotesTable(); });
  }));
  wrap.querySelectorAll('[data-convert]').forEach((b: any) => b.addEventListener('click', () => {
    const q = DB.quotations.find((x: any) => x.id === b.dataset.convert);
    const inv = { id: uid('inv'), number: nextInvoiceNumber(), clientId: q.clientId, date: todayStr(), dueDate: todayStr(), method: 'Bank', items: q.items, discount: 0, tax: 0, notes: 'Converted from ' + q.number, recurring: false, recurringPeriod: 'Monthly', status: 'Pending' };
    DB.invoices.push(inv); q.status = 'Converted'; save(); toast('Converted to invoice ' + inv.number); goTo('invoices', { view: inv.id });
  }));
}

let quoteLineItems: any[] = [];
function quoteForm(existing?: any) {
  quoteLineItems = existing ? JSON.parse(JSON.stringify(existing.items || [])) : [{ serviceId: '', name: '', qty: 1, price: 0 }];
  if (!quoteLineItems.length) quoteLineItems.push({ serviceId: '', name: '', qty: 1, price: 0 });
  const valid = new Date(); valid.setDate(valid.getDate() + 14);
  const q = existing || { validUntil: toLocalISODate(valid), notes: '' };
  openModal({
    wide: true, title: existing ? `Edit Quotation ${existing.number}` : 'Create Quotation',
    bodyHtml: `<div class="form-grid">
      <div class="field"><label>Client *</label><select id="f_client" ${existing ? 'disabled' : ''}><option value="">Select…</option>${DB.clients.map((c: any) => `<option value="${c.id}" ${q.clientId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Valid Until</label><input type="date" id="f_valid" value="${q.validUntil}"/></div>
    </div>
    <div style="margin-top:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;"><label style="font-size:12px;color:var(--muted);font-weight:600;">SERVICES</label><button class="btn btn-sm" id="addQLine"><i class="fa-solid fa-plus"></i> Add Line</button></div>
      <table class="li-table"><thead><tr><th>Service</th><th>Qty</th><th>Price</th><th class="num">Total</th><th></th></tr></thead><tbody id="qLineBody"></tbody></table>
    </div>
    <div class="form-grid" style="margin-top:14px;"><div class="field full"><label>Terms / Notes</label><textarea id="f_notes">${escapeHtml(q.notes || '')}</textarea></div></div>
    <div class="li-totals" id="qTotals"></div>`,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-primary" id="cSave">${existing ? 'Save Changes' : 'Create Quotation'}</button>`
  });
  renderQLines();
  document.getElementById('addQLine')?.addEventListener('click', () => { quoteLineItems.push({ serviceId: '', name: '', qty: 1, price: 0 }); renderQLines(); });
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    const clientId = existing ? existing.clientId : (document.getElementById('f_client') as HTMLSelectElement).value;
    if (!clientId) { toast('Select a client', true); return; }
    const items = quoteLineItems.filter(l => l.name);
    if (!items.length) { toast('Add at least one service', true); return; }
    const total = items.reduce((s, l) => s + (l.qty || 1) * (l.price || 0), 0);
    const validUntil = (document.getElementById('f_valid') as HTMLInputElement).value;
    const notes = (document.getElementById('f_notes') as HTMLTextAreaElement).value;
    if (existing) { Object.assign(existing, { items, total, validUntil, notes }); }
    else { DB.quotations.push({ id: uid('qt'), number: nextQuoteNumber(), clientId, date: todayStr(), validUntil, items, total, status: 'Draft', notes }); }
    save(); closeModal(); toast(existing ? 'Quotation updated' : 'Quotation created'); goTo('quotations');
  };
}
function renderQLines() {
  const body = document.getElementById('qLineBody');
  if (!body) return;
  body.innerHTML = quoteLineItems.map((li, idx) => `<tr data-idx="${idx}">
    <td><select class="q-service"><option value="">Custom…</option>${DB.services.map((s: any) => `<option value="${s.id}" ${li.serviceId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>${!li.serviceId ? `<input class="q-name" placeholder="Item name" value="${escapeHtml(li.name || '')}" style="margin-top:4px;"/>` : ''}</td>
    <td><input type="number" class="q-qty" value="${li.qty || 1}" min="0" style="width:60px;"/></td>
    <td><input type="number" class="q-price" value="${li.price || 0}" min="0" style="width:90px;"/></td>
    <td class="num">${BDT((li.qty || 1) * (li.price || 0))}</td>
    <td><button class="icon-btn q-remove"><i class="fa-solid fa-xmark"></i></button></td>
  </tr>`).join('');
  body.querySelectorAll('tr').forEach((tr: any) => {
    const idx = Number(tr.dataset.idx);
    tr.querySelector('.q-service').addEventListener('change', (e: any) => { const svc = serviceById(e.target.value); quoteLineItems[idx].serviceId = e.target.value; if (svc) { quoteLineItems[idx].name = svc.name; quoteLineItems[idx].price = svc.price; } else { quoteLineItems[idx].name = ''; } renderQLines(); });
    const nameInp = tr.querySelector('.q-name'); if (nameInp) nameInp.addEventListener('input', (e: any) => { quoteLineItems[idx].name = e.target.value; updateQTotals(); });
    tr.querySelector('.q-qty').addEventListener('input', (e: any) => { quoteLineItems[idx].qty = Number(e.target.value || 0); renderQLines(); });
    tr.querySelector('.q-price').addEventListener('input', (e: any) => { quoteLineItems[idx].price = Number(e.target.value || 0); renderQLines(); });
    tr.querySelector('.q-remove').addEventListener('click', () => { quoteLineItems.splice(idx, 1); if (!quoteLineItems.length) quoteLineItems.push({ serviceId: '', name: '', qty: 1, price: 0 }); renderQLines(); });
  });
  updateQTotals();
}
function updateQTotals() {
  const total = quoteLineItems.reduce((s, l) => s + (l.qty || 1) * (l.price || 0), 0);
  const el = document.getElementById('qTotals');
  if (el) el.innerHTML = `<div class="grand"><span>Total</span><span class="num">${BDT(total)}</span></div>`;
}

/* ========================= CONTRACTS ========================= */
PAGES['contracts'] = function (root) {
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Contract Management</h2><div class="desc">Client contract start/end dates ও renewal tracking</div></div>
      <div class="section-actions"><button class="btn btn-gold" id="addCtBtn" ${!DB.clients.length ? 'disabled title="Add a client first"' : ''}><i class="fa-solid fa-plus"></i> Add Contract</button></div>
    </div>
    <div class="panel"><div class="panel-body table-wrap" id="ctWrap"></div></div>
  `;
  document.getElementById('addCtBtn')?.addEventListener('click', () => contractForm());
  renderContractsTable();
};
function renderContractsTable() {
  const wrap = document.getElementById('ctWrap');
  if (!wrap) return;
  if (!DB.contracts.length) { wrap.innerHTML = emptyState('fa-file-contract', 'কোনো contract যোগ করা হয়নি।'); return; }
  const today = todayStr();
  const rows = DB.contracts.map((ct: any) => {
    const daysLeft = daysBetween(today, ct.renewalDate);
    return `<tr>
      <td style="font-weight:600;">${escapeHtml(clientName(ct.clientId))}</td>
      <td>${fmtDate(ct.startDate)}</td><td>${fmtDate(ct.endDate)}</td>
      <td class="num">${BDT(ct.monthlyFee)}</td>
      <td>${fmtDate(ct.renewalDate)}</td>
      <td>${daysLeft < 0 ? `<span class="badge badge-overdue">Expired</span>` : daysLeft <= 30 ? `<span class="badge badge-partial">${daysLeft}d left</span>` : `<span class="badge badge-active">Active</span>`}</td>
      <td class="row-actions"><button class="icon-btn" data-edit="${ct.id}"><i class="fa-solid fa-pen"></i></button><button class="icon-btn" data-del="${ct.id}"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`;
  }).join('');
  const ctMonthly = DB.contracts.reduce((s: number, ct: any) => s + Number(ct.monthlyFee || 0), 0);
  const ctActive = DB.contracts.filter((ct: any) => daysBetween(today, ct.renewalDate) >= 0);
  wrap.innerHTML = `<table><thead><tr><th>Client</th><th>Start</th><th>End</th><th class="num">Monthly Fee</th><th>Renewal</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody>
    <tfoot class="total-foot">
      <tr class="subtotal"><td colspan="3">Active only (${ctActive.length})</td><td class="num" style="color:var(--teal);">${BDT(ctActive.reduce((s: number, ct: any) => s + Number(ct.monthlyFee || 0), 0))}</td><td colspan="3"></td></tr>
      <tr><td colspan="3">TOTAL MONTHLY (${DB.contracts.length} contracts)</td><td class="num">${BDT(ctMonthly)}</td><td colspan="3"></td></tr>
    </tfoot></table>`;
  wrap.querySelectorAll('[data-edit]').forEach((b: any) => b.addEventListener('click', () => contractForm(DB.contracts.find((c: any) => c.id === b.dataset.edit))));
  wrap.querySelectorAll('[data-del]').forEach((b: any) => b.addEventListener('click', () => {
    confirmAction('এই contract ডিলিট করবেন?', () => { DB.contracts = DB.contracts.filter((c: any) => c.id !== b.dataset.del); save(); toast('Deleted'); renderContractsTable(); });
  }));
}
function contractForm(existing?: any) {
  const ct = existing || { startDate: todayStr(), paymentTerms: 'Net 15' };
  openModal({
    title: existing ? 'Edit Contract' : 'Add Contract',
    bodyHtml: `<div class="form-grid">
      <div class="field full"><label>Client *</label><select id="f_client"><option value="">Select…</option>${DB.clients.map((c: any) => `<option value="${c.id}" ${ct.clientId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Start Date</label><input type="date" id="f_start" value="${ct.startDate}"/></div>
      <div class="field"><label>End Date</label><input type="date" id="f_end" value="${ct.endDate || ''}"/></div>
      <div class="field"><label>Monthly Fee (৳)</label><input type="number" id="f_fee" value="${ct.monthlyFee || 0}" min="0"/></div>
      <div class="field"><label>Renewal Date</label><input type="date" id="f_renew" value="${ct.renewalDate || ''}"/></div>
      <div class="field full"><label>Services / Terms</label><textarea id="f_terms">${escapeHtml(ct.services || '')}</textarea></div>
    </div>`,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-primary" id="cSave">${existing ? 'Save' : 'Add Contract'}</button>`
  });
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    const clientId = (document.getElementById('f_client') as HTMLSelectElement).value;
    if (!clientId) { toast('Select a client', true); return; }
    const data = { id: ct.id || uid('ct'), clientId, startDate: (document.getElementById('f_start') as HTMLInputElement).value, endDate: (document.getElementById('f_end') as HTMLInputElement).value, monthlyFee: Number((document.getElementById('f_fee') as HTMLInputElement).value || 0), renewalDate: (document.getElementById('f_renew') as HTMLInputElement).value, services: (document.getElementById('f_terms') as HTMLTextAreaElement).value };
    if (existing) Object.assign(existing, data); else DB.contracts.push(data);
    save(); closeModal(); toast('Contract saved'); goTo('contracts');
  };
}

/* ========================= EXPENSES (AUDIT FIX: Chart memory leak fixed via registerChart) ========================= */
const expenseRangeState = { preset: 'all', from: '', to: '', typeFilter: '', catFilter: '' };
const METHOD_TO_ACCOUNT: Record<string, string> = { 'Cash': 'acc_cash', 'Bank': 'acc_bank', 'bKash': 'acc_bkash', 'Nagad': 'acc_nagad', 'Card': 'acc_bank', 'PayPal': 'acc_paypal', 'Other': 'acc_bank' };

PAGES['expenses'] = function (root) {
  const { from, to } = genRangeBounds(expenseRangeState);
  const inRange = DB.expenses.filter((e: any) => (!from || e.date >= from) && (!to || e.date <= to));
  const filtList = inRange.filter((e: any) =>
    (!expenseRangeState.typeFilter || categoryType(e.category) === expenseRangeState.typeFilter) &&
    (!expenseRangeState.catFilter || e.category === expenseRangeState.catFilter)
  );
  const cosTotal = inRange.filter((e: any) => isCOS(e.category)).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const opexTotal = inRange.filter((e: any) => !isCOS(e.category)).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const salary = (DB.employeePayments || []).filter((p: any) => (!from || p.date >= from) && (!to || p.date <= to)).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const grand = cosTotal + opexTotal;
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Expenses</h2><div class="desc">Cost of Service আর Operating Expense আলাদা করে হিসাব হয়</div></div>
      <div class="section-actions">
        <button class="btn" id="manageCatBtn"><i class="fa-solid fa-tags"></i> Manage Categories</button>
        <button class="btn" id="exportExpBtn"><i class="fa-solid fa-download"></i> Export CSV</button>
        <button class="btn btn-gold" id="addExpBtn"><i class="fa-solid fa-plus"></i> Add Expense</button>
      </div>
    </div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);">
      <div class="kpi accent-gold"><i class="fa-solid fa-screwdriver-wrench kpi-icon"></i><div class="kpi-label">Cost of Service</div><div class="kpi-value num">${BDT(cosTotal)}</div><div class="kpi-sub">ক্লায়েন্টের কাজ ডেলিভার করতে সরাসরি খরচ</div></div>
      <div class="kpi accent-red"><i class="fa-solid fa-building kpi-icon"></i><div class="kpi-label">Operating Expenses</div><div class="kpi-value num">${BDT(opexTotal)}</div><div class="kpi-sub">এজেন্সি চালানোর খরচ</div></div>
      <div class="kpi"><i class="fa-solid fa-user-tie kpi-icon"></i><div class="kpi-label">Salary Paid</div><div class="kpi-value num">${BDT(salary)}</div><div class="kpi-sub">Team &amp; Freelancers page থেকে</div></div>
      <div class="kpi accent-teal"><i class="fa-solid fa-sigma kpi-icon"></i><div class="kpi-label">Total Cost</div><div class="kpi-value num">${BDT(grand + salary)}</div><div class="kpi-sub">Expense ${BDT(grand)} + Salary ${BDT(salary)}</div></div>
    </div>
    <div class="filter-bar">
      ${genRangeBarHtml(expenseRangeState, 'exp')}
      <select id="expType">
        <option value="">Both Types</option>
        <option value="cos" ${expenseRangeState.typeFilter === 'cos' ? 'selected' : ''}>Cost of Service only</option>
        <option value="opex" ${expenseRangeState.typeFilter === 'opex' ? 'selected' : ''}>Operating Expenses only</option>
      </select>
      <select id="expCat">
        <option value="">All Categories</option>
        ${categoryNames().map((n: string) => `<option value="${escapeHtml(n)}" ${expenseRangeState.catFilter === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
      </select>
    </div>
    <div class="chart-grid2">
      <div class="panel"><div class="panel-head"><h3>Cost of Service vs Operating</h3></div><div class="panel-body"><canvas id="chExpSplit" height="150"></canvas></div></div>
      <div class="panel"><div class="panel-head"><h3>Monthly Expense Trend</h3></div><div class="panel-body"><canvas id="chExpTrend" height="150"></canvas></div></div>
    </div>
    <div class="panel"><div class="panel-head"><h3>Category Summary</h3></div><div class="panel-body table-wrap" id="expSummaryWrap"></div></div>
    <div class="panel"><div class="panel-head"><h3>All Expense Entries</h3></div><div class="panel-body table-wrap" id="expTableWrap"></div></div>
  `;
  document.getElementById('addExpBtn')?.addEventListener('click', () => expenseForm());
  document.getElementById('manageCatBtn')?.addEventListener('click', () => manageCategoriesForm());
  document.getElementById('expType')?.addEventListener('change', (ev: any) => { expenseRangeState.typeFilter = ev.target.value; goTo('expenses'); });
  document.getElementById('expCat')?.addEventListener('change', (ev: any) => { expenseRangeState.catFilter = ev.target.value; goTo('expenses'); });
  document.getElementById('exportExpBtn')?.addEventListener('click', () => {
    const rows: any[][] = [['Date', 'Type', 'Category', 'Amount', 'Vendor', 'Method', 'Account', 'Client', 'Description']];
    [...filtList].sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach((e: any) => rows.push([
      e.date, typeLabel(categoryType(e.category)), e.category, e.amount, e.vendor || '', e.method || '',
      (accountById(e.accountId) || {}).name || '', e.clientId ? clientName(e.clientId) : '', e.description || ''
    ]));
    downloadCSV(rows, 'expenses.csv');
  });
  genRangeWire(expenseRangeState, 'exp', () => goTo('expenses'));
  renderExpenseSummary(filtList);
  renderExpensesTable();

  /* AUDIT FIX: Register Expense charts so they are destroyed on page switch! */
  registerChart('expSplit', new Chart(document.getElementById('chExpSplit'), {
    type: 'doughnut',
    data: { labels: ['Cost of Service', 'Operating Expenses'], datasets: [{ data: [cosTotal, opexTotal], backgroundColor: ['#B4863A', '#A6392F'] }] },
    options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } } }
  }));
  const months = last6Months();
  const cosTrend = months.map(m => DB.expenses.filter((e: any) => monthKey(e.date) === m.key && isCOS(e.category)).reduce((s: number, e: any) => s + Number(e.amount || 0), 0));
  const opexTrend = months.map(m => DB.expenses.filter((e: any) => monthKey(e.date) === m.key && !isCOS(e.category)).reduce((s: number, e: any) => s + Number(e.amount || 0), 0));
  registerChart('expTrend', new Chart(document.getElementById('chExpTrend'), {
    type: 'bar',
    data: {
      labels: months.map(m => m.label), datasets: [
        { label: 'Cost of Service', data: cosTrend, backgroundColor: '#B4863A' },
        { label: 'Operating', data: opexTrend, backgroundColor: '#A6392F' }
      ]
    },
    options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } } }
  }));
};

function renderExpenseSummary(list: any[]) {
  const wrap = document.getElementById('expSummaryWrap');
  if (!wrap) return;
  if (!list.length) { wrap.innerHTML = emptyState('fa-tags', 'এই ফিল্টারে কোনো খরচ নেই।'); return; }
  const total = list.reduce((s, e) => s + Number(e.amount || 0), 0);
  const byCat: Record<string, number> = {};
  list.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount || 0); });
  let body = '', cosSum = 0, opexSum = 0;
  ['cos', 'opex'].forEach(t => {
    const entries = Object.entries(byCat).filter(([c]) => categoryType(c) === t).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return;
    const sub = entries.reduce((s, [, amt]) => s + amt, 0);
    if (t === 'cos') cosSum = sub; else opexSum = sub;
    body += `<tr class="group-head"><td colspan="4">${typeLabel(t)}</td></tr>`;
    body += entries.map(([c, amt]) => `<tr>
      <td>${escapeHtml(c)}</td>
      <td class="num">${BDT(amt)}</td>
      <td class="num">${total ? (amt / total * 100).toFixed(1) : 0}%</td>
      <td class="num">${sub ? (amt / sub * 100).toFixed(1) : 0}%</td>
    </tr>`).join('');
    body += `<tr class="group-sub"><td>${typeLabel(t)} Subtotal</td><td class="num">${BDT(sub)}</td><td class="num">${total ? (sub / total * 100).toFixed(1) : 0}%</td><td class="num">100%</td></tr>`;
  });
  wrap.innerHTML = `<table>
    <thead><tr><th>Category</th><th class="num">Amount</th><th class="num">% of Total</th><th class="num">% of Its Group</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot class="total-foot">
      <tr class="subtotal"><td>Cost of Service</td><td class="num">${BDT(cosSum)}</td><td class="num">${total ? (cosSum / total * 100).toFixed(1) : 0}%</td><td></td></tr>
      <tr class="subtotal"><td>Operating Expenses</td><td class="num">${BDT(opexSum)}</td><td class="num">${total ? (opexSum / total * 100).toFixed(1) : 0}%</td><td></td></tr>
      <tr><td>GRAND TOTAL</td><td class="num" style="color:var(--red);">${BDT(total)}</td><td class="num">100%</td><td></td></tr>
    </tfoot>
  </table>`;
}

function renderExpensesTable() {
  const wrap = document.getElementById('expTableWrap');
  if (!wrap) return;
  const { from, to } = genRangeBounds(expenseRangeState);
  const list = DB.expenses
    .filter((e: any) => (!from || e.date >= from) && (!to || e.date <= to))
    .filter((e: any) => (!expenseRangeState.typeFilter || categoryType(e.category) === expenseRangeState.typeFilter))
    .filter((e: any) => (!expenseRangeState.catFilter || e.category === expenseRangeState.catFilter))
    .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
  if (!list.length) { wrap.innerHTML = emptyState('fa-receipt', 'এই সময়সীমায় কোনো খরচ নেই।'); return; }
  const cos = list.filter((e: any) => isCOS(e.category)).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const opex = list.filter((e: any) => !isCOS(e.category)).reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const rows = list.map((e: any) => `<tr>
    <td>${fmtDate(e.date)}</td>
    <td>${typeBadge(categoryType(e.category))}</td>
    <td><span class="pill">${escapeHtml(e.category)}</span></td>
    <td class="num" style="color:var(--red)">${BDT(e.amount)}</td>
    <td>${escapeHtml(e.vendor || '—')}</td><td>${escapeHtml(e.method || '—')}</td><td>${escapeHtml(e.clientId ? clientName(e.clientId) : '—')}</td>
    <td class="row-actions"><button class="icon-btn" data-edit="${e.id}"><i class="fa-solid fa-pen"></i></button><button class="icon-btn" data-del="${e.id}"><i class="fa-solid fa-trash"></i></button></td>
  </tr>`).join('');
  wrap.innerHTML = `<table>
    <thead><tr><th>Date</th><th>Type</th><th>Category</th><th class="num">Amount</th><th>Vendor</th><th>Method</th><th>Client (optional)</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot class="total-foot">
      <tr class="subtotal"><td colspan="3">Cost of Service</td><td class="num">${BDT(cos)}</td><td colspan="4"></td></tr>
      <tr class="subtotal"><td colspan="3">Operating Expenses</td><td class="num">${BDT(opex)}</td><td colspan="4"></td></tr>
      <tr><td colspan="3">TOTAL (${list.length} entries)</td><td class="num" style="color:var(--red);">${BDT(cos + opex)}</td><td colspan="4"></td></tr>
    </tfoot>
  </table>`;
  wrap.querySelectorAll('[data-edit]').forEach((b: any) => b.addEventListener('click', () => expenseForm(DB.expenses.find((e: any) => e.id === b.dataset.edit))));
  wrap.querySelectorAll('[data-del]').forEach((b: any) => b.addEventListener('click', () => {
    confirmAction('এই expense এন্ট্রিটি ডিলিট করবেন?', () => { DB.expenses = DB.expenses.filter((e: any) => e.id !== b.dataset.del); save(); toast('Expense deleted'); goTo('expenses'); });
  }));
}

function manageCategoriesForm() {
  openModal({
    title: 'Manage Expense Categories',
    bodyHtml: `
      <div style="padding:11px 13px;background:var(--amber-bg);border-left:3px solid var(--gold);font-size:12.5px;line-height:1.65;margin-bottom:14px;">
        <b>Cost of Service</b> — যেটা শুধু client-এর কাজ ডেলিভার করার জন্যই খরচ হয়।<br>
        <b>Operating Expense</b> — client না থাকলেও যেটা লাগবেই।
      </div>
      <div class="form-grid" style="grid-template-columns:2fr 1.2fr auto;align-items:end;gap:10px;">
        <div class="field"><label>New Category Name</label><input id="newCatName" placeholder="e.g. Thumbnail Designer"/></div>
        <div class="field"><label>Type</label><select id="newCatType"><option value="cos">Cost of Service</option><option value="opex" selected>Operating Expense</option></select></div>
        <div class="field"><button class="btn btn-gold" id="addCatBtn" style="width:100%;"><i class="fa-solid fa-plus"></i> Add</button></div>
      </div>
      <div class="table-wrap" style="max-height:340px;overflow-y:auto;margin-top:14px;" id="catListWrap"></div>`,
    footHtml: `<button class="btn btn-primary" id="cClose">Done</button>`
  });
  document.getElementById('cClose')!.onclick = () => { closeModal(); goTo('expenses'); };
  document.getElementById('addCatBtn')!.onclick = () => {
    const name = (document.getElementById('newCatName') as HTMLInputElement).value.trim();
    const type = (document.getElementById('newCatType') as HTMLSelectElement).value;
    if (!name) { toast('Category name লিখুন', true); return; }
    if (categoryNames().some((n: string) => n.toLowerCase() === name.toLowerCase())) { toast('এই নামে category আগেই আছে', true); return; }
    DB.expenseCategories.push({ name, type });
    save(); (document.getElementById('newCatName') as HTMLInputElement).value = ''; toast('Category added'); renderCatList();
  };
  renderCatList();
}
function renderCatList() {
  const wrap = document.getElementById('catListWrap');
  if (!wrap) return;
  const usage: Record<string, number> = {};
  DB.expenses.forEach((e: any) => { usage[e.category] = (usage[e.category] || 0) + 1; });
  let body = '';
  ['cos', 'opex'].forEach(t => {
    const cats = expenseCategories().filter((c: any) => c.type === t);
    body += `<tr class="group-head"><td colspan="4">${typeLabel(t)} (${cats.length})</td></tr>`;
    body += cats.map((c: any) => {
      const i = expenseCategories().indexOf(c);
      return `<tr>
        <td>${escapeHtml(c.name)}</td>
        <td><select data-type="${i}" style="padding:4px 7px;font-size:12.5px;">
          <option value="cos" ${c.type === 'cos' ? 'selected' : ''}>Cost of Service</option>
          <option value="opex" ${c.type === 'opex' ? 'selected' : ''}>Operating Expense</option>
        </select></td>
        <td class="num">${usage[c.name] || 0}</td>
        <td class="row-actions">
          <button class="icon-btn" data-delcat="${i}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </td></tr>`;
    }).join('');
  });
  wrap.innerHTML = `<table><thead><tr><th>Category</th><th>Type</th><th class="num">Used In</th><th></th></tr></thead><tbody>${body}</tbody></table>`;
  wrap.querySelectorAll('[data-type]').forEach((sel: any) => sel.addEventListener('change', (ev: any) => {
    DB.expenseCategories[Number(sel.dataset.type)].type = ev.target.value;
    save(); toast('Type updated'); renderCatList();
  }));
  wrap.querySelectorAll('[data-delcat]').forEach((b: any) => b.addEventListener('click', () => {
    const idx = Number(b.dataset.delcat);
    const cat = DB.expenseCategories[idx];
    const used = DB.expenses.filter((e: any) => e.category === cat.name).length;
    if (used) { toast(`"${cat.name}" ${used}টি expense-এ ব্যবহৃত — ডিলিট করা যাবে না`, true); return; }
    DB.expenseCategories.splice(idx, 1); save(); toast('Category deleted'); renderCatList();
  }));
}

function expenseForm(existing?: any) {
  const e = existing || { date: todayStr(), category: (categoryNames()[0] || 'Miscellaneous'), method: 'Bank' };
  const defaultAccountId = e.accountId || METHOD_TO_ACCOUNT[e.method] || 'acc_bank';
  openModal({
    title: existing ? 'Edit Expense' : 'Add Expense',
    bodyHtml: `<div class="form-grid">
      <div class="field"><label>Date</label><input type="date" id="f_date" value="${e.date}"/></div>
      <div class="field"><label>Category</label><select id="f_cat">
        <optgroup label="── Cost of Service ──">${expenseCategories().filter((c: any) => c.type === 'cos').map((c: any) => `<option ${e.category === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</optgroup>
        <optgroup label="── Operating Expense ──">${expenseCategories().filter((c: any) => c.type === 'opex').map((c: any) => `<option ${e.category === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</optgroup>
      </select></div>
      <div class="field"><label>Amount (৳) *</label><input type="number" id="f_amount" value="${e.amount || ''}" min="0" step="0.01"/></div>
      <div class="field"><label>Vendor</label><input id="f_vendor" value="${escapeHtml(e.vendor || '')}"/></div>
      <div class="field"><label>Payment Method</label><select id="f_method">${['Cash', 'Bank', 'bKash', 'Nagad', 'Card', 'Other'].map(m => `<option ${e.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div class="field"><label>Paid From Account *</label><select id="f_account">${DB.accounts.map((a: any) => `<option value="${a.id}" ${defaultAccountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)} (${BDT(accountBalance(a.id))})</option>`).join('')}</select></div>
      <div class="field"><label>Allocate to Client (optional)</label><select id="f_client"><option value="">—</option>${DB.clients.map((c: any) => `<option value="${c.id}" ${e.clientId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Input VAT Eligible?</label><select id="f_vatel"><option value="no" ${!e.vatEligible ? 'selected' : ''}>No</option><option value="yes" ${e.vatEligible ? 'selected' : ''}>Yes — VAT-registered purchase</option></select></div>
      <div class="field"><label>Input VAT Amount (৳)</label><input type="number" id="f_vatamt" value="${e.vatAmount || 0}" min="0" step="0.01"/></div>
      <div class="field full"><label>Description</label><textarea id="f_desc">${escapeHtml(e.description || '')}</textarea></div>
    </div>`,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-primary" id="cSave">${existing ? 'Save' : 'Add Expense'}</button>`
  });
  document.getElementById('f_method')?.addEventListener('change', (ev: any) => {
    const mapped = METHOD_TO_ACCOUNT[ev.target.value];
    if (mapped) (document.getElementById('f_account') as HTMLSelectElement).value = mapped;
  });
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    const amount = Number((document.getElementById('f_amount') as HTMLInputElement).value || 0);
    if (!amount || amount <= 0) { toast('Enter a valid amount', true); return; }
    const method = (document.getElementById('f_method') as HTMLSelectElement).value;
    const accountId = (document.getElementById('f_account') as HTMLSelectElement).value || METHOD_TO_ACCOUNT[method] || 'acc_bank';
    const data = {
      id: e.id || uid('exp'), date: (document.getElementById('f_date') as HTMLInputElement).value,
      category: (document.getElementById('f_cat') as HTMLSelectElement).value, amount,
      vendor: (document.getElementById('f_vendor') as HTMLInputElement).value, method, accountId,
      clientId: (document.getElementById('f_client') as HTMLSelectElement).value,
      description: (document.getElementById('f_desc') as HTMLTextAreaElement).value,
      vatEligible: (document.getElementById('f_vatel') as HTMLSelectElement).value === 'yes',
      vatAmount: Number((document.getElementById('f_vatamt') as HTMLInputElement).value || 0)
    };
    if (existing) Object.assign(existing, data); else DB.expenses.push(data);
    save(); closeModal(); toast('Expense saved'); goTo('expenses');
  };
}

/* ========================= CLIENT ADS FUND, EMPLOYEES, ACCOUNTS, LEDGER ========================= */
const ADS_PLATFORMS = ['Meta', 'Google', 'TikTok', 'LinkedIn', 'Other'];
const adsRangeState = { preset: 'all', from: '', to: '', clientId: '', platform: '', groupBy: 'all', search: '' };

PAGES['ads-fund'] = function (root) {
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Client Ads Fund — Spend Log</h2><div class="desc">Client-এর জন্য কত ad spend হয়েছে — Client, Month, Platform ও Date অনুযায়ী আলাদা করে দেখুন (এজেন্সির লাভ-ক্ষতি থেকে সম্পূর্ণ আলাদা)</div></div>
      <div class="section-actions">
        <button class="btn" id="printAdsBtn"><i class="fa-solid fa-file-pdf"></i> Print / PDF</button>
        <button class="btn" id="expAdsBtn"><i class="fa-solid fa-download"></i> Export CSV</button>
        <button class="btn btn-gold" id="addAdsBtn" ${!DB.clients.length ? 'disabled' : ''}><i class="fa-solid fa-plus"></i> Add Spend</button>
      </div>
    </div>
    <div class="filter-bar">
      <select id="adsClient"><option value="">All Clients</option>${DB.clients.map((c: any) => `<option value="${c.id}" ${adsRangeState.clientId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
      <select id="adsPlatform"><option value="">All Platforms</option>${ADS_PLATFORMS.map(p => `<option value="${p}" ${adsRangeState.platform === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      ${genRangeBarHtml(adsRangeState, 'ads')}
      <input type="text" id="adsSearch" placeholder="Search notes / client…" value="${escapeHtml(adsRangeState.search)}"/>
    </div>
    <div class="tabs" id="adsGroupTabs">
      <div class="tab ${adsRangeState.groupBy === 'all' ? 'active' : ''}" data-grp="all"><i class="fa-solid fa-table-list"></i> All Views (Complete)</div>
      <div class="tab ${adsRangeState.groupBy === 'client' ? 'active' : ''}" data-grp="client"><i class="fa-solid fa-users"></i> Client-wise</div>
      <div class="tab ${adsRangeState.groupBy === 'month' ? 'active' : ''}" data-grp="month"><i class="fa-solid fa-calendar-days"></i> Month-wise</div>
      <div class="tab ${adsRangeState.groupBy === 'platform' ? 'active' : ''}" data-grp="platform"><i class="fa-solid fa-bullhorn"></i> Platform-wise</div>
      <div class="tab ${adsRangeState.groupBy === 'date' ? 'active' : ''}" data-grp="date"><i class="fa-solid fa-clock"></i> Date-wise</div>
      <div class="tab ${adsRangeState.groupBy === 'entries' ? 'active' : ''}" data-grp="entries"><i class="fa-solid fa-list"></i> Individual Entries</div>
    </div>
    <div id="adsReportContent">
      <div class="kpi-grid" id="adsKpis"></div>
      <div id="adsSummariesWrap"></div>
      <div class="panel" id="adsEntriesPanel"><div class="panel-head"><h3>All Ad Spend Entries</h3><span class="muted" id="adsEntryCountLabel" style="font-size:12px;"></span></div><div class="panel-body table-wrap" id="adsTableWrap"></div></div>
    </div>
  `;
  document.getElementById('addAdsBtn')?.addEventListener('click', () => adsFundForm());
  document.getElementById('adsClient')?.addEventListener('change', (e: any) => { adsRangeState.clientId = e.target.value; renderAdsFundBody(); });
  document.getElementById('adsPlatform')?.addEventListener('change', (e: any) => { adsRangeState.platform = e.target.value; renderAdsFundBody(); });
  document.getElementById('adsSearch')?.addEventListener('input', (e: any) => { adsRangeState.search = e.target.value; renderAdsFundBody(); });
  document.querySelectorAll('#adsGroupTabs .tab').forEach((t: any) => t.addEventListener('click', () => {
    adsRangeState.groupBy = t.dataset.grp;
    document.querySelectorAll('#adsGroupTabs .tab').forEach(el => el.classList.remove('active'));
    t.classList.add('active');
    renderAdsFundBody();
  }));
  genRangeWire(adsRangeState, 'ads', () => goTo('ads-fund'), renderAdsFundBody);
  document.getElementById('expAdsBtn')?.addEventListener('click', () => {
    const { from, to } = genRangeBounds(adsRangeState);
    const q = adsRangeState.search.trim().toLowerCase();
    const rows: any[][] = [['Date', 'Month', 'Client', 'Platform', 'Amount', 'Notes']];
    DB.adsFunds.filter((a: any) =>
      (!from || a.date >= from) &&
      (!to || a.date <= to) &&
      (!adsRangeState.clientId || a.clientId === adsRangeState.clientId) &&
      (!adsRangeState.platform || a.platform === adsRangeState.platform) &&
      (!q || (a.notes || '').toLowerCase().includes(q) || clientName(a.clientId).toLowerCase().includes(q))
    ).forEach((a: any) => rows.push([a.date, monthKey(a.date), clientName(a.clientId), a.platform || '', a.amount, a.notes || '']));
    downloadCSV(rows, 'ads-spend.csv');
  });
  document.getElementById('printAdsBtn')?.addEventListener('click', () => {
    const { from, to } = genRangeBounds(adsRangeState);
    const rangeLabel = !from && !to ? 'All Time' : `${from ? fmtDate(from) : '…'} — ${to ? fmtDate(to) : '…'}`;
    const content = document.getElementById('adsReportContent')?.innerHTML || '';
    printGenericReportDoc('Client Ads Fund — Spend Log', rangeLabel, content);
  });
  renderAdsFundBody();
};

function renderAdsFundBody() {
  const kpiWrap = document.getElementById('adsKpis');
  const sumWrap = document.getElementById('adsSummariesWrap');
  const entriesPanel = document.getElementById('adsEntriesPanel');
  const tableWrap = document.getElementById('adsTableWrap');
  const countLabel = document.getElementById('adsEntryCountLabel');
  if (!kpiWrap || !sumWrap || !tableWrap || !entriesPanel) return;

  const { from, to } = genRangeBounds(adsRangeState);
  const q = adsRangeState.search.trim().toLowerCase();
  const filtered = DB.adsFunds.filter((a: any) =>
    (!from || a.date >= from) &&
    (!to || a.date <= to) &&
    (!adsRangeState.clientId || a.clientId === adsRangeState.clientId) &&
    (!adsRangeState.platform || a.platform === adsRangeState.platform) &&
    (!q || (a.notes || '').toLowerCase().includes(q) || clientName(a.clientId).toLowerCase().includes(q))
  ).sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));

  const totalSpend = filtered.reduce((s: number, a: any) => s + Number(a.amount || 0), 0);
  const uniqueClients = new Set(filtered.map((a: any) => a.clientId)).size;
  const uniqueMonths = new Set(filtered.map((a: any) => monthKey(a.date))).size;

  // Platform totals
  const byPlat: Record<string, { spend: number; count: number }> = {};
  filtered.forEach((a: any) => {
    const p = a.platform || 'Other';
    if (!byPlat[p]) byPlat[p] = { spend: 0, count: 0 };
    byPlat[p].spend += Number(a.amount || 0);
    byPlat[p].count += 1;
  });
  const topPlat = Object.entries(byPlat).sort((a, b) => b[1].spend - a[1].spend)[0];

  // Client totals
  const byClient: Record<string, { spend: number; count: number; platforms: Set<string>; lastDate: string }> = {};
  filtered.forEach((a: any) => {
    const cid = a.clientId || 'unknown';
    if (!byClient[cid]) byClient[cid] = { spend: 0, count: 0, platforms: new Set(), lastDate: '' };
    byClient[cid].spend += Number(a.amount || 0);
    byClient[cid].count += 1;
    if (a.platform) byClient[cid].platforms.add(a.platform);
    if (!byClient[cid].lastDate || a.date > byClient[cid].lastDate) byClient[cid].lastDate = a.date;
  });

  // Month totals
  const byMonth: Record<string, { spend: number; count: number; clients: Set<string> }> = {};
  filtered.forEach((a: any) => {
    const mk = monthKey(a.date) || 'Unknown';
    if (!byMonth[mk]) byMonth[mk] = { spend: 0, count: 0, clients: new Set() };
    byMonth[mk].spend += Number(a.amount || 0);
    byMonth[mk].count += 1;
    if (a.clientId) byMonth[mk].clients.add(a.clientId);
  });

  // Date totals
  const byDate: Record<string, { spend: number; count: number; clients: Set<string>; platforms: Set<string> }> = {};
  filtered.forEach((a: any) => {
    const d = a.date || 'Unknown';
    if (!byDate[d]) byDate[d] = { spend: 0, count: 0, clients: new Set(), platforms: new Set() };
    byDate[d].spend += Number(a.amount || 0);
    byDate[d].count += 1;
    if (a.clientId) byDate[d].clients.add(a.clientId);
    if (a.platform) byDate[d].platforms.add(a.platform);
  });

  kpiWrap.innerHTML = `
    <div class="kpi accent-gold"><div class="kpi-label">Total Ad Spend</div><div class="kpi-value num">${BDT(totalSpend)}</div><div class="kpi-sub">${filtered.length} spend entries</div><i class="fa-solid fa-bullhorn kpi-icon"></i></div>
    <div class="kpi accent-teal"><div class="kpi-label">Active Ad Clients</div><div class="kpi-value num">${uniqueClients}</div><div class="kpi-sub">Across ${uniqueMonths || 0} month(s)</div><i class="fa-solid fa-users kpi-icon"></i></div>
    <div class="kpi"><div class="kpi-label">Top Platform</div><div class="kpi-value num" style="font-size:19px;">${topPlat ? `${escapeHtml(topPlat[0])} (${BDT(topPlat[1].spend)})` : '—'}</div><div class="kpi-sub">${topPlat && totalSpend ? Math.round(topPlat[1].spend / totalSpend * 100) + '% of total spend' : 'No spend'}</div><i class="fa-solid fa-chart-pie kpi-icon"></i></div>
    <div class="kpi"><div class="kpi-label">Avg Spend / Client</div><div class="kpi-value num">${BDT(uniqueClients ? totalSpend / uniqueClients : 0)}</div><div class="kpi-sub">Avg per entry: ${BDT(filtered.length ? totalSpend / filtered.length : 0)}</div><i class="fa-solid fa-calculator kpi-icon"></i></div>
  `;

  const clientRows = Object.entries(byClient).sort((a, b) => b[1].spend - a[1].spend).map(([cid, v]) => `
    <tr>
      <td style="font-weight:600;cursor:pointer;" data-filter-client="${cid}">${escapeHtml(clientName(cid))}</td>
      <td>${Array.from(v.platforms).map(p => `<span class="pill" style="margin-right:4px;">${escapeHtml(p)}</span>`).join('') || '—'}</td>
      <td class="num">${v.count}</td>
      <td>${fmtDate(v.lastDate)}</td>
      <td class="num" style="font-weight:600;">${BDT(v.spend)}</td>
      <td class="num">${totalSpend ? (v.spend / totalSpend * 100).toFixed(1) : 0}%</td>
      <td class="row-actions"><button class="btn btn-sm btn-gold" data-quick-add="${cid}">+ Spend</button></td>
    </tr>
  `).join('');

  const monthLabel = (mk: string) => mk && mk.includes('-') ? new Date(mk + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : mk;
  const monthRows = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])).map(([mk, v]) => `
    <tr>
      <td style="font-weight:600;">${escapeHtml(monthLabel(mk))}</td>
      <td class="num">${v.clients.size}</td>
      <td class="num">${v.count}</td>
      <td class="num" style="font-weight:600;">${BDT(v.spend)}</td>
      <td class="num">${totalSpend ? (v.spend / totalSpend * 100).toFixed(1) : 0}%</td>
    </tr>
  `).join('');

  const platRows = Object.entries(byPlat).sort((a, b) => b[1].spend - a[1].spend).map(([p, v]) => `
    <tr>
      <td><span class="pill" style="font-weight:600;cursor:pointer;" data-filter-plat="${escapeHtml(p)}">${escapeHtml(p)}</span></td>
      <td class="num">${v.count}</td>
      <td class="num" style="font-weight:600;">${BDT(v.spend)}</td>
      <td class="num">${totalSpend ? (v.spend / totalSpend * 100).toFixed(1) : 0}%</td>
    </tr>
  `).join('');

  const dateRows = Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0])).map(([d, v]) => `
    <tr>
      <td style="font-weight:600;">${fmtDate(d)}</td>
      <td class="num">${v.clients.size} client(s)</td>
      <td>${Array.from(v.platforms).map(p => `<span class="pill" style="margin-right:4px;">${escapeHtml(p)}</span>`).join('')}</td>
      <td class="num">${v.count}</td>
      <td class="num" style="font-weight:600;">${BDT(v.spend)}</td>
    </tr>
  `).join('');

  const clientPanelHtml = `
    <div class="panel">
      <div class="panel-head"><h3>Client-wise Ad Spend Summary</h3><span class="muted" style="font-size:12px;">ক্লায়েন্টের নামের ওপর ক্লিক করলে শুধু তার হিসাব ফিল্টার হবে</span></div>
      <div class="panel-body table-wrap">
        ${clientRows ? `<table><thead><tr><th>Client</th><th>Platforms Used</th><th class="num">Entries</th><th>Last Spend Date</th><th class="num">Total Spend</th><th class="num">% Share</th><th></th></tr></thead><tbody>${clientRows}</tbody>
        <tfoot class="total-foot"><tr><td colspan="2">TOTAL (${uniqueClients} clients)</td><td class="num">${filtered.length}</td><td></td><td class="num">${BDT(totalSpend)}</td><td class="num">100%</td><td></td></tr></tfoot></table>` : emptyState('fa-users', 'কোনো ক্লায়েন্টের Ad Spend নেই।')}
      </div>
    </div>`;

  const monthPanelHtml = `
    <div class="panel">
      <div class="panel-head"><h3>Month-wise Ad Spend Breakdown</h3></div>
      <div class="panel-body table-wrap">
        ${monthRows ? `<table><thead><tr><th>Month</th><th class="num">Clients</th><th class="num">Entries</th><th class="num">Total Spend</th><th class="num">% Share</th></tr></thead><tbody>${monthRows}</tbody>
        <tfoot class="total-foot"><tr><td>TOTAL (${uniqueMonths} months)</td><td class="num">${uniqueClients}</td><td class="num">${filtered.length}</td><td class="num">${BDT(totalSpend)}</td><td class="num">100%</td></tr></tfoot></table>` : emptyState('fa-calendar', 'কোনো ডেটা নেই।')}
      </div>
    </div>`;

  const platPanelHtml = `
    <div class="panel">
      <div class="panel-head"><h3>Platform-wise Ad Spend Breakdown</h3></div>
      <div class="panel-body table-wrap">
        ${platRows ? `<table><thead><tr><th>Platform</th><th class="num">Entries</th><th class="num">Total Spend</th><th class="num">% Share</th></tr></thead><tbody>${platRows}</tbody>
        <tfoot class="total-foot"><tr><td>TOTAL</td><td class="num">${filtered.length}</td><td class="num">${BDT(totalSpend)}</td><td class="num">100%</td></tr></tfoot></table>` : emptyState('fa-bullhorn', 'কোনো ডেটা নেই।')}
      </div>
    </div>`;

  const datePanelHtml = `
    <div class="panel">
      <div class="panel-head"><h3>Date-wise Daily Spend Log</h3></div>
      <div class="panel-body table-wrap">
        ${dateRows ? `<table><thead><tr><th>Date</th><th class="num">Clients</th><th>Platforms</th><th class="num">Entries</th><th class="num">Daily Spend</th></tr></thead><tbody>${dateRows}</tbody>
        <tfoot class="total-foot"><tr><td colspan="3">TOTAL (${Object.keys(byDate).length} days)</td><td class="num">${filtered.length}</td><td class="num">${BDT(totalSpend)}</td></tr></tfoot></table>` : emptyState('fa-clock', 'কোনো ডেটা নেই।')}
      </div>
    </div>`;

  const grp = adsRangeState.groupBy;
  if (grp === 'all') {
    sumWrap.innerHTML = `${clientPanelHtml}<div class="grid-2">${monthPanelHtml}${platPanelHtml}</div>`;
    entriesPanel.style.display = '';
  } else if (grp === 'client') {
    sumWrap.innerHTML = clientPanelHtml;
    entriesPanel.style.display = '';
  } else if (grp === 'month') {
    sumWrap.innerHTML = monthPanelHtml;
    entriesPanel.style.display = 'none';
  } else if (grp === 'platform') {
    sumWrap.innerHTML = platPanelHtml;
    entriesPanel.style.display = '';
  } else if (grp === 'date') {
    sumWrap.innerHTML = datePanelHtml;
    entriesPanel.style.display = 'none';
  } else {
    sumWrap.innerHTML = '';
    entriesPanel.style.display = '';
  }

  sumWrap.querySelectorAll('[data-filter-client]').forEach((el: any) => el.addEventListener('click', () => {
    adsRangeState.clientId = adsRangeState.clientId === el.dataset.filterClient ? '' : el.dataset.filterClient;
    const sel = document.getElementById('adsClient') as HTMLSelectElement;
    if (sel) sel.value = adsRangeState.clientId;
    renderAdsFundBody();
  }));
  sumWrap.querySelectorAll('[data-filter-plat]').forEach((el: any) => el.addEventListener('click', () => {
    adsRangeState.platform = adsRangeState.platform === el.dataset.filterPlat ? '' : el.dataset.filterPlat;
    const sel = document.getElementById('adsPlatform') as HTMLSelectElement;
    if (sel) sel.value = adsRangeState.platform;
    renderAdsFundBody();
  }));
  sumWrap.querySelectorAll('[data-quick-add]').forEach((b: any) => b.addEventListener('click', () => adsFundForm(b.dataset.quickAdd)));

  if (countLabel) countLabel.textContent = `${filtered.length} entries shown`;
  if (!filtered.length) {
    tableWrap.innerHTML = emptyState('fa-bullhorn', 'কোনো Ad Spend এন্ট্রি নেই। উপরে "+ Add Spend" বাটনে ক্লিক করে যোগ করুন।');
    return;
  }
  tableWrap.innerHTML = `<table><thead><tr><th>Date</th><th>Month</th><th>Client</th><th>Platform</th><th class="num">Amount</th><th>Notes</th><th></th></tr></thead><tbody>
    ${filtered.map((a: any) => `<tr><td>${fmtDate(a.date)}</td><td><span class="muted" style="font-size:12px;">${escapeHtml(monthKey(a.date))}</span></td><td style="font-weight:600;cursor:pointer;" data-view-client="${a.clientId}">${escapeHtml(clientName(a.clientId))}</td><td><span class="pill">${escapeHtml(a.platform || '—')}</span></td><td class="num" style="font-weight:600;">${BDT(a.amount)}</td><td>${escapeHtml(a.notes || '')}</td>
    <td class="row-actions"><button class="icon-btn" data-edit="${a.id}" title="Edit"><i class="fa-solid fa-pen"></i></button><button class="icon-btn" data-del="${a.id}" title="Delete"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('')}
    </tbody><tfoot class="total-foot"><tr><td colspan="4">TOTAL AD SPEND (${filtered.length} entries)</td><td class="num">${BDT(totalSpend)}</td><td colspan="2"></td></tr></tfoot></table>`;
  tableWrap.querySelectorAll('[data-view-client]').forEach((b: any) => b.addEventListener('click', () => goTo('clients', { view: b.dataset.viewClient })));
  tableWrap.querySelectorAll('[data-edit]').forEach((b: any) => b.addEventListener('click', () => adsFundForm(null, DB.adsFunds.find((a: any) => a.id === b.dataset.edit))));
  tableWrap.querySelectorAll('[data-del]').forEach((b: any) => b.addEventListener('click', () => {
    confirmAction('এই Ad Spend এন্ট্রিটি ডিলিট করবেন?', () => { DB.adsFunds = DB.adsFunds.filter((a: any) => a.id !== b.dataset.del); save(); toast('Entry deleted'); renderAdsFundBody(); });
  }));
}

function adsFundForm(presetClientId?: string | null, existing?: any) {
  const a = existing || { date: todayStr(), platform: 'Meta', clientId: presetClientId || adsRangeState.clientId || '' };
  openModal({
    title: existing ? 'Edit Ad Spend Entry' : 'Add Ad Spend Entry',
    bodyHtml: `<div class="form-grid">
      <div class="field"><label>Client *</label><select id="f_client"><option value="">Select client…</option>${DB.clients.map((c: any) => `<option value="${c.id}" ${a.clientId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Date *</label><input type="date" id="f_date" value="${a.date}"/></div>
      <div class="field"><label>Platform</label><select id="f_platform">${ADS_PLATFORMS.map(p => `<option ${a.platform === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="field"><label>Amount Spent (৳) *</label><input type="number" id="f_amount" value="${a.amount || ''}" min="0" step="0.01"/></div>
      <div class="field full"><label>Notes</label><input id="f_notes" value="${escapeHtml(a.notes || '')}"/></div>
    </div>`,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-primary" id="cSave">${existing ? 'Save' : 'Add Entry'}</button>`
  });
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    const clientId = (document.getElementById('f_client') as HTMLSelectElement).value;
    const amount = Number((document.getElementById('f_amount') as HTMLInputElement).value || 0);
    if (!clientId || amount <= 0) { toast('Client ও সঠিক amount দিন', true); return; }
    const data = { id: a.id || uid('ads'), clientId, date: (document.getElementById('f_date') as HTMLInputElement).value, type: 'Ad Spend', platform: (document.getElementById('f_platform') as HTMLSelectElement).value, amount, notes: (document.getElementById('f_notes') as HTMLInputElement).value };
    if (existing) Object.assign(existing, data); else DB.adsFunds.push(data);
    save(); closeModal(); toast('Saved'); renderAdsFundBody();
  };
}

const empRangeState = { preset: 'all', from: '', to: '' };
PAGES['employees'] = function (root) {
  const { from, to } = genRangeBounds(empRangeState);
  const paidInRange = (eid: string) => DB.employeePayments.filter((p: any) => p.employeeId === eid && (!from || p.date >= from) && (!to || p.date <= to)).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const sumField = (list: any[], f: string) => list.reduce((s, e) => s + Number(e[f] || 0), 0);
  const totalCommitted = sumField(DB.employees, 'salary') + sumField(DB.employees, 'bonus');
  const totalPaid = DB.employees.reduce((s: number, e: any) => s + employeePaidTotal(e.id), 0);
  const totalPaidInRange = DB.employees.reduce((s: number, e: any) => s + paidInRange(e.id), 0);
  const totalOwed = Math.max(totalCommitted - totalPaid, 0);
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Team & Freelancers</h2><div class="desc">Salary, bonus, and freelancer payment tracking</div></div>
      <div class="section-actions"><button class="btn btn-gold" id="addEmpBtn"><i class="fa-solid fa-plus"></i> Add Person</button></div>
    </div>
    <div class="filter-bar">${genRangeBarHtml(empRangeState, 'emp')}</div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Team Members</div><div class="kpi-value num">${DB.employees.length}</div></div>
      <div class="kpi accent-gold"><div class="kpi-label">Total Committed</div><div class="kpi-value num">${BDT(totalCommitted)}</div></div>
      <div class="kpi accent-teal"><div class="kpi-label">Paid — Selected Period</div><div class="kpi-value num">${BDT(totalPaidInRange)}</div></div>
      <div class="kpi accent-red"><div class="kpi-label">Total Due to Team</div><div class="kpi-value num">${BDT(totalOwed)}</div></div>
    </div>
    <div class="panel"><div class="panel-body table-wrap" id="empTableWrap"></div></div>
  `;
  document.getElementById('addEmpBtn')?.addEventListener('click', () => employeeForm());
  genRangeWire(empRangeState, 'emp', () => goTo('employees'));
  renderEmployeesTable();
};

function renderEmployeesTable() {
  const wrap = document.getElementById('empTableWrap');
  if (!wrap) return;
  const { from, to } = genRangeBounds(empRangeState);
  if (!DB.employees.length) { wrap.innerHTML = emptyState('fa-user-tie', 'কোনো employee/freelancer যোগ করা হয়নি।'); return; }
  const rows = DB.employees.map((e: any) => {
    const paidTotal = employeePaidTotal(e.id);
    const paidInPeriod = DB.employeePayments.filter((p: any) => p.employeeId === e.id && (!from || p.date >= from) && (!to || p.date <= to)).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    const owed = Number(e.salary || 0) + Number(e.bonus || 0) - paidTotal;
    return `<tr>
      <td class="name-cell"><span class="client-avatar">${initials(e.name)}</span><div><div style="font-weight:600;">${escapeHtml(e.name)}</div><div class="muted" style="font-size:11.5px;">${escapeHtml(e.position || '')}</div></div></td>
      <td><span class="pill">${escapeHtml(e.type)}</span></td>
      <td class="num">${BDT(e.salary)}</td>
      <td class="num">${BDT(e.bonus)}</td>
      <td class="num" style="color:var(--gold);font-weight:600;">${BDT(paidInPeriod)}</td>
      <td class="num" style="color:var(--teal);">${BDT(paidTotal)}</td>
      <td class="num" style="color:${owed > 0 ? 'var(--red)' : 'var(--teal)'}">${BDT(owed)}</td>
      <td class="row-actions">
        <button class="btn btn-sm btn-gold" data-pay="${e.id}">+ Pay</button>
        <button class="icon-btn" data-edit="${e.id}"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-btn" data-del="${e.id}"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `<table><thead><tr><th>Name</th><th>Type</th><th class="num">Salary/Rate</th><th class="num">Bonus</th><th class="num">Paid (Period)</th><th class="num">Paid (All-time)</th><th class="num">Due</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  wrap.querySelectorAll('[data-edit]').forEach((b: any) => b.addEventListener('click', () => employeeForm(DB.employees.find((e: any) => e.id === b.dataset.edit))));
  wrap.querySelectorAll('[data-pay]').forEach((b: any) => b.addEventListener('click', () => employeePaymentForm(DB.employees.find((e: any) => e.id === b.dataset.pay))));
  wrap.querySelectorAll('[data-del]').forEach((b: any) => b.addEventListener('click', () => {
    confirmAction('এই এন্ট্রিটি ডিলিট করবেন?', () => { DB.employeePayments = DB.employeePayments.filter((p: any) => p.employeeId !== b.dataset.del); DB.employees = DB.employees.filter((e: any) => e.id !== b.dataset.del); save(); toast('Deleted'); goTo('employees'); });
  }));
}

function employeePaymentForm(emp: any) {
  openModal({
    title: `Pay ${emp.name}`,
    bodyHtml: `<div class="form-grid">
      <div class="field"><label>Amount (৳) *</label><input type="number" id="f_amount" min="0"/></div>
      <div class="field"><label>Date</label><input type="date" id="f_date" value="${todayStr()}"/></div>
      <div class="field"><label>Paid From Account *</label><select id="f_account">${DB.accounts.map((a: any) => `<option value="${a.id}" ${a.id === 'acc_bank' ? 'selected' : ''}>${escapeHtml(a.name)} (${BDT(accountBalance(a.id))})</option>`).join('')}</select></div>
      <div class="field full"><label>Note</label><input id="f_note" placeholder="Monthly salary"/></div>
    </div>`,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-primary" id="cSave">Record Payment</button>`
  });
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    const amount = Number((document.getElementById('f_amount') as HTMLInputElement).value || 0);
    if (!amount || amount <= 0) { toast('সঠিক amount দিন', true); return; }
    const accountId = (document.getElementById('f_account') as HTMLSelectElement).value;
    DB.employeePayments.push({ id: uid('epay'), employeeId: emp.id, date: (document.getElementById('f_date') as HTMLInputElement).value, amount, accountId, note: (document.getElementById('f_note') as HTMLInputElement).value });
    save(); closeModal(); toast('Payment recorded'); goTo('employees');
  };
}

function employeeForm(existing?: any) {
  const e = existing || { type: 'Employee', joinDate: todayStr() };
  openModal({
    title: existing ? 'Edit Person' : 'Add Employee / Freelancer',
    bodyHtml: `<div class="form-grid">
      <div class="field"><label>Name *</label><input id="f_name" value="${escapeHtml(e.name || '')}"/></div>
      <div class="field"><label>Type</label><select id="f_type"><option ${e.type === 'Employee' ? 'selected' : ''}>Employee</option><option ${e.type === 'Freelancer' ? 'selected' : ''}>Freelancer</option></select></div>
      <div class="field"><label>Position / Project</label><input id="f_position" value="${escapeHtml(e.position || '')}"/></div>
      <div class="field"><label>Joining Date</label><input type="date" id="f_join" value="${e.joinDate || todayStr()}"/></div>
      <div class="field"><label>Monthly Salary / Project Amount (৳)</label><input type="number" id="f_salary" value="${e.salary || 0}" min="0"/></div>
      <div class="field full"><label>Bonus / Commission (৳)</label><input type="number" id="f_bonus" value="${e.bonus || 0}" min="0"/></div>
    </div>`,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-primary" id="cSave">${existing ? 'Save' : 'Add'}</button>`
  });
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    const name = (document.getElementById('f_name') as HTMLInputElement).value.trim();
    if (!name) { toast('Name required', true); return; }
    const data = { id: e.id || uid('emp'), name, type: (document.getElementById('f_type') as HTMLSelectElement).value, position: (document.getElementById('f_position') as HTMLInputElement).value, joinDate: (document.getElementById('f_join') as HTMLInputElement).value, salary: Number((document.getElementById('f_salary') as HTMLInputElement).value || 0), bonus: Number((document.getElementById('f_bonus') as HTMLInputElement).value || 0) };
    if (existing) Object.assign(existing, data); else DB.employees.push(data);
    save(); closeModal(); toast('Saved'); goTo('employees');
  };
}

/* ========================= ACCOUNTS ========================= */
PAGES['accounts'] = function (root) {
  const totalBal = DB.accounts.reduce((s: number, a: any) => s + accountBalance(a.id), 0);
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Cash & Bank</h2><div class="desc">Total business balance: <b class="num">${BDT(totalBal)}</b></div></div>
      <div class="section-actions">
        <button class="btn" id="transferBtn" ${DB.accounts.length < 2 ? 'disabled' : ''}><i class="fa-solid fa-right-left"></i> Transfer Money</button>
        <button class="btn btn-gold" id="addAccBtn"><i class="fa-solid fa-plus"></i> Add Account</button>
      </div>
    </div>
    <div class="grid-3" id="accCards"></div>
    <div class="panel"><div class="panel-head"><h3>Transfer History</h3></div>
      <div class="panel-body table-wrap">${DB.transfers.length ? `<table><thead><tr><th>Date</th><th>From</th><th>To</th><th class="num">Amount</th><th>Notes</th></tr></thead><tbody>${[...DB.transfers].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((t: any) => `<tr><td>${fmtDate(t.date)}</td><td>${escapeHtml((accountById(t.from) || {}).name || '—')}</td><td>${escapeHtml((accountById(t.to) || {}).name || '—')}</td><td class="num">${BDT(t.amount)}</td><td>${escapeHtml(t.notes || '—')}</td></tr>`).join('')}</tbody></table>` : emptyState('fa-right-left', 'কোনো money transfer হয়নি।')}</div></div>
  `;
  document.getElementById('addAccBtn')?.addEventListener('click', () => accountForm());
  document.getElementById('transferBtn')?.addEventListener('click', () => transferForm());
  const wrap = document.getElementById('accCards')!;
  wrap.innerHTML = DB.accounts.map((a: any) => {
    const bal = accountBalance(a.id);
    return `<div class="panel" style="margin-bottom:0;">
      <div class="panel-head"><h3>${escapeHtml(a.name)}</h3><span class="pill">${escapeHtml(a.type)}</span></div>
      <div class="panel-body">
        <div class="kpi-value num" style="font-size:22px;color:${bal >= 0 ? 'var(--ink)' : 'var(--red)'}">${BDT(bal)}</div>
        <div class="hint" style="margin-top:4px;">Opening balance: ${BDT(a.opening)}</div>
        <div class="row-actions" style="margin-top:10px;"><button class="icon-btn" data-edit="${a.id}"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-btn" data-del="${a.id}"><i class="fa-solid fa-trash"></i></button></div>
      </div></div>`;
  }).join('');
  wrap.querySelectorAll('[data-edit]').forEach((b: any) => b.addEventListener('click', () => accountForm(accountById(b.dataset.edit))));
  wrap.querySelectorAll('[data-del]').forEach((b: any) => b.addEventListener('click', () => {
    if (DB.accounts.length <= 1) { toast('অন্তত ১টি account থাকতেই হবে', true); return; }
    confirmAction('Account ডিলিট করবেন?', () => { DB.accounts = DB.accounts.filter((a: any) => a.id !== b.dataset.del); save(); toast('Account deleted'); goTo('accounts'); });
  }));
};

function accountForm(existing?: any) {
  const a = existing || { type: 'Bank', opening: 0 };
  openModal({
    title: existing ? 'Edit Account' : 'Add Account',
    bodyHtml: `<div class="form-grid">
      <div class="field full"><label>Account Name *</label><input id="f_name" value="${escapeHtml(a.name || '')}"/></div>
      <div class="field"><label>Type</label><select id="f_type">${['Cash', 'Bank', 'Mobile Wallet', 'Gateway', 'Other'].map(t => `<option ${a.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Opening Balance (৳)</label><input type="number" id="f_open" value="${a.opening || 0}" min="0"/></div>
    </div>`,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-primary" id="cSave">${existing ? 'Save' : 'Add'}</button>`
  });
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    const name = (document.getElementById('f_name') as HTMLInputElement).value.trim();
    if (!name) { toast('Name required', true); return; }
    const data = { id: a.id || uid('acc'), name, type: (document.getElementById('f_type') as HTMLSelectElement).value, opening: Number((document.getElementById('f_open') as HTMLInputElement).value || 0) };
    if (existing) Object.assign(existing, data); else DB.accounts.push(data);
    save(); closeModal(); toast('Saved'); goTo('accounts');
  };
}

function transferForm() {
  openModal({
    title: 'Transfer Money',
    bodyHtml: `<div class="form-grid">
      <div class="field"><label>From Account</label><select id="f_from">${DB.accounts.map((a: any) => `<option value="${a.id}">${escapeHtml(a.name)} (${BDT(accountBalance(a.id))})</option>`).join('')}</select></div>
      <div class="field"><label>To Account</label><select id="f_to">${DB.accounts.map((a: any) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Amount (৳) *</label><input type="number" id="f_amount" min="0" step="0.01"/></div>
      <div class="field"><label>Date</label><input type="date" id="f_date" value="${todayStr()}"/></div>
      <div class="field full"><label>Notes</label><input id="f_notes"/></div>
    </div>`,
    footHtml: `<button class="btn" id="cCancel">Cancel</button><button class="btn btn-primary" id="cSave">Transfer</button>`
  });
  document.getElementById('cCancel')!.onclick = closeModal;
  document.getElementById('cSave')!.onclick = () => {
    const from = (document.getElementById('f_from') as HTMLSelectElement).value, to = (document.getElementById('f_to') as HTMLSelectElement).value;
    const amount = Number((document.getElementById('f_amount') as HTMLInputElement).value || 0);
    if (from === to) { toast('From ও To account একই হতে পারবে না', true); return; }
    if (!amount || amount <= 0) { toast('সঠিক amount দিন', true); return; }
    DB.transfers.push({ id: uid('trf'), from, to, amount, date: (document.getElementById('f_date') as HTMLInputElement).value, notes: (document.getElementById('f_notes') as HTMLInputElement).value });
    save(); closeModal(); toast('Transfer complete'); goTo('accounts');
  };
}

/* ========================= ACCOUNT STATEMENT (LEDGER) ========================= */
const statementRangeState = { preset: 'all', from: '', to: '', clientId: '' };
function clientLedgerEntries(clientId: string) {
  const entries: any[] = [];
  DB.invoices.filter((i: any) => i.clientId === clientId && i.status !== 'Cancelled').forEach((i: any) => {
    entries.push({ date: i.date, desc: `Invoice ${i.number}`, debit: invoiceTotals(i).total, credit: 0 });
  });
  DB.payments.filter((p: any) => p.clientId === clientId).forEach((p: any) => {
    const inv = invoiceById(p.invoiceId);
    entries.push({ date: p.date, desc: `Payment received${inv ? ' — ' + inv.number : ''}${p.method ? ' (' + p.method + ')' : ''}`, debit: 0, credit: Number(p.amount || 0) });
  });
  (DB.refunds || []).filter((r: any) => r.clientId === clientId).forEach((r: any) => {
    const inv = invoiceById(r.invoiceId);
    entries.push({ date: r.date, desc: `Refund issued${inv ? ' — ' + inv.number : ''}`, debit: Number(r.amount || 0), credit: 0 });
  });
  entries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return entries;
}

PAGES['ledger'] = function (root) {
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Account Statement</h2><div class="desc">প্রতিটি client-এর debit/credit history</div></div>
      <div class="section-actions"><button class="btn btn-gold" id="printStmtBtn" disabled><i class="fa-solid fa-file-pdf"></i> Print / Save as PDF</button></div>
    </div>
    <div class="filter-bar">
      <select id="ledgerClient"><option value="">Select a client…</option>${DB.clients.map((c: any) => `<option value="${c.id}" ${statementRangeState.clientId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
      ${genRangeBarHtml(statementRangeState, 'stmt')}
    </div>
    <div id="ledgerBody">${emptyState('fa-book', 'ক্লায়েন্ট সিলেক্ট করুন statement দেখার জন্য।')}</div>
  `;
  document.getElementById('ledgerClient')?.addEventListener('change', (e: any) => { statementRangeState.clientId = e.target.value; goTo('ledger'); });
  genRangeWire(statementRangeState, 'stmt', () => goTo('ledger'), () => renderLedgerBody(statementRangeState.clientId));
  document.getElementById('printStmtBtn')?.addEventListener('click', () => {
    const clientId = statementRangeState.clientId;
    if (!clientId) return;
    const { from, to } = genRangeBounds(statementRangeState);
    const allEntries = clientLedgerEntries(clientId);
    const before = allEntries.filter(e => from && e.date < from);
    const inRange = allEntries.filter(e => (!from || e.date >= from) && (!to || e.date <= to));
    const openingBal = before.reduce((s, e) => s + e.debit - e.credit, 0);
    printStatementDoc(clientById(clientId) || {}, from, to, openingBal, inRange);
  });
  renderLedgerBody(statementRangeState.clientId);
};

function renderLedgerBody(clientId: string) {
  const body = document.getElementById('ledgerBody');
  const printBtn = document.getElementById('printStmtBtn') as HTMLButtonElement;
  if (!body) return;
  if (!clientId) { body.innerHTML = emptyState('fa-book', 'ক্লায়েন্ট সিলেক্ট করুন statement দেখার জন্য।'); if (printBtn) printBtn.disabled = true; return; }
  if (printBtn) printBtn.disabled = false;
  const { from, to } = genRangeBounds(statementRangeState);
  const allEntries = clientLedgerEntries(clientId);
  const before = allEntries.filter(e => from && e.date < from);
  const inRange = allEntries.filter(e => (!from || e.date >= from) && (!to || e.date <= to));
  const openingBal = before.reduce((s, e) => s + e.debit - e.credit, 0);
  let bal = openingBal;
  const rows = inRange.map(e => { bal += e.debit - e.credit; return `<tr><td>${fmtDate(e.date)}</td><td>${escapeHtml(e.desc)}</td><td class="num">${e.debit ? BDT(e.debit) : '—'}</td><td class="num">${e.credit ? BDT(e.credit) : '—'}</td><td class="num" style="font-weight:600;">${BDT(bal)}</td></tr>`; }).join('');
  const c = clientById(clientId);
  body.innerHTML = `
    <div class="ledger-header"><h3>${escapeHtml(c?.name || '')} — Statement</h3><div class="pill">Closing balance: <b class="num">&nbsp;${BDT(bal)}</b></div></div>
    <div class="panel"><div class="panel-body table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead><tbody>
    ${from ? `<tr style="background:#F7F4EC;"><td colspan="4" style="font-weight:600;">Opening Balance (before ${fmtDate(from)})</td><td class="num" style="font-weight:700;">${BDT(openingBal)}</td></tr>` : ''}
    ${rows || `<tr><td colspan="5">${emptyState('fa-book', 'এই সময়সীমায় কোনো লেনদেন নেই।')}</td></tr>`}
    </tbody></table></div></div>
  `;
}
