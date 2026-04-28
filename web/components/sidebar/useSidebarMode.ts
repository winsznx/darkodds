"use client";

import {useCallback, useEffect, useSyncExternalStore} from "react";

const STORAGE_KEY = "sidebar:collapsed";
const CHANGE_EVENT = "darkodds:sidebar-mode-change";

interface SidebarMode {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
}

function getClientSnapshot(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function writeStored(v: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, v ? "true" : "false");
  } catch {
    // private mode / quota — collapse still applies for this session
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useSidebarMode(): SidebarMode {
  const collapsed = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  const setCollapsed = useCallback((v: boolean) => {
    writeStored(v);
  }, []);

  const toggle = useCallback(() => {
    writeStored(!getClientSnapshot());
  }, []);

  useEffect(() => {
    function isTextInput(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "\\") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTextInput(e.target)) return;
      e.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return {collapsed, toggle, setCollapsed};
}
