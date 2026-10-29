import { useSyncExternalStore } from "react";

export const LANGUAGE_KEY = "omb-language";

let sessionChoice: string | null | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function languageChoice(): string | null {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    return storage()?.getItem(LANGUAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function effectiveLanguage(choice: string | null, serverDefault: string | undefined): string {
  return choice ?? serverDefault ?? "";
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== LANGUAGE_KEY && event.key !== null) return;
  if (event.storageArea && event.storageArea !== storage()) return;
  sessionChoice = undefined;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function setLanguageChoice(language: string): void {
  sessionChoice = language;
  try {
    const local = storage();
    local?.setItem(LANGUAGE_KEY, language);
    if (local?.getItem(LANGUAGE_KEY) === language) sessionChoice = undefined;
  } catch {
  }
  notify();
}

/** The choice to store on the server. Another computer's server takes it only while it has none, so a second
 * window never overrides the language its owner set there. */
export function languageToSave(choice: string | null, saved: string | undefined, ownComputer: boolean): string | null {
  if (choice === null || saved === undefined || choice === saved) return null;
  return ownComputer || (saved === "" && choice !== "") ? choice : null;
}

export function useLanguageChoice(): string | null {
  return useSyncExternalStore(subscribe, languageChoice, () => null);
}
