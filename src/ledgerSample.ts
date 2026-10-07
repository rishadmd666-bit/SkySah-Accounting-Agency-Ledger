import { uid, monthsAgoDate, toLocalISODate, todayStr } from './ledgerHelpers';

export function buildSampleData(emptyDB: () => any, isCOS: (cat: string) => boolean, invoiceTotals: (inv: any) => any) {
  const DB = emptyDB();
  let invoiceSeq = 1000;
  let quoteSeq = 100;
  const nextInv = () => 'INV-' + (++invoiceSeq);
  const nextQt = () => 'QTE-' + (++quoteSeq);

  const svc = (name: string, price: number, cost: number, billingType = 'Monthly', tax = 0) => {
    const o = { id: uid('svc'), name, price, cost, billingType, tax };
    DB.services.push(o);
    return o;
  };
  const s1 = svc('Meta Ads Management', 15000, 4000);
  const s2 = svc('Google Ads', 12000, 3000);
  const s3 = svc('SEO', 10000, 3000);
  const s4 = svc('Social Media Management', 8000, 2000);
  const s5 = svc('Content Writing', 6000, 1500, 'One-time');
  const s6 = svc('AI Video', 5000, 1200, 'One-time');
  const s7 = svc('Website Development', 30000, 9000, 'One-time');
  const s8 = svc('Shopify Store Setup', 20000, 6000, 'One-time');

  DB.packages.push({ id: uid('pkg'), name: 'Starter', price: 8000, billingCycle: 'Monthly', serviceIds: [s4.id] });
  DB.packages.push({ id: uid('pkg'), name: 'Growth', price: 15000, billingCycle: 'Monthly', serviceIds: [s1.id, s4.id] });
  DB.packages.push({ id: uid('pkg'), name: 'Premium', price: 30000, billingCycle: 'Monthly', serviceIds: [s1.id, s2.id, s3.id] });

  const mkClient = (name: string, company: string, industry: string, monthly: number, status = 'Active', terms = 'Net 15') => {
    const c = {
      id: uid('cli'), name, company, phone: '017' + Math.floor(10000000 + Math.random() * 89999999),
      email: name.toLowerCase().replace(/\s+/g, '.') + '@example.com',
      address: 'Dhaka, Bangladesh', website: '', industry, manager: 'Rafiul Islam',
      startDate: '2025-11-01', status, paymentTerms: terms, monthlyPackage: monthly, contractValue: monthly * 12
    };
    DB.clients.push(c);
    return c;
  };
  const c1 = mkClient('Nusrat Jahan', 'Bloom Cosmetics', 'E-commerce', 30000);
  const c2 = mkClient('Tanvir Ahmed', 'UrbanWear BD', 'Fashion', 15000);
  const c3 = mkClient('Farhana Karim', 'GreenLeaf Organics', 'Food & Beverage', 8000);
  const c4 = mkClient('Shahriar Kabir', 'TechNest Solutions', 'SaaS', 20000, 'Active', 'Net 30');
  const c5 = mkClient('Mahin Rahman', 'Old Client Ltd', 'Retail', 0, 'Inactive');

  function mkInvoice(client: any, items: any[], monthsAgo: number, paidRatio: number, terms = 15) {
    const d = monthsAgoDate(monthsAgo);
    const due = new Date(d);
    due.setDate(due.getDate() + terms);
    const inv = {
      id: uid('inv'), number: nextInv(), clientId: client.id, date: toLocalISODate(d), dueDate: toLocalISODate(due),
      method: 'Bank', items, discount: 0, tax: 0, notes: '', recurring: monthsAgo < 3, recurringPeriod: 'Monthly', status: 'Pending'
    };
    DB.invoices.push(inv);
    const total = invoiceTotals(inv).total;
    if (paidRatio > 0) {
      const payDate = new Date(d);
      payDate.setDate(payDate.getDate() + 3);
      DB.payments.push({
        id: uid('pay'), invoiceId: inv.id, clientId: client.id, amount: Math.round(total * paidRatio),
        date: toLocalISODate(payDate), method: 'Bank', accountId: 'acc_bank',
        txnId: 'TXN' + Math.floor(Math.random() * 90000 + 10000), receivedBy: 'Admin', notes: ''
      });
    }
    return inv;
  }
  for (let m = 5; m >= 0; m--) {
    mkInvoice(c1, [{ serviceId: s1.id, name: s1.name, qty: 1, price: s1.price, discount: 0, tax: 0 }, { serviceId: s3.id, name: s3.name, qty: 1, price: s3.price, discount: 0, tax: 0 }], m, m === 0 ? 0.4 : 1);
    mkInvoice(c2, [{ serviceId: s4.id, name: s4.name, qty: 1, price: s4.price, discount: 0, tax: 0 }], m, m === 0 ? 0 : 1);
    if (m % 2 === 0) mkInvoice(c3, [{ serviceId: s6.id, name: s6.name, qty: 2, price: s6.price, discount: 5, tax: 0 }], m, 1);
    mkInvoice(c4, [{ serviceId: s2.id, name: s2.name, qty: 1, price: s2.price, discount: 0, tax: 0 }, { serviceId: s4.id, name: s4.name, qty: 1, price: s4.price, discount: 0, tax: 0 }], m, m <= 1 ? 0.5 : 1);
  }
  mkInvoice(c5, [{ serviceId: s7.id, name: s7.name, qty: 1, price: s7.price, discount: 10, tax: 0 }], 8, 1);

  const expCat = ['Office Rent', 'Video Editing Software', 'AI Tools', 'Own Marketing / Ads', 'Hosting (Client)', 'Freelancers (Client Work)', 'Internet', 'Stock Footage / Music'];
  for (let m = 5; m >= 0; m--) {
    const d = monthsAgoDate(m);
    expCat.forEach(cat => {
      const amt = ({ 'Office Rent': 20000, 'Video Editing Software': 4500, 'AI Tools': 6000, 'Own Marketing / Ads': 8000, 'Hosting (Client)': 1500, 'Freelancers (Client Work)': 12000, 'Internet': 2000, 'Stock Footage / Music': 3000 } as Record<string, number>)[cat];
      DB.expenses.push({ id: uid('exp'), date: toLocalISODate(d), category: cat, amount: amt + Math.round(Math.random() * 1000), vendor: '', method: 'Bank', accountId: 'acc_bank', clientId: isCOS(cat) ? c1.id : '', description: '' });
    });
  }
  const emp1 = { id: uid('emp'), name: 'Rafiul Islam', type: 'Employee', position: 'Ad Campaign Manager', joinDate: '2025-01-10', salary: 45000, bonus: 5000 };
  const emp2 = { id: uid('emp'), name: 'Mim Akter', type: 'Employee', position: 'Content & SEO Writer', joinDate: '2025-03-01', salary: 28000, bonus: 0 };
  const emp3 = { id: uid('emp'), name: 'Arif Hossain', type: 'Freelancer', position: 'AI Video Editor', joinDate: '2026-01-15', salary: 20000, bonus: 3000 };
  DB.employees.push(emp1, emp2, emp3);
  // AUDIT FIX: All sample employee payments explicitly include accountId: 'acc_bank' so Cash & Bank and Balance Sheet match
  for (let m = 5; m >= 0; m--) {
    const d = monthsAgoDate(m);
    const monthName = d.toLocaleDateString('en-GB', { month: 'long' });
    DB.employeePayments.push({ id: uid('epay'), employeeId: emp1.id, date: toLocalISODate(d), amount: m === 0 ? 45000 : 50000, accountId: 'acc_bank', note: monthName + ' salary' + (m === 2 ? ' + bonus' : '') });
    DB.employeePayments.push({ id: uid('epay'), employeeId: emp2.id, date: toLocalISODate(d), amount: m === 0 ? 25000 : 28000, accountId: 'acc_bank', note: monthName + ' salary' });
    if (m % 2 === 0) DB.employeePayments.push({ id: uid('epay'), employeeId: emp3.id, date: toLocalISODate(d), amount: 20000, accountId: 'acc_bank', note: monthName + ' — AI video project' });
  }

  DB.contracts.push({ id: uid('ct'), clientId: c1.id, startDate: '2025-11-01', endDate: '2026-10-31', monthlyFee: 30000, renewalDate: '2026-10-15', services: 'Meta Ads + SEO retainer' });
  DB.contracts.push({ id: uid('ct'), clientId: c4.id, startDate: '2025-12-01', endDate: '2026-09-20', monthlyFee: 20000, renewalDate: '2026-09-20', services: 'Google Ads + Social Media' });

  DB.quotations.push({ id: uid('qt'), number: nextQt(), clientId: c3.id, date: todayStr(), validUntil: '2026-10-01', items: [{ serviceId: s7.id, name: s7.name, qty: 1, price: s7.price }], total: s7.price, status: 'Sent', notes: 'Website revamp proposal' });

  // Sample Client Ads Fund — Spend Log entries across months, clients, and platforms
  for (let m = 5; m >= 0; m--) {
    const d1 = monthsAgoDate(m);
    const d2 = new Date(d1);
    d2.setDate(Math.min(28, d1.getDate() + 4));
    DB.adsFunds.push({ id: uid('ads'), clientId: c1.id, date: toLocalISODate(d1), type: 'Ad Spend', platform: 'Meta', amount: 45000 + (m * 2500), notes: 'Facebook & Instagram conversion campaigns' });
    DB.adsFunds.push({ id: uid('ads'), clientId: c1.id, date: toLocalISODate(d2), type: 'Ad Spend', platform: 'Google', amount: 18000 + (m * 1000), notes: 'Search & Shopping ads' });
    DB.adsFunds.push({ id: uid('ads'), clientId: c2.id, date: toLocalISODate(d1), type: 'Ad Spend', platform: 'Meta', amount: 25000 + (m * 1500), notes: 'Collection boost & retargeting' });
    if (m % 2 === 0) {
      DB.adsFunds.push({ id: uid('ads'), clientId: c2.id, date: toLocalISODate(d2), type: 'Ad Spend', platform: 'TikTok', amount: 12000, notes: 'Spark ads video campaign' });
    }
    DB.adsFunds.push({ id: uid('ads'), clientId: c4.id, date: toLocalISODate(d1), type: 'Ad Spend', platform: 'Google', amount: 32000, notes: 'SaaS lead gen search campaign' });
    if (m <= 2) {
      DB.adsFunds.push({ id: uid('ads'), clientId: c4.id, date: toLocalISODate(d2), type: 'Ad Spend', platform: 'LinkedIn', amount: 15000, notes: 'B2B decision-maker sponsored content' });
    }
  }

  DB.invoiceSeq = invoiceSeq;
  DB.quoteSeq = quoteSeq;
  return DB;
}
