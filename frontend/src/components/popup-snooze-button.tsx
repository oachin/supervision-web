'use client';

import { BellOff, Moon } from 'lucide-react';
import { useAlerts } from '@/components/alert-provider';
import { cn } from '@/lib/utils';

export function PopupSnoozeButton() {
  const { popupSnoozed, snoozePopups, cancelPopupSnooze, popupSnoozeRemainingMin } = useAlerts();

  if (popupSnoozed) {
    return (
      <button
        type="button"
        onClick={cancelPopupSnooze}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border border-amber-400/35 bg-amber-400/10 px-3 py-1.5',
          'text-sm font-medium text-amber-100 transition-colors hover:bg-amber-400/20',
        )}
        title="Réactiver les popups d'alertes"
      >
        <Moon className="h-4 w-4 text-amber-300" />
        Snooze · {popupSnoozeRemainingMin} min
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={snoozePopups}
      className="btn-secondary text-sm"
      title="Masquer les popups d'alertes pendant 30 minutes"
    >
      <BellOff className="h-4 w-4" />
      Snooze
    </button>
  );
}
