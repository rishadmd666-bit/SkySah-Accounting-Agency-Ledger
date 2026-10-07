/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  User
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, updateDoc, onSnapshot } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import { LOGO_DATA_URI } from './logo';
import { BDT, todayStr, escapeHtml, emptyDB, normalizeAndMigrateDB } from './ledgerHelpers';
import {
  DB, setDBState, loadLocalDB, setCloudSaveCallback, goTo, closeModal, confirmAction,
  toast, clientName, closeMobileDrawer, openModal, save, loadSampleToDB, setActiveActor,
  logAuditEvent, isPageAllowedForCurrentUser
} from './ledgerCore';
import {
  sha256Hex,
  getAppAccounts,
  saveAppAccountsToLocal,
  getSavedAppSession,
  setSavedAppSession,
  verifySessionAgainstAccounts,
  evaluatePasswordStrength,
  generateStrongPassword,
  AppCredentialAccount,
  ActiveSession,
  ALL_MODULE_PAGES,
  ROLE_PRESETS
} from './appAuth';
import './ledgerPagesSales';
import './ledgerPagesCatalogMoney';
import { openAuditTrailModal } from './ledgerPagesInsights';

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [localSession, setLocalSession] = useState<ActiveSession | null>(() => getSavedAppSession());
  const [authReady, setAuthReady] = useState(false);
  const [accountsList, setAccountsList] = useState<AppCredentialAccount[]>(() => {
    const localData = loadLocalDB();
    return getAppAccounts(localData.appUsers);
  });

  // Login / Initial Admin Setup inputs
  const [usernameInput, setUsernameInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'saving' | 'local'>('local');

  // Admin User Management Modal State
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [uName, setUName] = useState('');
  const [uUsername, setUUsername] = useState('');
  const [uPass, setUPass] = useState('');
  const [uRole, setURole] = useState<AppCredentialAccount['role']>('Manager');
  const [uAllowedPages, setUAllowedPages] = useState<string[]>(ROLE_PRESETS.Manager.allowedPages);
  const [uCanDelete, setUCanDelete] = useState(false);
  const [uCanExport, setUCanExport] = useState(true);
  const [uActive, setUActive] = useState(true);

  const initializedRef = useRef(false);

  const hasAnyAdminSetup = accountsList.length > 0;
  const isAuthenticated = Boolean(localSession);
  const isAdmin = Boolean(localSession?.isSystemOwner && localSession?.role === 'Admin');
  const activeUsername = localSession?.username || 'admin';
  const activeName = localSession?.name || 'Admin';
  const activeRole = localSession?.role || 'Admin';

  // Sync active actor & permissions with ledgerCore
  useEffect(() => {
    if (localSession) {
      setActiveActor(
        localSession.username,
        localSession.name,
        localSession.role,
        localSession.allowedPages,
        localSession.canDelete,
        Boolean(localSession.isSystemOwner)
      );
    }
  }, [localSession]);

  // Continuous Security Guard: Verify active session against latest accountsList!
  // If Admin deletes user, deactivates user, or changes password -> instant forced logout!
  useEffect(() => {
    if (!localSession) return;
    const currentAccounts = getAppAccounts(DB.appUsers?.length ? DB.appUsers : accountsList);
    if (currentAccounts.length === 0) return;
    const check = verifySessionAgainstAccounts(localSession, currentAccounts);
    if (!check.valid) {
      setSavedAppSession(null);
      setLocalSession(null);
      setAuthError(check.reason || 'আপনার সেশনের মেয়াদ শেষ হয়েছে। অনুগ্রহ করে আবার লগইন করুন।');
      closeModal();
    } else if (check.updatedSession) {
      // Update permissions live if Admin changed this user's role or allowedPages
      const prevPages = JSON.stringify(localSession.allowedPages);
      const nextPages = JSON.stringify(check.updatedSession.allowedPages);
      if (
        prevPages !== nextPages ||
        localSession.role !== check.updatedSession.role ||
        localSession.canDelete !== check.updatedSession.canDelete ||
        localSession.canExport !== check.updatedSession.canExport ||
        localSession.name !== check.updatedSession.name
      ) {
        setSavedAppSession(check.updatedSession);
        setLocalSession(check.updatedSession);
      }
    }
  }, [accountsList, localSession]);

  // Listen across tabs (storage event) so if Admin removes user or changes password in another tab, instant kick!
  useEffect(() => {
    const onStorageChange = () => {
      const localData = loadLocalDB();
      const updatedAccs = getAppAccounts(localData.appUsers);
      setAccountsList(updatedAccs);
    };
    window.addEventListener('storage', onStorageChange);
    return () => window.removeEventListener('storage', onStorageChange);
  }, []);

  // Listen to Firebase Auth state for real-time Cloud Database Sync
  useEffect(() => {
    let unsubDoc: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      setFirebaseUser(u);
      if (unsubDoc) {
        unsubDoc();
        unsubDoc = null;
      }
      if (u) {
        const docRef = doc(db, 'ledgers', u.uid);
        try {
          const snap = await getDoc(docRef);
          if (snap.exists()) {
            const data = snap.data();
            if (data && typeof data.payload === 'string') {
              const parsed = JSON.parse(data.payload);
              setDBState(parsed, false);
              if (Array.isArray(parsed.appUsers) && parsed.appUsers.length > 0) {
                const norm = getAppAccounts(parsed.appUsers);
                saveAppAccountsToLocal(norm);
                setAccountsList(norm);
              }
              setSyncStatus('synced');
            }
          } else {
            const localData = loadLocalDB();
            localData.appUsers = getAppAccounts(localData.appUsers);
            setDBState(localData, false);
            setAccountsList(localData.appUsers);
            if (u.emailVerified) {
              const payloadStr = JSON.stringify(localData).slice(0, 940000);
              await setDoc(docRef, {
                ownerId: u.uid,
                ownerEmail: (u.email || 'admin@skysah.com').slice(0, 250),
                payload: payloadStr,
                version: 1,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
              setSyncStatus('synced');
            }
          }

          // Real-time listener on Cloud Document so password/role changes or ledger edits sync live!
          unsubDoc = onSnapshot(docRef, (liveSnap) => {
            if (!liveSnap.exists()) return;
            const d = liveSnap.data();
            if (d && typeof d.payload === 'string') {
              try {
                const incoming = JSON.parse(d.payload);
                if (Array.isArray(incoming.appUsers)) {
                  const norm = getAppAccounts(incoming.appUsers);
                  saveAppAccountsToLocal(norm);
                  setAccountsList(norm);
                }
                setDBState(incoming, false);
                setSyncStatus('synced');
              } catch (e) {
                console.error(e);
              }
            }
          }, (err) => {
            handleFirestoreError(err, OperationType.GET, `ledgers/${u.uid}`);
          });
        } catch (err) {
          console.error('Cloud load fallback to local:', err);
          const localData = loadLocalDB();
          setDBState(localData, false);
          setAccountsList(getAppAccounts(localData.appUsers));
          setSyncStatus('local');
        }
      } else {
        const localData = loadLocalDB();
        setDBState(localData, false);
        setAccountsList(getAppAccounts(localData.appUsers));
        setSyncStatus('local');
      }
      setAuthReady(true);
    });
    return () => {
      unsubAuth();
      if (unsubDoc) unsubDoc();
    };
  }, []);

  // Wire cloud auto-save whenever `save()` is called inside the ledger engine
  useEffect(() => {
    setCloudSaveCallback(async (currentDB) => {
      if (Array.isArray(currentDB.appUsers)) {
        setAccountsList(getAppAccounts(currentDB.appUsers));
      }
      if (!firebaseUser || !firebaseUser.emailVerified) {
        setSyncStatus('local');
        return;
      }
      setSyncStatus('saving');
      const docPath = `ledgers/${firebaseUser.uid}`;
      const docRef = doc(db, 'ledgers', firebaseUser.uid);
      const payloadStr = JSON.stringify(currentDB).slice(0, 940000);
      const safeEmail = (firebaseUser.email || 'admin@skysah.com').slice(0, 250);
      try {
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          await updateDoc(docRef, {
            payload: payloadStr,
            version: 1,
            ownerEmail: safeEmail,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(docRef, {
            ownerId: firebaseUser.uid,
            ownerEmail: safeEmail,
            payload: payloadStr,
            version: 1,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        setSyncStatus('synced');
      } catch (err) {
        setSyncStatus('local');
        handleFirestoreError(err, OperationType.WRITE, docPath);
      }
    });
  }, [firebaseUser]);

  // Bootstrap the DOM shell once authenticated
  useEffect(() => {
    if (!isAuthenticated || !localSession) {
      initializedRef.current = false;
      return;
    }
    if (!initializedRef.current) {
      initializedRef.current = true;
      const localData = loadLocalDB();
      if (!DB.clients.length && !DB.invoices.length && (localData.clients.length || localData.invoices.length)) {
        setDBState(localData, false);
      }
      const startPage = localSession.allowedPages.includes('dashboard')
        ? 'dashboard'
        : (localSession.allowedPages[0] || 'dashboard');
      setTimeout(() => {
        goTo(startPage);
      }, 30);
    }
  }, [isAuthenticated, localSession]);

  // Username & Password Login or First-Time Admin Setup
  const handleUsernamePasswordAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const cleanUsername = usernameInput.trim().toLowerCase();
    if (!cleanUsername || !password) {
      setAuthError('Username এবং Password দিন।');
      return;
    }
    if (password.length < 4) {
      setAuthError('Password কমপক্ষে ৪ অক্ষরের হতে হবে।');
      return;
    }
    setBusy(true);
    try {
      const localData = loadLocalDB();
      const currentAccounts = getAppAccounts(localData.appUsers);
      const passHash = await sha256Hex(password);

      // Case 1: Very first time setup -> Create Master Admin Account
      if (currentAccounts.length === 0) {
        const adminAcc: AppCredentialAccount = {
          id: 'usr_admin_' + Date.now().toString(36),
          username: cleanUsername,
          email: cleanUsername,
          name: nameInput.trim() || 'Super Admin',
          role: 'Admin',
          isSystemOwner: true,
          allowedPages: ALL_MODULE_PAGES.map(p => p.id),
          canDelete: true,
          canExport: true,
          active: true,
          passwordHash: passHash,
          sessionVersion: 1,
          createdAt: todayStr(),
        };
        const updated = [adminAcc];
        saveAppAccountsToLocal(updated);
        localData.appUsers = updated;
        DB.appUsers = updated;
        setAccountsList(updated);
        setDBState(localData, true);

        const sess: ActiveSession = {
          id: adminAcc.id,
          username: adminAcc.username,
          email: adminAcc.email,
          name: adminAcc.name,
          role: adminAcc.role,
          isSystemOwner: true,
          allowedPages: adminAcc.allowedPages,
          canDelete: adminAcc.canDelete,
          canExport: adminAcc.canExport,
          passwordHash: adminAcc.passwordHash,
          sessionVersion: adminAcc.sessionVersion,
        };
        setSavedAppSession(sess);
        setLocalSession(sess);
        logAuditEvent('Created', 'Security', `Master Admin account (${adminAcc.username}) initialized`);
        save();
        setBusy(false);
        return;
      }

      // Case 2: Standard Login — strictly verify against Admin-created user accounts!
      const match = currentAccounts.find(
        a => a.username.toLowerCase() === cleanUsername || a.email.toLowerCase() === cleanUsername
      );
      if (!match) {
        setAuthError('ভুল Username অথবা এই নামে কোনো ইউজার নেই। শুধুমাত্র Master Admin নতুন ইউজার তৈরি করতে পারবেন।');
        setBusy(false);
        return;
      }
      if (!match.active) {
        setAuthError('আপনার অ্যাকাউন্টটি বর্তমানে ব্লক বা নিষ্ক্রিয় (Disabled) করা আছে। অ্যাডমিনের সাথে যোগাযোগ করুন।');
        setBusy(false);
        return;
      }
      if (match.passwordHash !== passHash) {
        setAuthError('ভুল Password দেওয়া হয়েছে। আবার চেষ্টা করুন।');
        setBusy(false);
        return;
      }

      const sess: ActiveSession = {
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
      };
      setSavedAppSession(sess);
      setLocalSession(sess);
      setActiveActor(sess.username, sess.name, sess.role, sess.allowedPages, sess.canDelete, sess.isSystemOwner);
      logAuditEvent('Login', 'Security', `${sess.name} (@${sess.username}) logged in as ${sess.role}`);
      save();
    } catch (err: any) {
      setAuthError(err?.message || 'Login error.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = () => {
    if (localSession) {
      logAuditEvent('Logout', 'Security', `${localSession.name} (@${localSession.username}) signed out`);
      save();
    }
    setSavedAppSession(null);
    setLocalSession(null);
    setPassword('');
    setAuthError('');
  };

  const handleConnectCloudSync = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      toast('Cloud Database Sync connected!');
    } catch (err: any) {
      toast(err?.message || 'Could not connect Google Cloud Sync', true);
    }
  };

  // Admin User Management Helpers
  const resetUserForm = () => {
    setEditingUserId(null);
    setUName('');
    setUUsername('');
    setUPass('');
    setURole('Manager');
    setUAllowedPages([...ROLE_PRESETS.Manager.allowedPages]);
    setUCanDelete(ROLE_PRESETS.Manager.canDelete);
    setUCanExport(ROLE_PRESETS.Manager.canExport);
    setUActive(true);
  };

  const handleOpenUserModal = () => {
    if (!isAdmin) {
      toast('শুধুমাত্র Admin ইউজার ও পাসওয়ার্ড পরিচালনা করতে পারবেন', true);
      return;
    }
    resetUserForm();
    setShowUserModal(true);
  };

  const handleRoleChange = (newRole: AppCredentialAccount['role']) => {
    setURole(newRole);
    const preset = ROLE_PRESETS[newRole];
    if (preset && newRole !== 'Custom') {
      setUAllowedPages([...preset.allowedPages]);
      setUCanDelete(preset.canDelete);
      setUCanExport(preset.canExport);
    }
  };

  const handleTogglePagePermission = (pageId: string) => {
    if (uRole === 'Admin') return; // Admin always has all pages
    setUAllowedPages(prev => {
      const exists = prev.includes(pageId);
      const next = exists ? prev.filter(p => p !== pageId) : [...prev, pageId];
      return next.length ? next : ['dashboard'];
    });
  };

  const handleEditUserClick = (acc: AppCredentialAccount) => {
    setEditingUserId(acc.id);
    setUName(acc.name);
    setUUsername(acc.username);
    setUPass(''); // Leave blank unless changing password
    setURole(acc.role);
    setUAllowedPages([...acc.allowedPages]);
    setUCanDelete(acc.canDelete);
    setUCanExport(acc.canExport);
    setUActive(acc.active);
  };

  const handleSaveUserAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      toast('অ্যাক্সেস ডিনাইড: শুধুমাত্র Master Admin ইউজার ও পাসওয়ার্ড পরিবর্তন করতে পারবেন!', true);
      return;
    }
    const cleanU = uUsername.trim().toLowerCase();
    if (!cleanU) {
      toast('Username লিখুন', true);
      return;
    }
    const currentList = getAppAccounts(DB.appUsers);
    const duplicate = currentList.find(a => a.username.toLowerCase() === cleanU && a.id !== editingUserId);
    if (duplicate) {
      toast(`"${cleanU}" নামে ইতিমধ্যে একজন ইউজার আছে`, true);
      return;
    }

    const pwStrength = evaluatePasswordStrength(uPass);
    if (!editingUserId && !pwStrength.isValid) {
      toast('শক্তিশালী পাসওয়ার্ড দিন: কমপক্ষে ৮ অক্ষর, ১টি বড় হাতের অক্ষর (A-Z), ১টি সংখ্যা (0-9) এবং ১টি স্পেশাল ক্যারেক্টার (!@#$%) থাকতে হবে', true);
      return;
    }
    if (editingUserId && uPass.length > 0 && !pwStrength.isValid) {
      toast('নতুন পাসওয়ার্ডে কমপক্ষে ৮ অক্ষর, ১টি বড় হাতের অক্ষর (A-Z), ১টি সংখ্যা (0-9) এবং ১টি স্পেশাল ক্যারেক্টার (!@#$%) থাকতে হবে', true);
      return;
    }

    const existingTarget = currentList.find(a => a.id === editingUserId);
    const isEditingMasterOwner = Boolean(existingTarget?.isSystemOwner);

    // Non-owner staff can NEVER be assigned 'Admin' role so they can never access User/Password settings
    const assignedRole: AppCredentialAccount['role'] = isEditingMasterOwner
      ? 'Admin'
      : (uRole === 'Admin' ? 'Manager' : uRole);

    let passHash = existingTarget?.passwordHash || '';
    let nextSessionVersion = existingTarget?.sessionVersion || 1;
    if (uPass.length > 0 && pwStrength.isValid) {
      passHash = await sha256Hex(uPass);
      nextSessionVersion += 1; // Forces immediate logout on any device using the old password!
    } else if (existingTarget && existingTarget.active !== uActive) {
      nextSessionVersion += 1;
    }

    const finalPages = isEditingMasterOwner ? ALL_MODULE_PAGES.map(p => p.id) : uAllowedPages;
    const finalCanDelete = isEditingMasterOwner ? true : uCanDelete;
    const finalCanExport = isEditingMasterOwner ? true : uCanExport;

    const savedAcc: AppCredentialAccount = {
      id: editingUserId || ('usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
      username: cleanU,
      email: cleanU,
      name: uName.trim() || cleanU,
      role: assignedRole,
      isSystemOwner: isEditingMasterOwner,
      allowedPages: finalPages,
      canDelete: finalCanDelete,
      canExport: finalCanExport,
      active: isEditingMasterOwner ? true : uActive,
      passwordHash: passHash,
      sessionVersion: nextSessionVersion,
      createdAt: existingTarget?.createdAt || todayStr(),
      updatedAt: todayStr(),
    };

    const nextList = editingUserId
      ? currentList.map(a => a.id === editingUserId ? savedAcc : a)
      : [...currentList, savedAcc];

    saveAppAccountsToLocal(nextList);
    DB.appUsers = nextList;
    setAccountsList(nextList);

    // If Admin just updated their own password/profile, keep their own session alive with the new hash/version
    if (localSession && savedAcc.id === localSession.id) {
      const updatedSelf: ActiveSession = {
        id: savedAcc.id,
        username: savedAcc.username,
        email: savedAcc.email,
        name: savedAcc.name,
        role: savedAcc.role,
        isSystemOwner: true,
        allowedPages: savedAcc.allowedPages,
        canDelete: savedAcc.canDelete,
        canExport: savedAcc.canExport,
        passwordHash: savedAcc.passwordHash,
        sessionVersion: savedAcc.sessionVersion,
      };
      setSavedAppSession(updatedSelf);
      setLocalSession(updatedSelf);
    }

    logAuditEvent(
      editingUserId ? 'Updated' : 'Created',
      'Security',
      `User @${savedAcc.username} (${savedAcc.role}) ${editingUserId ? 'permissions/password updated' : 'created'} by Master Admin`
    );
    save();
    toast(editingUserId ? `User @${savedAcc.username} updated!` : `User @${savedAcc.username} created!`);
    resetUserForm();
  };

  const handleToggleUserActive = (acc: AppCredentialAccount) => {
    const currentList = getAppAccounts(DB.appUsers);
    const activeAdmins = currentList.filter(a => a.role === 'Admin' && a.active && a.id !== acc.id);
    if (acc.role === 'Admin' && acc.active && activeAdmins.length === 0) {
      toast('সর্বশেষ Admin অ্যাকাউন্টটি ব্লক করা যাবে না!', true);
      return;
    }
    const nextList = currentList.map(a =>
      a.id === acc.id
        ? { ...a, active: !a.active, sessionVersion: (a.sessionVersion || 1) + 1, updatedAt: todayStr() }
        : a
    );
    saveAppAccountsToLocal(nextList);
    DB.appUsers = nextList;
    setAccountsList(nextList);
    logAuditEvent(
      acc.active ? 'Blocked' : 'Activated',
      'Security',
      `User @${acc.username} ${acc.active ? 'blocked/suspended' : 're-activated'} by Admin`
    );
    save();
    toast(acc.active ? `@${acc.username} এখন ব্লক করা হয়েছে (লগইন করতে পারবে না)` : `@${acc.username} সক্রিয় করা হয়েছে`);
  };

  const handleDeleteUser = (acc: AppCredentialAccount) => {
    const currentList = getAppAccounts(DB.appUsers);
    const activeAdmins = currentList.filter(a => a.role === 'Admin' && a.active && a.id !== acc.id);
    if (acc.role === 'Admin' && activeAdmins.length === 0) {
      toast('সর্বশেষ Admin অ্যাকাউন্টটি ডিলিট করা যাবে না!', true);
      return;
    }
    if (localSession && acc.id === localSession.id) {
      toast('আপনি নিজের লগইন করা Admin অ্যাকাউন্ট নিজে ডিলিট করতে পারবেন না', true);
      return;
    }
    const nextList = currentList.filter(a => a.id !== acc.id);
    saveAppAccountsToLocal(nextList);
    DB.appUsers = nextList;
    setAccountsList(nextList);
    if (editingUserId === acc.id) resetUserForm();
    logAuditEvent('Deleted', 'Security', `User @${acc.username} (${acc.role}) permanently removed by Admin`);
    save();
    toast(`User @${acc.username} রিমুভ করা হয়েছে — সে আর সফটওয়্যারে ঢুকতে পারবে না`);
  };

  const handleGlobalSearch = (qRaw: string) => {
    const searchResultsEl = document.getElementById('searchResults');
    if (!searchResultsEl) return;
    const q = qRaw.trim().toLowerCase();
    if (!q) { searchResultsEl.classList.remove('show'); return; }
    const results: any[] = [];
    if (isPageAllowedForCurrentUser('clients')) {
      DB.clients.forEach((c: any) => {
        if ((c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q))
          results.push({ type: 'Client', label: c.name, sub: c.phone || c.email || '', go: () => goTo('clients', { view: c.id }) });
      });
    }
    if (isPageAllowedForCurrentUser('invoices')) {
      DB.invoices.forEach((i: any) => {
        if ((i.number || '').toLowerCase().includes(q) || clientName(i.clientId).toLowerCase().includes(q))
          results.push({ type: 'Invoice', label: i.number, sub: clientName(i.clientId), go: () => goTo('invoices', { view: i.id }) });
      });
    }
    if (isPageAllowedForCurrentUser('payments')) {
      DB.payments.forEach((p: any) => {
        if ((p.txnId || '').toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
          results.push({ type: 'Payment', label: p.txnId || p.id, sub: clientName(p.clientId) + ' — ' + BDT(p.amount), go: () => goTo('payments') });
      });
    }
    if (isPageAllowedForCurrentUser('services')) {
      DB.services.forEach((s: any) => {
        if ((s.name || '').toLowerCase().includes(q))
          results.push({ type: 'Service', label: s.name, sub: BDT(s.price), go: () => goTo('services') });
      });
    }
    if (!results.length) {
      searchResultsEl.innerHTML = `<div class="sr-item muted">কোনো ফলাফল পাওয়া যায়নি</div>`;
      searchResultsEl.classList.add('show');
      return;
    }
    searchResultsEl.innerHTML = results.slice(0, 15).map((r, idx) => `<div class="sr-item" data-idx="${idx}"><b>${escapeHtml(r.label)}</b> <span class="pill" style="margin-left:6px;">${r.type}</span><small>${escapeHtml(r.sub)}</small></div>`).join('');
    searchResultsEl.querySelectorAll('.sr-item[data-idx]').forEach((el: any) => {
      el.addEventListener('click', () => {
        results[Number(el.dataset.idx)].go();
        searchResultsEl.classList.remove('show');
        const inp = document.getElementById('globalSearch') as HTMLInputElement;
        if (inp) inp.value = '';
      });
    });
    searchResultsEl.classList.add('show');
  };

  const handleBackupDownload = () => {
    if (!isAdmin && !localSession?.canExport) {
      toast('আপনার ব্যাকআপ ডাউনলোড করার পারমিশন নেই', true);
      return;
    }
    const payload = { app: 'SkySah Accounting', exportedAt: new Date().toISOString(), version: 1, data: DB };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skysah-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Full backup downloaded');
  };

  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isAdmin) {
      toast('শুধুমাত্র Admin ব্যাকআপ Restore করতে পারবেন', true);
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const incoming = parsed && parsed.data ? parsed.data : parsed;
        if (!incoming || !Array.isArray(incoming.clients) || !Array.isArray(incoming.invoices)) {
          toast('এটি একটি সঠিক SkySah Accounting backup ফাইল বলে মনে হচ্ছে না', true);
          return;
        }
        confirmAction('এই backup import করলে বর্তমান সব ডাটা replace হয়ে যাবে। এগিয়ে যাবেন?', () => {
          const preservedUsers = getAppAccounts(DB.appUsers);
          const migrated = normalizeAndMigrateDB(incoming);
          if (!Array.isArray(migrated.appUsers) || migrated.appUsers.length === 0) {
            migrated.appUsers = preservedUsers;
          } else {
            saveAppAccountsToLocal(getAppAccounts(migrated.appUsers));
            setAccountsList(getAppAccounts(migrated.appUsers));
          }
          setDBState(migrated, true);
          toast('Backup restored & migrated successfully');
          goTo('dashboard');
        });
      } catch {
        toast('ফাইলটি পড়া যায়নি — সঠিক .json backup ফাইল দিন', true);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  if (!authReady) {
    return (
      <div className="auth-screen">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <img src={LOGO_DATA_URI} alt="SkySah" style={{ width: 56, height: 56, margin: '0 auto 12px', borderRadius: '50%' }} />
          <h2>SkySah Accounting</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>Loading secure workspace…</p>
        </div>
      </div>
    );
  }

  // Clean Username & Password Login Screen (No public registration — Admin only!)
  if (!isAuthenticated) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--line)' }}>
            <img src={LOGO_DATA_URI} alt="SkySah" style={{ width: 50, height: 50, borderRadius: '50%', objectFit: 'contain' }} />
            <div>
              <h2 style={{ fontSize: 21, color: 'var(--ink)' }}>SkySah Accounting</h2>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px' }}>
                {hasAnyAdminSetup ? 'Authorized Staff & Admin Login' : 'First-Time Master Admin Setup'}
              </div>
            </div>
          </div>

          {!hasAnyAdminSetup ? (
            <div style={{ padding: '10px 12px', background: 'var(--amber-bg)', borderLeft: '3px solid var(--gold)', fontSize: 12.5, marginBottom: 14, lineHeight: 1.55 }}>
              <b>স্বাগতম (Admin Setup):</b> আপনার সফটওয়্যারের প্রথম <b>Master Admin</b> ইউজারনেম ও পাসওয়ার্ড সেট করুন। এরপর আপনি ভেতর থেকে আপনার টিমের জন্য আলাদা ইউজার, রোল ও পাসওয়ার্ড তৈরি করতে পারবেন।
            </div>
          ) : (
            <div style={{ padding: '9px 12px', background: '#F7F4EC', borderLeft: '3px solid var(--navy-3)', fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
              <i className="fa-solid fa-lock" style={{ color: 'var(--gold-deep)', marginRight: 6 }}></i>
              সংরক্ষিত সিস্টেম — শুধুমাত্র <b>Admin</b> কর্তৃক অনুমোদিত Username ও Password দিয়ে লগইন করুন।
            </div>
          )}

          <form onSubmit={handleUsernamePasswordAuth} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {!hasAnyAdminSetup && (
              <div className="field">
                <label>Admin Full Name *</label>
                <input
                  type="text"
                  placeholder="আপনার নাম (যেমন: MD Rishad)"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="field">
              <label>Username / User ID *</label>
              <input
                type="text"
                placeholder={hasAnyAdminSetup ? 'আপনার Username লিখুন (যেমন: admin)' : 'Admin Username দিন (যেমন: admin)'}
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div className="field">
              <label>Password *</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder="আপনার গোপন পাসওয়ার্ড দিন"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  style={{ paddingRight: 38 }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
                  title={showPass ? 'Hide password' : 'Show password'}
                >
                  <i className={`fa-solid ${showPass ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
            </div>

            {authError && (
              <div style={{ background: 'var(--red-bg)', color: 'var(--red)', padding: '10px 12px', borderRadius: 3, fontSize: 12.5, lineHeight: 1.5, borderLeft: '3px solid var(--red)' }}>
                <i className="fa-solid fa-circle-exclamation" style={{ marginRight: 6 }}></i>
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="btn btn-gold"
              style={{ width: '100%', justifyContent: 'center', padding: '11px 16px', fontSize: 14, marginTop: 4 }}
            >
              <i className="fa-solid fa-shield-halved"></i>
              <span>{hasAnyAdminSetup ? 'Sign In to SkySah Ledger' : 'Create Admin Account & Enter'}</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="app" onClick={(e) => {
        if (!(e.target as HTMLElement).closest('.search-wrap')) {
          document.getElementById('searchResults')?.classList.remove('show');
        }
      }}>
        <div className="sidebar-backdrop" id="sidebarBackdrop" onClick={closeMobileDrawer}></div>
        <aside className="sidebar" id="sidebar"></aside>
        <div className="main">
          <div className="topbar">
            <button
              className="hamburger-btn"
              id="hamburgerBtn"
              title="Menu"
              onClick={() => {
                document.getElementById('sidebar')?.classList.toggle('open');
                document.getElementById('sidebarBackdrop')?.classList.toggle('show');
              }}
            >
              <i className="fa-solid fa-bars"></i>
            </button>
            <h1 id="pageTitle">Dashboard</h1>
            <div className="search-wrap">
              <i className="fa-solid fa-magnifying-glass"></i>
              <input
                className="global-search"
                id="globalSearch"
                placeholder="Client, invoice, phone, transaction ID খুঁজুন…"
                autoComplete="off"
                onChange={(e) => handleGlobalSearch(e.target.value)}
              />
              <div className="search-results" id="searchResults"></div>
            </div>
            <div className="topbar-actions">
              <span className="pill" title={`Username: @${activeUsername} | Role: ${activeRole}`} style={{ fontSize: 11.5 }}>
                <i className={`fa-solid ${isAdmin ? 'fa-user-shield' : 'fa-user-check'}`} style={{ color: isAdmin ? 'var(--gold-deep)' : 'var(--teal)' }}></i>
                <span><b>{activeName}</b> <span className="muted">({activeRole})</span></span>
              </span>

              {isPageAllowedForCurrentUser('audit-log') && (
                <button className="btn btn-ghost btn-sm" onClick={openAuditTrailModal} title="View Audit Trail & Recent Activity Log">
                  <i className="fa-solid fa-clipboard-check"></i> Audit Log
                </button>
              )}

              {isAdmin && (
                <button
                  className="btn btn-gold btn-sm"
                  onClick={handleOpenUserModal}
                  title="Create Users, Set Role Permissions, Change Passwords or Block Access"
                >
                  <i className="fa-solid fa-users-gear"></i> Users & Roles ({accountsList.length})
                </button>
              )}

              {(isAdmin || localSession?.canExport) && (
                <button className="btn btn-ghost btn-sm" onClick={handleBackupDownload} title="Download full backup (JSON)">
                  <i className="fa-solid fa-cloud-arrow-down"></i> Backup
                </button>
              )}

              {isAdmin && (
                <>
                  <label className="btn btn-ghost btn-sm" title="Restore from backup file" style={{ cursor: 'pointer', margin: 0 }}>
                    <i className="fa-solid fa-cloud-arrow-up"></i> Restore
                    <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleRestoreFile} />
                  </label>
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Load sample data"
                    onClick={() => {
                      confirmAction('Sample data লোড করবেন? এতে বর্তমান সব ডাটা মুছে যাবে (ইউজার ও পাসওয়ার্ড অক্ষত থাকবে)।', () => {
                        loadSampleToDB();
                        logAuditEvent('Loaded', 'System', 'Sample agency dataset initialized');
                        save();
                        toast('Sample data loaded');
                        goTo('dashboard');
                      });
                    }}
                  >
                    <i className="fa-solid fa-flask"></i> Sample
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Clear all data"
                    onClick={() => {
                      confirmAction('সব ডাটা মুছে ফেলবেন? (আপনার ইউজার ও পাসওয়ার্ড লিস্ট অক্ষত থাকবে)।', () => {
                        const preservedUsers = getAppAccounts(DB.appUsers);
                        const fresh = emptyDB();
                        fresh.appUsers = preservedUsers;
                        setDBState(fresh, true);
                        logAuditEvent('Cleared', 'System', 'All ledger data cleared by Admin');
                        save();
                        toast('All ledger data cleared');
                        goTo('dashboard');
                      });
                    }}
                  >
                    <i className="fa-solid fa-trash"></i> Clear
                  </button>
                </>
              )}

              <button
                className="btn btn-sm"
                title="Sign Out"
                onClick={handleSignOut}
                style={{ borderColor: 'var(--line)' }}
              >
                <i className="fa-solid fa-right-from-bracket"></i> Sign Out
              </button>
            </div>
          </div>
          <div className="content" id="content"></div>
          <footer className="app-foot">
            SkySah Accounting — Logged in as <b>{activeName} (@{activeUsername})</b> · Role: <b>{activeRole}</b> · {syncStatus === 'synced' ? 'Cloud Database Synced' : 'Local Encrypted Storage'}.
          </footer>
        </div>
      </div>

      {/* ADMIN USER, ROLE & ACCESS CONTROL MODAL */}
      {showUserModal && isAdmin && (
        <div
          className="modal-overlay show"
          onClick={(e) => {
            if ((e.target as HTMLElement).classList.contains('modal-overlay')) setShowUserModal(false);
          }}
        >
          <div className="modal wide" style={{ maxWidth: 920 }}>
            <div className="modal-head">
              <h3><i className="fa-solid fa-user-shield" style={{ color: 'var(--gold)', marginRight: 8 }}></i>Admin User, Password & Role Access Control</h3>
              <button className="icon-btn" onClick={() => setShowUserModal(false)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--teal-bg)', borderLeft: '3px solid var(--teal)', fontSize: 12.5, marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <b>কেন্দ্রীয় সিকিউরিটি কন্ট্রোল:</b> এখান থেকে ইউজার তৈরি, রোল অনুযায়ী নির্দিষ্ট পেজের পারমিশন দেওয়া, পাসওয়ার্ড পরিবর্তন বা ইউজার ডিলিট/ব্লক করলে <b>সাথে সাথে (Real-time)</b> তা কার্যকর হবে।
                </div>
                {!firebaseUser ? (
                  <button type="button" className="btn btn-sm btn-primary" onClick={handleConnectCloudSync}>
                    <i className="fa-solid fa-cloud"></i> Enable Multi-Device Cloud Sync
                  </button>
                ) : (
                  <span className="badge badge-paid"><i className="fa-solid fa-cloud-check"></i> Cloud Sync Active ({firebaseUser.email})</span>
                )}
              </div>

              {/* Create / Edit User Form */}
              <form onSubmit={handleSaveUserAccount} className="panel" style={{ padding: 16, background: '#FBF9F3', marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h4 style={{ margin: 0, fontSize: 14.5, color: 'var(--navy)' }}>
                    {editingUserId ? `✏️ ইউজার এডিট / পাসওয়ার্ড পরিবর্তন করুন (@${uUsername})` : '➕ নতুন ইউজার ও পাসওয়ার্ড তৈরি করুন'}
                  </h4>
                  {editingUserId && (
                    <button type="button" className="btn btn-sm" onClick={resetUserForm}>
                      + Create New Instead
                    </button>
                  )}
                </div>

                <div className="form-grid cols-3">
                  <div className="field">
                    <label>Full Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. Rafiul Islam"
                      value={uName}
                      onChange={(e) => setUName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Login Username / ID *</label>
                    <input
                      type="text"
                      placeholder="e.g. rafiul বা manager1"
                      value={uUsername}
                      onChange={(e) => setUUsername(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label>{editingUserId ? 'New Password (ফাঁকা রাখলে আগেরটাই থাকবে)' : 'Strong Password *'}</label>
                      <button
                        type="button"
                        onClick={() => setUPass(generateStrongPassword())}
                        style={{ background: 'none', border: 'none', color: 'var(--gold-deep)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}
                        title="Generate a strong secure password automatically"
                      >
                        <i className="fa-solid fa-wand-magic-sparkles"></i> Auto-Generate
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder={editingUserId ? 'নতুন পাসওয়ার্ড দিলে আগের সেশন লগআউট হবে' : 'যেমন: SkySah#2026'}
                      value={uPass}
                      onChange={(e) => setUPass(e.target.value)}
                      required={!editingUserId}
                    />
                    {(() => {
                      const st = evaluatePasswordStrength(uPass);
                      if (editingUserId && !uPass) {
                        return <div className="hint" style={{ marginTop: 4 }}>পাসওয়ার্ড পরিবর্তন করতে চাইলে নতুন শক্তিশালী পাসওয়ার্ড লিখুন।</div>;
                      }
                      const reqItem = (ok: boolean, text: string) => (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: ok ? 'var(--teal)' : 'var(--muted)', fontWeight: ok ? 600 : 400 }}>
                          <i className={`fa-solid ${ok ? 'fa-circle-check' : 'fa-circle-dot'}`} style={{ fontSize: 10 }}></i>
                          {text}
                        </span>
                      );
                      const pct = !uPass.length ? 0 : Math.max(15, Math.round((st.score / 5) * 100));
                      return (
                        <div style={{ marginTop: 6, background: '#fff', border: '1px solid var(--line)', borderRadius: 3, padding: '7px 9px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, marginBottom: 4 }}>
                            <span className="muted">Password Strength:</span>
                            <b style={{ color: st.color }}>{st.label}</b>
                          </div>
                          <div style={{ height: 5, background: '#EFECE4', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: st.color, transition: 'width .25s ease, background .25s ease' }} />
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 8px' }}>
                            {reqItem(st.hasMinLength, '8+ Characters')}
                            {reqItem(st.hasUppercase, 'Uppercase (A-Z)')}
                            {reqItem(st.hasNumber, 'Number (0-9)')}
                            {reqItem(st.hasSpecial, 'Special (!@#$%)')}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="form-grid cols-3" style={{ marginTop: 12 }}>
                  <div className="field">
                    <label>User Role (রোল নির্বাচন করুন)</label>
                    <select
                      value={uRole}
                      disabled={Boolean(editingUserId && accountsList.find(x => x.id === editingUserId)?.isSystemOwner)}
                      onChange={(e) => handleRoleChange(e.target.value as AppCredentialAccount['role'])}
                    >
                      {editingUserId && accountsList.find(x => x.id === editingUserId)?.isSystemOwner ? (
                        <option value="Admin">Master Admin (শুধুমাত্র আপনি)</option>
                      ) : (
                        <>
                          <option value="Manager">Manager (Sales, Clients & Ads)</option>
                          <option value="Accountant">Accountant (Accounts & Reports)</option>
                          <option value="Viewer">Viewer (Read-Only Summary)</option>
                          <option value="Custom">Custom Role (নিজে পেজ সিলেক্ট করুন)</option>
                        </>
                      )}
                    </select>
                  </div>
                  <div className="field">
                    <label>Delete & Export Permissions</label>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'center', height: 36 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer', color: 'var(--ink)' }}>
                        <input
                          type="checkbox"
                          checked={uRole === 'Admin' ? true : uCanDelete}
                          disabled={uRole === 'Admin'}
                          onChange={(e) => setUCanDelete(e.target.checked)}
                        />
                        Can Delete Records
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer', color: 'var(--ink)' }}>
                        <input
                          type="checkbox"
                          checked={uRole === 'Admin' ? true : uCanExport}
                          disabled={uRole === 'Admin'}
                          onChange={(e) => setUCanExport(e.target.checked)}
                        />
                        Can Backup/Export
                      </label>
                    </div>
                  </div>
                  <div className="field">
                    <label>Account Status</label>
                    <select value={uActive ? 'active' : 'blocked'} onChange={(e) => setUActive(e.target.value === 'active')}>
                      <option value="active">✅ Active (লগইন করতে পারবে)</option>
                      <option value="blocked">🚫 Blocked / Suspended (লগইন বন্ধ)</option>
                    </select>
                  </div>
                </div>

                <div className="hint" style={{ marginTop: 6, marginBottom: 10, color: 'var(--gold-deep)' }}>
                  <i className="fa-solid fa-circle-info"></i> {ROLE_PRESETS[uRole]?.desc}
                </div>

                {/* Module-by-Module Checkboxes */}
                <div style={{ border: '1px solid var(--line)', background: '#fff', padding: 12, borderRadius: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)' }}>
                      এই ইউজার কোন কোন মডিউল/পেজে ঢুকতে পারবে টিক (✓) দিন ({uRole === 'Admin' ? ALL_MODULE_PAGES.length : uAllowedPages.length} / {ALL_MODULE_PAGES.length} selected):
                    </label>
                    {uRole !== 'Admin' && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => { setURole('Custom'); setUAllowedPages(ALL_MODULE_PAGES.map(p => p.id)); }}
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => { setURole('Custom'); setUAllowedPages(['dashboard']); }}
                        >
                          Dashboard Only
                        </button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(195px, 1fr))', gap: '6px 12px' }}>
                    {ALL_MODULE_PAGES.map(p => {
                      const checked = uRole === 'Admin' || uAllowedPages.includes(p.id);
                      return (
                        <label
                          key={p.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 7,
                            fontSize: 12.5,
                            padding: '4px 6px',
                            borderRadius: 3,
                            background: checked ? '#F7F4EC' : 'transparent',
                            cursor: uRole === 'Admin' ? 'default' : 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={uRole === 'Admin'}
                            onChange={() => {
                              if (uRole !== 'Custom') setURole('Custom');
                              handleTogglePagePermission(p.id);
                            }}
                          />
                          <span>{p.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                  {editingUserId && (
                    <button type="button" className="btn" onClick={resetUserForm}>Cancel Edit</button>
                  )}
                  <button type="submit" className="btn btn-gold">
                    <i className="fa-solid fa-floppy-disk"></i>
                    <span>{editingUserId ? 'Save Changes & Update Access' : 'Create User Account'}</span>
                  </button>
                </div>
              </form>

              {/* Existing Users Table */}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Username / ID</th>
                      <th>Role</th>
                      <th>Allowed Modules</th>
                      <th>Delete Perm</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountsList.map(acc => (
                      <tr key={acc.id} style={{ opacity: acc.active ? 1 : 0.6 }}>
                        <td>
                          <b>{acc.name}</b>
                          {localSession?.id === acc.id && <span className="pill" style={{ marginLeft: 6, fontSize: 10 }}>You</span>}
                        </td>
                        <td><code style={{ fontWeight: 700, color: 'var(--navy-3)' }}>{acc.username}</code></td>
                        <td><span className="pill">{acc.role}</span></td>
                        <td style={{ fontSize: 12 }}>
                          {acc.role === 'Admin' || acc.allowedPages.length === ALL_MODULE_PAGES.length
                            ? <span className="badge badge-paid">All {ALL_MODULE_PAGES.length} Modules</span>
                            : <span>{acc.allowedPages.length} modules allowed</span>}
                        </td>
                        <td>{acc.canDelete ? <span style={{ color: 'var(--teal)', fontWeight: 600 }}>Yes</span> : <span className="muted">No</span>}</td>
                        <td>
                          {acc.active
                            ? <span className="badge badge-active">Active</span>
                            : <span className="badge badge-overdue">Blocked</span>}
                        </td>
                        <td className="row-actions">
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => handleEditUserClick(acc)}
                            title="Edit Role, Modules or Change Password"
                          >
                            <i className="fa-solid fa-key"></i> Edit / Password
                          </button>
                          {!acc.isSystemOwner && (
                            <>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => handleToggleUserActive(acc)}
                                title={acc.active ? 'Block user immediately' : 'Unblock user'}
                                style={{ borderColor: acc.active ? 'var(--gold)' : 'var(--teal)' }}
                              >
                                <i className={`fa-solid ${acc.active ? 'fa-ban' : 'fa-check'}`}></i> {acc.active ? 'Block' : 'Unblock'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-danger"
                                onClick={() => handleDeleteUser(acc)}
                                title="Permanently remove user"
                              >
                                <i className="fa-solid fa-trash"></i> Remove
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-primary" onClick={() => setShowUserModal(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      <div
        className="modal-overlay"
        id="modalOverlay"
        onClick={(e) => {
          if ((e.target as HTMLElement).id === 'modalOverlay') closeModal();
        }}
      >
        <div className="modal" id="modal">
          <div className="modal-head">
            <h3 id="modalTitle">Title</h3>
            <button className="icon-btn" id="modalClose" onClick={closeModal}>
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div className="modal-body" id="modalBody"></div>
          <div className="modal-foot" id="modalFoot"></div>
        </div>
      </div>

      <div className="toast-wrap" id="toastWrap"></div>
    </>
  );
}
