"use client";

import {useSyncExternalStore} from "react";

const STORAGE_KEY = "darkodds-theme";
const CHANGE_EVENT = "darkodds-theme-change";

export type Theme = "light" | "dark";

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function getClientSnapshot(): Theme {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "dark" ? "dark" : "light";
}

const getServerSnapshot = (): Theme => "light";

/// Reactive subscription to the dossier theme. Returns "light" on SSR, the
/// current localStorage-backed theme on the client. Re-renders on toggle
/// (the landing-page ThemeToggle dispatches the `darkodds-theme-change` event).
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
