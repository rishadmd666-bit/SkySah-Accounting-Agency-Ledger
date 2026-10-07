import { BDT, fmtDate, todayStr, escapeHtml } from './ledgerHelpers';
import { LOGO_DATA_URI } from './logo';

function triggerInAppPrint(htmlContent: string, title: string) {
  let stage = document.getElementById('printStage');
  if (!stage) {
    stage = document.createElement('div');
    stage.id = 'printStage';
    stage.className = 'print-stage';
    document.body.appendChild(stage);
  }
  stage.innerHTML = htmlContent;
  const prevTitle = document.title;
  document.title = title;
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.title = prevTitle;
    }, 500);
  }, 150);
}

export function invoiceStatusColor(st: string) {
  return ({ 'Paid': '#1F6E56', 'Partially Paid': '#B4863A', 'Pending': '#6E7583', 'Overdue': '#A6392F', 'Cancelled': '#9AA1AC' } as Record<string, string>)[st] || '#6E7583';
}

export function printInvoiceDoc(inv: any, c: any, t: any, paid: number, refunded: number, st: string, accounts: any[]) {
  const due = t.total - paid;
  const stColor = invoiceStatusColor(st);
  const html = `
  <style>
  .p-sheet{max-width:820px;margin:0 auto;padding:24px 32px;font-family:'Hind Siliguri',Arial,sans-serif;color:#1C2430;background:#fff;}
  .p-topbar{height:8px;background:linear-gradient(90deg,#0E1B2A,#B4863A);margin-bottom:20px;}
  .p-letterhead{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;margin-bottom:22px;border-bottom:2px solid #0E1B2A;}
  .p-brandrow{display:flex;align-items:center;gap:14px;}
  .p-brandrow img{width:56px;height:56px;border-radius:50%;object-fit:contain;}
  .p-brand{font-size:23px;font-weight:700;color:#0E1B2A;letter-spacing:.2px;}
  .p-brand small{display:block;font-size:11.5px;font-weight:500;color:#6E7583;margin-top:2px;}
  .p-invhead{text-align:right;}
  .p-invhead h1{font-size:20px;margin:0 0 6px;color:#0E1B2A;letter-spacing:.4px;}
  .p-status{display:inline-block;padding:4px 14px;border-radius:20px;font-size:11.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#fff;background:${stColor};}
  .p-infogrid{display:flex;justify-content:space-between;gap:24px;margin-bottom:24px;}
  .p-infobox{flex:1;background:#F7F4EC;border-radius:10px;padding:14px 16px;}
  .p-infobox h4{margin:0 0 8px;font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;color:#B4863A;font-weight:700;}
  .p-infobox .name{font-weight:700;font-size:14.5px;color:#0E1B2A;}
  .p-infobox .line{font-size:12.5px;color:#4A5262;margin-top:2px;}
  .p-infobox .kv{display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0;color:#4A5262;}
  .p-infobox .kv b{color:#1C2430;}
  .p-sheet table{width:100%;border-collapse:collapse;margin-top:6px;}
  .p-sheet thead th{background:#0E1B2A;color:#fff;padding:10px 10px;font-size:11.5px;text-transform:uppercase;letter-spacing:.3px;text-align:left;}
  .p-sheet thead th.num,.p-sheet td.num{text-align:right;}
  .p-sheet tbody td{padding:10px;border-bottom:1px solid #EDE9DC;font-size:13px;}
  .p-totwrap{display:flex;justify-content:flex-end;margin-top:16px;}
  .p-tot{width:290px;}
  .p-tot div{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;color:#4A5262;}
  .p-tot .grand{font-weight:700;font-size:18px;border-top:2px solid #1C2430;margin-top:6px;padding-top:10px;color:#0E1B2A;}
  .p-tot .paidline{color:#1F6E56;font-weight:600;}
  .p-tot .dueline{font-weight:700;font-size:15px;color:${due > 0.5 ? '#A6392F' : '#1F6E56'};border-top:1px dashed #DCD4BF;margin-top:6px;padding-top:8px;}
  .p-bottom-grid{display:flex;gap:24px;margin-top:30px;}
  .p-paybox{flex:1;background:#F7F4EC;border-radius:10px;padding:14px 16px;font-size:12px;color:#4A5262;}
  .p-paybox h4,.p-notesbox h4{margin:0 0 8px;font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;color:#B4863A;font-weight:700;}
  .p-paybox .method{display:inline-block;background:#fff;border:1px solid #DCD4BF;border-radius:14px;padding:3px 10px;margin:2px 4px 2px 0;font-size:11.5px;}
  .p-notesbox{flex:1;font-size:12px;color:#4A5262;}
  .p-footer{text-align:center;margin-top:36px;padding-top:16px;border-top:1px solid #EDE9DC;color:#8A8F99;font-size:11.5px;}
  </style>
  <div class="p-topbar"></div>
  <div class="p-sheet">
    <div class="p-letterhead">
      <div class="p-brandrow"><img src="${LOGO_DATA_URI}" alt="SkySah"/><div class="p-brand">SkySah<small>Digital Marketing Agency</small></div></div>
      <div class="p-invhead"><h1>INVOICE</h1><div style="font-size:12.5px;color:#6E7583;margin-bottom:8px;">#${escapeHtml(inv.number)}</div><span class="p-status">${escapeHtml(st)}</span></div>
    </div>
    <div class="p-infogrid">
      <div class="p-infobox"><h4>Bill To</h4>
        <div class="name">${escapeHtml(c.name || '')}</div>
        ${c.company ? `<div class="line">${escapeHtml(c.company)}</div>` : ''}
        ${c.address ? `<div class="line">${escapeHtml(c.address)}</div>` : ''}
        ${c.phone ? `<div class="line">${escapeHtml(c.phone)}</div>` : ''}
      </div>
      <div class="p-infobox"><h4>Invoice Details</h4>
        <div class="kv"><span>Invoice Date</span><b>${fmtDate(inv.date)}</b></div>
        <div class="kv"><span>Due Date</span><b>${fmtDate(inv.dueDate)}</b></div>
        ${inv.recurring ? `<div class="kv"><span>Type</span><b>Recurring</b></div>` : ''}
      </div>
    </div>
    <table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead>
    <tbody>${(inv.items || []).map((li: any) => {
      const base = (li.qty || 0) * (li.price || 0);
      const line = base * (1 - (li.discount || 0) / 100) * (1 + (li.tax || 0) / 100);
      return `<tr><td>${escapeHtml(li.name)}${li.discount || li.tax ? `<div style="font-size:11.5px;color:#8A8F99;">${li.discount ? `Discount ${li.discount}%` : ''}${li.discount && li.tax ? ' · ' : ''}${li.tax ? `Tax ${li.tax}%` : ''}</div>` : ''}</td><td class="num">${li.qty}</td><td class="num">${BDT(li.price)}</td><td class="num">${BDT(line)}</td></tr>`;
    }).join('')}</tbody></table>
    <div class="p-totwrap"><div class="p-tot">
      <div><span>Subtotal (Excl. Tax)</span><span>${BDT(t.subtotal)}</span></div>
      <div><span>Discount</span><span>- ${BDT(t.discountAmt)}</span></div>
      <div><span>${t.vatMode === 'inclusive' ? 'VAT (included)' : 'Total Tax / VAT'}</span><span>${t.vatMode === 'inclusive' ? '' : '+ '}${BDT(t.taxAmt)}</span></div>
      <div class="grand"><span>Total</span><span>${BDT(t.total)}</span></div>
      <div class="paidline"><span>Paid</span><span>${BDT(paid)}</span></div>
      ${refunded > 0.5 ? `<div style="color:#A6392F;"><span>Refunded</span><span>- ${BDT(refunded)}</span></div>` : ''}
      <div class="dueline"><span>${due > 0.5 ? 'Amount Due' : 'Balance'}</span><span>${BDT(due)}</span></div>
    </div></div>
    <div class="p-bottom-grid">
      <div class="p-paybox"><h4>Accepted Payment Methods</h4>
        ${accounts.map(a => `<span class="method">${escapeHtml(a.name)}</span>`).join('')}
        <div style="margin-top:8px;">Please reference invoice <b>${escapeHtml(inv.number)}</b> with your payment.</div>
      </div>
      <div class="p-notesbox"><h4>Notes</h4>${inv.notes ? escapeHtml(inv.notes) : 'Thank you for choosing SkySah for your digital marketing needs.'}</div>
    </div>
    <div class="p-footer">Thank you for your business, <b>${escapeHtml(c.name || '')}</b>! For any questions about this invoice, please contact us.</div>
  </div>`;
  triggerInAppPrint(html, inv.number);
}

export function printStatementDoc(c: any, from: string | null, to: string | null, openingBal: number, inRange: any[]) {
  let bal = openingBal;
  const rows = inRange.map(e => {
    bal += e.debit - e.credit;
    return `<tr><td>${fmtDate(e.date)}</td><td>${escapeHtml(e.desc)}</td><td class="num">${e.debit ? BDT(e.debit) : '—'}</td><td class="num">${e.credit ? BDT(e.credit) : '—'}</td><td class="num" style="font-weight:600;">${BDT(bal)}</td></tr>`;
  }).join('');
  const rangeLabel = !from && !to ? 'All Time' : `${from ? fmtDate(from) : '…'} — ${to ? fmtDate(to) : '…'}`;
  const html = `
  <div style="max-width:820px;margin:0 auto;padding:24px 32px;font-family:'Hind Siliguri',Arial,sans-serif;color:#1C2430;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;margin-bottom:22px;border-bottom:2px solid #0E1B2A;">
      <div style="display:flex;align-items:center;gap:14px;"><img src="${LOGO_DATA_URI}" alt="SkySah" style="width:52px;height:52px;border-radius:50%;"/><div style="font-size:22px;font-weight:700;">SkySah<small style="display:block;font-size:11.5px;color:#6E7583;">Digital Marketing Agency</small></div></div>
      <div style="text-align:right;"><h1 style="font-size:20px;margin:0 0 6px;">ACCOUNT STATEMENT</h1><div style="font-size:12.5px;color:#6E7583;">${escapeHtml(rangeLabel)}</div></div>
    </div>
    <div style="background:#F7F4EC;border-radius:10px;padding:14px 16px;margin-bottom:20px;">
      <div style="font-weight:700;font-size:14.5px;">${escapeHtml(c.name || '')}</div>
      ${c.company ? `<div style="font-size:12.5px;color:#4A5262;">${escapeHtml(c.company)}</div>` : ''}
      ${c.address ? `<div style="font-size:12.5px;color:#4A5262;">${escapeHtml(c.address)}</div>` : ''}
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#0E1B2A;color:#fff;"><th style="padding:9px 10px;text-align:left;">Date</th><th style="padding:9px 10px;text-align:left;">Description</th><th style="padding:9px 10px;text-align:right;">Debit</th><th style="padding:9px 10px;text-align:right;">Credit</th><th style="padding:9px 10px;text-align:right;">Balance</th></tr></thead>
      <tbody>
        ${from ? `<tr style="background:#F7F4EC;"><td colspan="4" style="padding:9px 10px;font-weight:600;">Opening Balance (before ${fmtDate(from)})</td><td style="padding:9px 10px;text-align:right;font-weight:700;">${BDT(openingBal)}</td></tr>` : ''}
        ${rows || `<tr><td colspan="5" style="text-align:center;padding:20px;color:#8A8F99;">No transactions in this period.</td></tr>`}
      </tbody>
      <tfoot><tr style="border-top:2px solid #1C2430;background:#F7F4EC;"><td colspan="2" style="padding:10px;font-weight:700;">Period Total (${inRange.length} entries)</td><td style="padding:10px;text-align:right;font-weight:700;">${BDT(inRange.reduce((s, e) => s + e.debit, 0))}</td><td style="padding:10px;text-align:right;font-weight:700;">${BDT(inRange.reduce((s, e) => s + e.credit, 0))}</td><td style="padding:10px;text-align:right;font-weight:700;">${BDT(bal)}</td></tr></tfoot>
    </table>
  </div>`;
  triggerInAppPrint(html, `Statement - ${c.name || ''}`);
}

export function printGenericReportDoc(title: string, subtitle: string, bodyHtml: string) {
  const html = `
  <div style="max-width:860px;margin:0 auto;padding:24px 32px;font-family:'Hind Siliguri',Arial,sans-serif;color:#1C2430;">
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #0E1B2A;padding-bottom:14px;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:12px;"><img src="${LOGO_DATA_URI}" alt="SkySah" style="width:50px;height:50px;border-radius:50%;"/><div style="font-size:20px;font-weight:700;">SkySah<small style="display:block;font-size:11px;font-weight:400;color:#6E7583;">Digital Marketing Agency</small></div></div>
      <div style="text-align:right;"><div style="font-size:16px;font-weight:700;">${escapeHtml(title)}</div><div style="font-size:12px;color:#6E7583;">${escapeHtml(subtitle)}</div></div>
    </div>
    ${bodyHtml}
    <div style="margin-top:40px;text-align:center;font-size:11px;color:#9aa1ac;">SkySah Accounting — Confidential internal financial report.</div>
  </div>`;
  triggerInAppPrint(html, `${title} — ${subtitle}`);
}

export function printQuotationDoc(q: any, c: any) {
  const rowsHtml = (q.items || []).map((li: any) => {
    const lineTotal = (li.qty || 1) * (li.price || 0);
    return `<tr><td>${escapeHtml(li.name)}</td><td class="num">${li.qty}</td><td class="num">${BDT(li.price)}</td><td class="num">${BDT(lineTotal)}</td></tr>`;
  }).join('');
  const html = `
  <div style="max-width:800px;margin:0 auto;padding:30px;font-family:Georgia,'Times New Roman',serif;color:#1C2430;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #B4863A;padding-bottom:18px;margin-bottom:28px;">
      <div style="display:flex;align-items:center;gap:14px;"><img src="${LOGO_DATA_URI}" alt="SkySah" style="width:56px;height:56px;border-radius:50%;"/><div style="font-size:24px;font-weight:bold;">SkySah<small style="display:block;font-size:11px;font-weight:normal;text-transform:uppercase;color:#6E7583;">Digital Marketing Agency</small></div></div>
      <div style="text-align:right;"><h1 style="margin:0;font-size:20px;text-transform:uppercase;color:#B4863A;">Proposal</h1><div style="font-size:12.5px;color:#6E7583;">Quote ${escapeHtml(q.number)}</div></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:26px;font-size:13.5px;">
      <div style="width:47%;"><h4 style="font-size:10.5px;text-transform:uppercase;color:#6E7583;margin:0 0 6px;">Prepared For</h4><b>${escapeHtml(c.name || '')}</b><br/>${escapeHtml(c.company || '')}<br/>${escapeHtml(c.address || '')}<br/>${escapeHtml(c.phone || '')}</div>
      <div style="width:47%;text-align:right;"><h4 style="font-size:10.5px;text-transform:uppercase;color:#6E7583;margin:0 0 6px;">Details</h4>Date: ${fmtDate(q.date)}<br/>Valid Until: <b>${fmtDate(q.validUntil)}</b><br/>Status: ${escapeHtml(q.status)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;border-bottom:2px solid #1C2430;padding:8px 6px;">Service / Item</th><th class="num" style="border-bottom:2px solid #1C2430;padding:8px 6px;">Qty</th><th class="num" style="border-bottom:2px solid #1C2430;padding:8px 6px;">Rate</th><th class="num" style="border-bottom:2px solid #1C2430;padding:8px 6px;">Amount</th></tr></thead><tbody>${rowsHtml}</tbody></table>
    <div style="margin-left:auto;width:280px;margin-top:16px;"><div style="display:flex;justify-content:space-between;font-weight:bold;font-size:19px;border-top:2px solid #1C2430;padding-top:10px;color:#B4863A;"><span>Total Proposal Value</span><span>${BDT(q.total)}</span></div></div>
    ${q.notes ? `<div style="margin-top:34px;font-size:12.5px;background:#F6F2E8;padding:14px 18px;border-left:3px solid #B4863A;"><b>Terms & Notes</b><br/>${escapeHtml(q.notes).replace(/\n/g, '<br/>')}</div>` : ''}
    <div style="display:flex;justify-content:space-between;margin-top:60px;">
      <div style="width:42%;border-top:1px solid #1C2430;padding-top:6px;font-size:12px;color:#6E7583;text-align:center;">Client Acceptance Signature</div>
      <div style="width:42%;border-top:1px solid #1C2430;padding-top:6px;font-size:12px;color:#6E7583;text-align:center;">Authorized Signature — SkySah</div>
    </div>
  </div>`;
  triggerInAppPrint(html, `${q.number} — Proposal`);
}
