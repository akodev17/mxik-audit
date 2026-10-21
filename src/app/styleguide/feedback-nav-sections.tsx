'use client';

import { useState, type ReactNode } from 'react';
import { StatusIcon, type Tone } from '@/ui/badge';
import { Breadcrumbs } from '@/ui/breadcrumbs';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { cx } from '@/ui/cx';
import { Dialog } from '@/ui/dialog';
import { EmptyState } from '@/ui/empty-state';
import { IconCopy, IconDownload, IconMore, IconPrint } from '@/ui/icons';
import { Field, Input } from '@/ui/input';
import { Menu } from '@/ui/menu';
import { Popover } from '@/ui/popover';
import { Progress } from '@/ui/progress';
import { Checkbox } from '@/ui/checkbox';
import { Select } from '@/ui/select';
import { NAV_ICONS } from '@/ui/shell/nav-items';
import { NavLink } from '@/ui/shell/nav-link';
import { Spinner } from '@/ui/spinner';
import { Tabs } from '@/ui/tabs';
import { useToast } from '@/ui/toast';
import { Tooltip } from '@/ui/tooltip';
import { Block, PatternNote, Row, Stage, Sub } from './kit';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const ALERT: Record<Exclude<Tone, 'neutral' | 'brand'>, string> = {
  info: 'border-info bg-info-tint text-info-ink', good: 'border-good bg-good-tint text-good-ink',
  warn: 'border-warn bg-warn-tint text-warn-ink', danger: 'border-danger bg-danger-tint text-danger-ink',
};

function Alert({ tone, children }: { tone: keyof typeof ALERT; children: ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex items-start gap-2 rounded-ctl border px-3 py-2 text-small', ALERT[tone])}>
      <span className="mt-0.5 shrink-0"><StatusIcon tone={tone} size={14} /></span>
      <span>{children}</span>
    </div>
  );
}

export function FeedbackSection() {
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState<'none' | 'default' | 'danger' | 'fail'>('none');
  return (
    <Block id="feedback" title="Feedback and overlays" hint="Everything here is self-contained: confirmations wait a moment and then do nothing.">
      <Stage>
        <Row label="Toast">
          <Button onClick={() => toast('Oʻzgarishlar saqlandi')}>Success</Button>
          <Button onClick={() => toast('Saqlanmadi: tarmoq bilan aloqa yoʻq', { tone: 'error' })}>Error</Button>
          <Button onClick={() => toast('12 ta qator qabul qilindi', { action: { label: 'Bekor qilish', run: () => toast('Bekor qilindi') } })}>With undo</Button>
        </Row>
        <Row label="Dialog">
          <Button onClick={() => setDialog(true)}>Dialog</Button>
          <Button onClick={() => setConfirm('default')}>Confirm</Button>
          <Button variant="danger" onClick={() => setConfirm('danger')}>Confirm, danger</Button>
          <Button variant="danger" onClick={() => setConfirm('fail')}>Confirm, fails</Button>
        </Row>
        <Row label="Popover / Menu">
          <Popover label="Filtr">
            {(close) => (
              <div className="w-64 space-y-3">
                <Select label="Holat" size="compact"><option>Hammasi</option><option>Xavfli</option></Select>
                <Checkbox label="Faqat koʻrilmagan" />
                <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={close}>Bekor qilish</Button><Button size="sm" variant="primary" onClick={close}>Qoʻllash</Button></div>
              </div>
            )}
          </Popover>
          <Menu label="Eksport" icon={<IconDownload size={16} />} items={[
            { label: 'Excel', onSelect: () => toast('Demo: eksport bajarilmaydi') },
            { label: 'PDF hisobot', disabled: true },
            { label: 'Oʻchirish', tone: 'danger', onSelect: () => setConfirm('danger') },
          ]} />
          <Menu label="Boshqa amallar" iconOnly icon={<IconMore size={18} />} align="end" items={[
            { label: 'Nusxa olish', icon: <IconCopy size={16} />, onSelect: () => toast('Nusxa olindi') },
            { label: 'Chop etish', icon: <IconPrint size={16} />, onSelect: () => toast('Demo') },
          ]} />
        </Row>
        <Row label="Tooltip">
          <Tooltip content="Kod 17 raqamdan iborat"><Button size="sm">Hover yoki focus</Button></Tooltip>
          <Tooltip content="Pastda" side="bottom"><Button size="sm">Pastda</Button></Tooltip>
        </Row>
        <Row label="Progress / Spinner">
          <div className="grid w-full max-w-xl gap-3 sm:grid-cols-2">
            <Progress label="Koʻrib chiqilgan" value={120} max={400} valueText="120 / 400" />
            <Progress label="Tekshiruv" value={88} tone="good" />
            <Progress label="Xavfli" value={35} tone="danger" size="sm" />
            <Progress label="Navbatda (noaniq)" />
          </div>
          <Spinner label="Yuklanmoqda" />
        </Row>
      </Stage>

      <Sub title="Inline alerts"><PatternNote>Built from tint and ink tokens; no shared Alert component exists yet.</PatternNote>
        <div className="grid gap-2">
          <Alert tone="info">Tekshiruv fonda bajarilmoqda; sahifani yopishingiz mumkin.</Alert>
          <Alert tone="good">Katalog yuklandi va tekshirildi.</Alert>
          <Alert tone="warn">12 ta qatorda oʻlchov birligi kodga mos emas.</Alert>
          <Alert tone="danger">Fayl ochilmadi: ustunlar topilmadi.</Alert>
        </div>
      </Sub>

      <Sub title="Error and empty state">
        <div className="grid gap-4 rounded-ctl border border-line sm:grid-cols-2">
          <EmptyState size="compact" title="Koʻrib chiqiladigan qator yoʻq" hint="Yangi katalog yuklansa, qatorlar shu yerda paydo boʻladi" />
          <EmptyState size="compact" tone="danger" title="Yuklab boʻlmadi" hint="Tarmoq xatosi" action={<Button>Qayta urinish</Button>} />
        </div>
      </Sub>

      <Dialog
        open={dialog} onClose={() => setDialog(false)} title="Mijoz qoʻshish" description="Mijoz nomi hisobot sarlavhasida koʻrinadi."
        footer={<><Button onClick={() => setDialog(false)}>Bekor qilish</Button><Button variant="primary" onClick={() => setDialog(false)}>Qoʻshish</Button></>}
      >
        <Field label="Mijoz nomi" required><Input /></Field>
      </Dialog>
      <ConfirmDialog
        open={confirm === 'default'} onClose={() => setConfirm('none')} title="Takliflarni qabul qilasizmi?" description="Namunaviy tasdiqlash: hech narsa oʻzgarmaydi."
        count={12} scope="Namunaviy mijoz · katalog.xlsx" confirmLabel="12 ta taklifni qabul qilish" onConfirm={() => wait(700)}
      />
      <ConfirmDialog
        open={confirm === 'danger' || confirm === 'fail'} onClose={() => setConfirm('none')} tone="danger" title="Katalogni oʻchirasizmi?"
        description="Namunaviy: hech narsa oʻchirilmaydi." count={1284} scope="Namunaviy mijoz · katalog.xlsx" confirmLabel="Oʻchirish"
        onConfirm={async () => { await wait(800); return confirm === 'fail' ? { ok: false, error: 'Oʻchirilmadi: namunaviy xato.' } : { ok: true }; }}
      />
    </Block>
  );
}

export function NavigationSection() {
  const [active, setActive] = useState('clients');
  const items = [
    { key: 'dashboard', label: 'Bosh sahifa' }, { key: 'queue', label: 'Koʻrib chiqish navbati' }, { key: 'clients', label: 'Mijozlar' },
    { key: 'catalogs', label: 'Kataloglar' }, { key: 'upload', label: 'Yuklash' },
  ] as const;
  return (
    <Block id="navigation" title="Navigation" hint="NavLink is the real sidebar link (active marker, hover, focus); links here only switch the sample state.">
      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Sidebar sample" className="rounded-ctl border border-line bg-surface p-2">
          <ul className="space-y-0.5">
            {items.map((i) => (
              <NavLink key={i.key} item={{ key: i.key, href: `#nav-${i.key}`, label: i.label, icon: NAV_ICONS[i.key] }} active={active === i.key} onNavigate={() => setActive(i.key)} />
            ))}
          </ul>
        </nav>
        <div className="space-y-5">
          <Sub title="Breadcrumbs"><Breadcrumbs items={[{ label: 'Mijozlar', href: '#navigation' }, { label: 'Namunaviy MChJ', href: '#navigation' }, { label: 'katalog.xlsx' }]} /></Sub>
          <Sub title="Tabs" note="Link based: the active tab is a URL in the app">
            <div className="space-y-4">
              <Tabs items={[{ href: '#tab-a', label: 'Hisob', active: true }, { href: '#tab-b', label: 'Xavfsizlik', active: false }, { href: '#tab-c', label: 'Tarif', active: false, count: 2 }]} />
            </div>
          </Sub>
          <Sub title="Dropdown menu">
            <Menu label="Amallar" items={[{ label: 'Tahrirlash' }, { label: 'Nusxa olish', icon: <IconCopy size={16} /> }, { label: 'Oʻchirish', tone: 'danger' }]} />
          </Sub>
        </div>
      </div>
    </Block>
  );
}
