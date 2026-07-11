'use client';

import { useState, KeyboardEvent } from 'react';
import { Plus, X, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';

function normalizeTag(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function TagList({
  tags,
  className,
  size = 'sm',
}: {
  tags: string[];
  className?: string;
  size?: 'xs' | 'sm';
}) {
  if (!tags.length) return null;

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {tags.map((tag) => (
        <span
          key={tag}
          className={cn(
            'inline-flex items-center rounded-md border border-primary/20 bg-primary/10 font-medium text-primary',
            size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
          )}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

export function TagEditor({
  tags,
  onSave,
  label = 'Tags',
  hint = 'Projet, client, environnement…',
}: {
  tags: string[];
  onSave: (tags: string[]) => Promise<void>;
  label?: string;
  hint?: string;
}) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  async function persist(next: string[]) {
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  }

  async function addTag() {
    const tag = normalizeTag(draft);
    if (!tag) return;
    const exists = tags.some((t) => t.toLowerCase() === tag.toLowerCase());
    if (exists) {
      setDraft('');
      return;
    }
    setDraft('');
    await persist([...tags, tag]);
  }

  async function removeTag(tag: string) {
    await persist(tags.filter((t) => t !== tag));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void addTag();
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{label}</span>
        {saving && <span className="text-xs text-muted-foreground">Enregistrement…</span>}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md border border-primary/25 bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
            >
              {tag}
              <button
                type="button"
                onClick={() => void removeTag(tag)}
                disabled={saving}
                className="rounded p-0.5 hover:bg-primary/20 disabled:opacity-50"
                title={`Retirer ${tag}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex max-w-md gap-2">
        <input
          className="input flex-1"
          placeholder="Ajouter un tag…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={saving}
        />
        <button
          type="button"
          onClick={() => void addTag()}
          disabled={saving || !normalizeTag(draft)}
          className="btn-secondary shrink-0 px-3"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
