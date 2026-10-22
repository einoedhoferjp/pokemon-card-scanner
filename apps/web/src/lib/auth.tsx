// Anmelde-Zustand der Web-App (React-Kontext, kein State-Manager nötig).
//
// Beim Start wird /auth/me gefragt; danach hält der Kontext den Nutzer und
// bietet login/register/logout. Fehler werden als Klartext weitergegeben.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser } from "@shared/types";
import * as api from "./api";

export type AuthValue = {
  user: AuthUser | null;
  /** true, solange die erste /auth/me-Antwort aussteht */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Nutzer neu laden (z. B. nach Profiländerung) */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await api.fetchMe());
    } catch {
      // API nicht erreichbar: als "nicht angemeldet" behandeln, aber nicht crashen
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    setUser(res.user);
  }, []);

  const register = useCallback(async (email: string, password: string, displayName?: string) => {
    const res = await api.register(email, password, displayName);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth muss innerhalb von AuthProvider verwendet werden");
  return ctx;
}
