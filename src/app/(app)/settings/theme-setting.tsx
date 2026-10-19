'use client';

import { useState } from 'react';
import { setTheme } from '@/app/actions/shell';
import { useI18n } from '@/lib/locale-client';
import { Segmented } from '@/ui/segmented';
import { useTheme } from '@/ui/shell/theme-root';
import type { Theme } from '@/ui/theme';
import { useToast } from '@/ui/toast';

/** Light, dark or system: the same preference as the user menu, applied at once and kept in a cookie. */
export function ThemeSetting() {
  const { ta } = useI18n();
  const words = ta.shellX.theme;
  const ctx = useTheme();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  if (!ctx) return null;

  const change = async (next: Theme): Promise<void> => {
    if (saving) return;
    const previous = ctx.theme;
    ctx.applyTheme(next);
    setSaving(true);
    try {
      const result = await setTheme(next);
      if (!result.ok) throw new Error(result.error);
    } catch {
      ctx.applyTheme(previous);
      toast(words.failed, { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Segmented<Theme>
      label={words.label} value={ctx.theme}
      options={[{ value: 'light', label: words.light }, { value: 'dark', label: words.dark }, { value: 'system', label: words.system }]}
      onChange={(v) => { void change(v); }}
    />
  );
}
