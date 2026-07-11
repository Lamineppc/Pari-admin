"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { firebaseAuth, SUPER_ADMIN_UID } from "./firebase";
import { healMyProfileIfMissing } from "./users";

type AuthState = {
  user: User | null;
  loading: boolean;
  isSuperAdmin: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth, (u) => {
      setUser(u);
      setLoading(false);
      // Self-heal the Firestore profile doc if a data wipe left the
      // Firebase Auth account dangling — mirrors the fail-safe path the
      // mobile app expects. Best-effort; a rule rejection here shouldn't
      // block the panel from loading.
      if (u) {
        healMyProfileIfMissing().catch(() => {
          /* no-op */
        });
      }
    });
    return unsub;
  }, []);

  const isSuperAdmin = !!user && user.uid === SUPER_ADMIN_UID;

  const signOut = async () => {
    await fbSignOut(firebaseAuth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, isSuperAdmin, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
