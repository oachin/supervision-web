'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'havet-server-tile-order';

export function loadServerTileOrder(): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : null;
  } catch {
    return null;
  }
}

export function saveServerTileOrder(order: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
}

export function mergeServerOrder(saved: string[] | null, serverIds: string[]): string[] {
  const ids = new Set(serverIds);
  const merged: string[] = [];

  if (saved) {
    for (const id of saved) {
      if (ids.has(id)) {
        merged.push(id);
        ids.delete(id);
      }
    }
  }

  for (const id of serverIds) {
    if (ids.has(id)) merged.push(id);
  }

  return merged;
}

export function reorderIds(order: string[], draggedId: string, targetId: string): string[] {
  if (draggedId === targetId) return order;
  const from = order.indexOf(draggedId);
  const to = order.indexOf(targetId);
  if (from === -1 || to === -1) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, draggedId);
  return next;
}

export function useServerTileOrder(serverIds: string[]) {
  const [order, setOrder] = useState<string[]>(serverIds);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setOrder(mergeServerOrder(loadServerTileOrder(), serverIds));
    setHydrated(true);
  }, [serverIds.join(',')]);

  const persistOrder = useCallback((next: string[]) => {
    setOrder(next);
    saveServerTileOrder(next);
  }, []);

  const move = useCallback(
    (draggedId: string, targetId: string) => {
      persistOrder(reorderIds(order, draggedId, targetId));
    },
    [order, persistOrder],
  );

  return { order, move, hydrated };
}
