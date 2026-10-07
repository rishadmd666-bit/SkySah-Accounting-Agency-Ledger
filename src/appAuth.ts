export interface AppCredentialAccount {
  id: string;
  username: string;
  email: string;
  name: string;
  role: 'Admin' | 'Manager' | 'Accountant' | 'Viewer' | 'Custom';
  isSystemOwner?: boolean; // Only the Master Admin (you) has this true
  allowedPages: string[]; // Page IDs allowed for this user ('*' or specific list)
  canDelete: boolean;     // Can delete records (invoices, expenses, clients, etc.)
  canExport: boolean;     // Can export CSV / Backup
  active: boolean;        // If false, user is suspended/blocked immediately
  passwordHash: string;
  sessionVersion: number; // Incremented whenever password or status changes to force instant logout
  createdAt: string;
  updatedAt?: string;
}

export interface ActiveSession {
  id: string;
  username: string;
  email: string;
  name: string;
  role: string;
  isSystemOwner: boolean;
  allowedPages: string[];
  canDelete: boolean;
  canExport: boolean;
  passwordHash: string;
  sessionVersion: number;
}

export const ALL_MODULE_PAGES: { id: string; label: string; group: string }[] = [
  { id: 'dashboard', label: 'Dashboard (Overview)', group: 'Overview' },
  { id: 'clients', label: 'Clients', group: 'Sales' },
  { id: 'quotations', label: 'Quotations', group: 'Sales' },
  { id: 'invoices', label: 'Invoices', group: 'Sales' },
  { id: 'recurring', label: 'Recurring Billing', group: 'Sales' },
  { id: 'payments', label: 'Payments', group: 'Sales' },
  { id: 'due', label: 'Due / Baki', group: 'Sales' },
  { id: 'reminders', label: 'Payment Reminders', group: 'Sales' },
  { id: 'services', label: 'Services', group: 'Catalog' },
  { id: 'packages', label: 'Packages', group: 'Catalog' },
  { id: 'contracts', label: 'Contracts', group: 'Catalog' },
  { id: 'expenses', label: 'Expenses', group: 'Money' },
  { id: 'ads-fund', label: 'Client Ads Fund', group: 'Money' },
  { id: 'employees', label: 'Team & Freelancers', group: 'Money' },
  { id: 'accounts', label: 'Cash & Bank', group: 'Money' },
  { id: 'ledger', label: 'Account Statement', group: 'Money' },
  { id: 'profitability', label: 'Client Profitability', group: 'Insights' },
  { id: 'service-profit', label: 'Service-wise Profit', group: 'Insights' },
  { id: 'reports', label: 'Financial Reports', group: 'Insights' },
  { id: 'journal', label: 'Journal', group: 'Insights' },
  { id: 'balance-sheet', label: 'Balance Sheet', group: 'Insights' },
  { id: 'audit-log', label: 'Audit Trail / Activity', group: 'Insights' },
];

export const ROLE_PRESETS: Record<string, { allowedPages: string[]; canDelete: boolean; canExport: boolean; desc: string }> = {
  Admin: {
    allowedPages: ALL_MODULE_PAGES.map(p => p.id),
    canDelete: true,
    canExport: true,
    desc: 'সবগুলো মডিউল, ইউজার ম্যানেজমেন্ট, ডিলিট ও ব্যাকআপের পূর্ণ ক্ষমতা (Full Admin Access)',
  },
  Manager: {
    allowedPages: [
      'dashboard', 'clients', 'quotations', 'invoices', 'recurring', 'payments',
      'due', 'reminders', 'services', 'packages', 'contracts', 'expenses', 'ads-fund', 'ledger'
    ],
    canDelete: false,
    canExport: true,
    desc: 'ক্লায়েন্ট, ইনভয়েস, পেমেন্ট, খরচ ও Ads Fund পরিচালনা করতে পারবে (কিন্তু ডিলিট বা স্যালারি/ব্যালেন্স শিট দেখতে পারবে না)',
  },
  Accountant: {
    allowedPages: [
      'dashboard', 'invoices', 'payments', 'due', 'expenses', 'ads-fund',
      'employees', 'accounts', 'ledger', 'profitability', 'service-profit',
      'reports', 'journal', 'balance-sheet', 'audit-log'
    ],
    canDelete: false,
    canExport: true,
    desc: 'সব হিসাব, ইনভয়েস, পেমেন্ট, ব্যাংক, রিপোর্ট, জার্নাল ও ব্যালেন্স শিট দেখতে ও এন্ট্রি দিতে পারবে',
  },
  Viewer: {
    allowedPages: ['dashboard', 'clients', 'invoices', 'due', 'ads-fund', 'reports'],
    canDelete: false,
    canExport: false,
    desc: 'শুধুমাত্র ড্যাশবোর্ড, ইনভয়েস, ডিউ ও রিপোর্ট দেখতে পারবে',
  },
  Custom: {
    allowedPages: ['dashboard'],
    canDelete: false,
    canExport: false,
    desc: 'আপনি নিচে টিক (✓) দিয়ে ঠিক করে দিন এই ইউজার কোন কোন পেজে ঢুকতে পারবে',
  },
};

const CRED_STORAGE_KEY = 'skysah_app_credentials_v2';
const ACTIVE_SESSION_KEY = 'skysah_active_session_v2';

export async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode('skysah_salt_v1::' + text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface PasswordStrengthResult {
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
  score: number; // 0 to 5
  isValid: boolean;
  label: string;
  color: string;
}

export function evaluatePasswordStrength(pw: string): PasswordStrengthResult {
  const hasMinLength = pw.length >= 8;
  const hasUppercase = /[A-Z]/.test(pw);
  const hasLowercase = /[a-z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  const hasSpecial = /[^A-Za-z0-9]/.test(pw);

  const checks = [hasMinLength, hasUppercase, hasNumber, hasSpecial];
  const passedRequired = checks.filter(Boolean).length;
  const score = passedRequired + (hasLowercase && pw.length >= 10 ? 1 : 0);
  const isValid = hasMinLength && hasUppercase && hasNumber && hasSpecial;

  let label = 'Weak (দুর্বল)';
  let color = 'var(--red)';
  if (!pw.length) {
    label = 'Enter password';
    color = 'var(--muted)';
  } else if (isValid && pw.length >= 10) {
    label = 'Very Strong (অত্যন্ত শক্তিশালী)';
    color = 'var(--teal)';
  } else if (isValid) {
    label = 'Strong (শক্তিশালী)';
    color = 'var(--teal)';
  } else if (passedRequired >= 3) {
    label = 'Medium (মাঝারি — সব শর্ত পূরণ করুন)';
    color = 'var(--gold)';
  }

  return {
    hasMinLength,
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasSpecial,
    score: Math.min(score, 5),
    isValid,
    label,
    color,
  };
}

export function generateStrongPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const nums = '23456789';
  const spec = '!@#$%&*?';
  const pick = (str: string) => str[Math.floor(Math.random() * str.length)];
  const raw = [
    pick(upper),
    pick(lower),
    pick(lower),
    pick(nums),
    pick(spec),
    pick(upper),
    pick(lower),
    pick(nums),
    pick(spec),
    pick(lower),
  ];
  return raw.sort(() => Math.random() - 0.5).join('');
}

export function normalizeAccount(raw: any, index = 0): AppCredentialAccount {
  const username = String(raw.username || raw.email || 'admin').trim().toLowerCase();
  const role = (['Admin', 'Manager', 'Accountant', 'Viewer', 'Custom'].includes(raw.role)
    ? raw.role
    : raw.role === 'Owner' ? 'Admin' : 'Manager') as AppCredentialAccount['role'];
  const preset = ROLE_PRESETS[role] || ROLE_PRESETS.Manager;
  const isOwner = raw.isSystemOwner === true || (role === 'Admin' && index === 0);
  return {
    id: raw.id || 'usr_' + username.replace(/[^a-z0-9]/g, '_'),
    username,
    email: String(raw.email || username).trim().toLowerCase(),
    name: String(raw.name || username).trim(),
    role: isOwner ? 'Admin' : (role === 'Admin' ? 'Manager' : role), // Only Master Owner can hold 'Admin' role
    isSystemOwner: isOwner,
    allowedPages: isOwner
      ? ALL_MODULE_PAGES.map(p => p.id)
      : (Array.isArray(raw.allowedPages) && raw.allowedPages.length ? raw.allowedPages : [...preset.allowedPages]),
    canDelete: isOwner ? true : Boolean(raw.canDelete ?? preset.canDelete),
    canExport: isOwner ? true : Boolean(raw.canExport ?? preset.canExport),
    active: isOwner ? true : raw.active !== false,
    passwordHash: String(raw.passwordHash || ''),
    sessionVersion: Number(raw.sessionVersion || 1),
    createdAt: raw.createdAt || new Date().toISOString().slice(0, 10),
    updatedAt: raw.updatedAt || '',
  };
}

/**
 * Authoritative user list resolver:
 * If `fromDBList` has accounts (e.g. from DB / Cloud), it is authoritative so deleted users stay deleted!
 * Only falls back to localStorage if `fromDBList` is empty/undefined.
 */
export function getAppAccounts(fromDBList?: any[]): AppCredentialAccount[] {
  try {
    if (Array.isArray(fromDBList) && fromDBList.length > 0) {
      const normalized = fromDBList.map((a, idx) => normalizeAccount(a, idx));
      localStorage.setItem(CRED_STORAGE_KEY, JSON.stringify(normalized));
      return normalized;
    }
    const raw = localStorage.getItem(CRED_STORAGE_KEY);
    const localList: any[] = raw ? JSON.parse(raw) : [];
    return localList.map((a, idx) => normalizeAccount(a, idx));
  } catch {
    return (fromDBList || []).map((a, idx) => normalizeAccount(a, idx));
  }
}

export function saveAppAccountsToLocal(accounts: AppCredentialAccount[]) {
  const normalized = accounts.map((a, idx) => normalizeAccount(a, idx));
  localStorage.setItem(CRED_STORAGE_KEY, JSON.stringify(normalized));
}

export function getSavedAppSession(): ActiveSession | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSavedAppSession(session: ActiveSession | null) {
  if (!session) {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
  } else {
    localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
  }
}

/**
 * Verifies if an active session is still valid against the authoritative accounts list.
 * Returns null if the user was deleted, deactivated, or had their password changed!
 */
export function verifySessionAgainstAccounts(
  session: ActiveSession | null,
  accounts: AppCredentialAccount[]
): { valid: boolean; reason?: string; updatedSession?: ActiveSession } {
  if (!session) return { valid: false };
  if (!accounts || accounts.length === 0) return { valid: false, reason: 'অ্যাকাউন্ট পাওয়া যায়নি।' };

  const match = accounts.find(
    a => a.id === session.id || a.username.toLowerCase() === session.username.toLowerCase()
  );

  if (!match) {
    return { valid: false, reason: 'অ্যাডমিন আপনার ইউজার অ্যাকাউন্টটি রিমুভ করে দিয়েছেন।' };
  }
  if (!match.active) {
    return { valid: false, reason: 'অ্যাডমিন আপনার অ্যাকাউন্টটি নিষ্ক্রিয় (Deactivated) করে দিয়েছেন।' };
  }
  if (match.passwordHash !== session.passwordHash || match.sessionVersion !== session.sessionVersion) {
    return { valid: false, reason: 'আপনার পাসওয়ার্ড বা অ্যাক্সেস পরিবর্তন করা হয়েছে। অনুগ্রহ করে নতুন পাসওয়ার্ড দিয়ে আবার লগইন করুন।' };
  }

  return {
    valid: true,
    updatedSession: {
      id: match.id,
      username: match.username,
      email: match.email,
      name: match.name,
      role: match.role,
      isSystemOwner: Boolean(match.isSystemOwner),
      allowedPages: match.allowedPages,
      canDelete: match.canDelete,
      canExport: match.canExport,
      passwordHash: match.passwordHash,
      sessionVersion: match.sessionVersion,
    },
  };
}
