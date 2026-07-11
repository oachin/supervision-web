export const alertActionLabels: Record<string, string> = {
  CREATED: 'Création',
  ACKNOWLEDGED: 'Acquittement',
  SNOOZE_EXPIRED: 'Snooze expiré',
  OCCURRENCE: 'Occurrence',
  ISSUE_RESOLVED: 'Problème résolu',
  REOPENED: 'Réouverture',
  CLOSED: 'Clôture',
  NOTE: 'Note',
  RESOURCE_DELETED: 'Ressource supprimée',
};

export const occurrenceActions = new Set(['CREATED', 'SNOOZE_EXPIRED', 'REOPENED', 'OCCURRENCE']);
