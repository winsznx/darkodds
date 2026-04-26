"use client";

import {useEffect, useSyncExternalStore} from "react";

const STORAGE_KEY = "darkodds-theme";
const CHANGE_EVENT = "darkodds-theme-change";

type Theme = "light" | "dark";

// localStorage subscription — both the cross-tab `storage` event and our own
// `darkodds-theme-change` event (fired by onToggle below for same-tab updates,
// since `storage` doesn't fire in the originating tab).
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

// SSR matches layout.tsx's default `<html data-theme="light">`. The client
// snapshot may differ if the user previously toggled — React reconciles via
// the layout effect below.
const getServerSnapshot = (): Theme => "light";

export function ThemeToggle(): React.ReactElement {
  const theme = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  // Sync the chosen theme to the <html> data-theme attribute on every change.
  // No setState here — this is the React 19 "external system sync" pattern.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const onToggle = (): void => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  // Label shows the *target* theme (the one the click would switch to).
  const label = theme === "dark" ? "LIGHT" : "DARK";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={`Switch to ${label.toLowerCase()} theme`}
    >
      {label}
    </button>
  );
}
