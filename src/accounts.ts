import { useCallback, useEffect, useState } from "react";

/**
 * Cookies for the sources that only give up audio to a signed-in listener.
 * They stay in this machine's localStorage and are sent only to that source.
 */
export type Accounts = Record<string, string>;

export type Profile = { name: string; avatar?: string };

const KEY = "needle.accounts";
const PROFILES = "needle.profiles";

export function loadAccounts(): Accounts {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Accounts;
  } catch {
    return {};
  }
}

export function useAccounts() {
  const [accounts, setAccounts] = useState<Accounts>(loadAccounts);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(accounts));
    } catch {
      // storage is full or blocked; nothing else to do
    }
  }, [accounts]);

  const setAccount = useCallback((id: string, value: string) => {
    setAccounts((current) => {
      const next = { ...current };
      if (value.trim()) next[id] = value.trim();
      else delete next[id];
      return next;
    });
  }, []);

  return { accounts, setAccount };
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<Record<string, Profile>>(() => {
    try {
      return JSON.parse(localStorage.getItem(PROFILES) ?? "{}") as Record<string, Profile>;
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(PROFILES, JSON.stringify(profiles));
    } catch {
      // ignore
    }
  }, [profiles]);

  const setProfile = useCallback((id: string, profile: Profile) => {
    setProfiles((current) => ({ ...current, [id]: profile }));
  }, []);

  return { profiles, setProfile };
}
