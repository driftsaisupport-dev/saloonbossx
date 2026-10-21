import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { DatabaseService } from '../database/Database';
import {
  resolvePermissions, PermKey, RoleId,
} from '../auth/permissions';

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: RoleId;
  isOwner: boolean;
  staffId: number;
  mustChangePin: boolean;
  perms: Set<PermKey>;
}

interface AuthContextType {
  ready: boolean;                 // finished the initial DB probe
  needsOwnerSetup: boolean;       // no accounts exist yet
  user: SessionUser | null;
  locked: boolean;
  autoLockMinutes: number;        // 0 = no idle lock

  login: (username: string, pin: string) => Promise<{ ok: boolean; message?: string }>;
  logout: () => Promise<void>;
  lock: () => void;
  unlock: (pin: string) => Promise<{ ok: boolean; message?: string }>;
  completeOwnerSetup: () => Promise<void>;
  refreshSession: () => Promise<void>;
  setAutoLockMinutes: (m: number) => Promise<void>;
  pokeActivity: () => void;

  can: (key: PermKey) => boolean;
  canAny: (...keys: PermKey[]) => boolean;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

// Returning from the background after longer than this always re-locks a live
// session — long enough that an image picker / permission dialog won't trip it,
// short enough that someone else picking up the phone has to sign in.
const BACKGROUND_LOCK_GRACE_MS = 45_000;

function toSession(row: any): SessionUser {
  const overrides = (() => {
    try { return row.permissions ? JSON.parse(row.permissions) : null; } catch { return null; }
  })();
  const role = (row.role || 'stylist') as RoleId;
  const isOwner = !!row.is_owner;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    role,
    isOwner,
    staffId: row.staff_id || 0,
    mustChangePin: !!row.must_change_pin,
    perms: resolvePermissions({ role, overrides, isOwner }),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [needsOwnerSetup, setNeedsOwnerSetup] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [locked, setLocked] = useState(false);
  const [autoLockMinutes, setAutoLockMin] = useState(3);

  const backgroundedAt = useRef<number | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userRef = useRef<SessionUser | null>(null);
  const lockedRef = useRef(false);
  const autoLockRef = useRef(3);
  userRef.current = user;
  lockedRef.current = locked;
  autoLockRef.current = autoLockMinutes;

  const doLock = useCallback(() => {
    if (userRef.current) setLocked(true);
  }, []);

  // Idle timer — locks after N minutes of no interaction while the app is open.
  const pokeActivity = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (!userRef.current || lockedRef.current || autoLockRef.current <= 0) return;
    idleTimer.current = setTimeout(doLock, autoLockRef.current * 60_000);
  }, [doLock]);

  useEffect(() => {
    (async () => {
      try {
        await DatabaseService.ensureReady();
        const count = await (DatabaseService as any).authCountUsers();
        setNeedsOwnerSetup(count === 0);
        const raw = await DatabaseService.getSetting('auto_lock_minutes');
        const m = raw === '' ? 3 : (parseInt(raw) || 0);
        setAutoLockMin(m);
        autoLockRef.current = m;
      } catch (e) {
        console.warn('Auth probe failed:', e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Re-arm / cancel the idle timer whenever the session or setting changes.
  useEffect(() => { pokeActivity(); return () => { if (idleTimer.current) clearTimeout(idleTimer.current); }; }, [user, locked, autoLockMinutes, pokeActivity]);

  // Lock on return from the background (a phone lock, an app switch, etc.).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'background' || s === 'inactive') {
        if (backgroundedAt.current == null) backgroundedAt.current = Date.now();
      } else if (s === 'active') {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (since && userRef.current && Date.now() - since > BACKGROUND_LOCK_GRACE_MS) {
          setLocked(true);
        }
        pokeActivity();
      }
    });
    return () => sub.remove();
  }, [pokeActivity]);

  const login = useCallback(async (username: string, pin: string) => {
    const res = await (DatabaseService as any).authLogin(username, pin);
    if (!res.ok) return { ok: false, message: res.message };
    const sess = toSession(res.user);
    const switching = userRef.current && userRef.current.id !== sess.id;
    if (switching) {
      await (DatabaseService as any).logAudit({ id: userRef.current!.id, username: userRef.current!.username }, 'logout', 'app_users', userRef.current!.id, 'switched user');
    }
    setUser(sess);
    setLocked(false);
    await (DatabaseService as any).logAudit({ id: sess.id, username: sess.username }, 'login', 'app_users', sess.id, '');
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    if (userRef.current) {
      await (DatabaseService as any).logAudit({ id: userRef.current.id, username: userRef.current.username }, 'logout', 'app_users', userRef.current.id, '');
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    setUser(null);
    setLocked(false);
  }, []);

  const lock = useCallback(() => { if (userRef.current) setLocked(true); }, []);

  const unlock = useCallback(async (pin: string) => {
    if (!userRef.current) return { ok: false, message: 'No active session.' };
    const id = userRef.current.id;
    const ok = await (DatabaseService as any).authVerifyPin(id, pin);
    if (!ok) {
      // Same lockout as the login screen: tell the user how long, or how many tries remain.
      const st = await (DatabaseService as any).authLockStatus(id).catch(() => null);
      if (st?.locked) {
        const mins = Math.max(1, Math.ceil((Date.parse(st.until) - Date.now()) / 60000));
        return { ok: false, message: `Too many wrong PINs. Locked for ${mins} minute${mins === 1 ? '' : 's'}.` };
      }
      return { ok: false, message: st ? `Wrong PIN. ${st.attemptsLeft} tr${st.attemptsLeft === 1 ? 'y' : 'ies'} left.` : 'Wrong PIN.' };
    }
    setLocked(false);
    return { ok: true };
  }, []);

  const completeOwnerSetup = useCallback(async () => {
    const count = await (DatabaseService as any).authCountUsers();
    setNeedsOwnerSetup(count === 0);
    const owners = await (DatabaseService as any).authListUsers(true);
    const owner = owners.find((u: any) => u.is_owner && u.is_active);
    if (owner) { setUser(toSession(owner)); setLocked(false); }
  }, []);

  const refreshSession = useCallback(async () => {
    if (!userRef.current) return;
    const fresh = await (DatabaseService as any).authGetUser(userRef.current.id);
    if (!fresh || !fresh.is_active) { setUser(null); setLocked(false); return; }
    setUser(toSession(fresh));
  }, []);

  const setAutoLockMinutes = useCallback(async (m: number) => {
    setAutoLockMin(m);
    autoLockRef.current = m;
    await DatabaseService.setSetting('auto_lock_minutes', String(m));
  }, []);

  const can = useCallback((key: PermKey) => {
    if (!user) return false;
    if (user.isOwner) return true;
    return user.perms.has(key);
  }, [user]);

  const canAny = useCallback((...keys: PermKey[]) => keys.some(k => can(k)), [can]);

  return (
    <AuthContext.Provider value={{
      ready, needsOwnerSetup, user, locked, autoLockMinutes,
      login, logout, lock, unlock, completeOwnerSetup, refreshSession, setAutoLockMinutes, pokeActivity,
      can, canAny,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
