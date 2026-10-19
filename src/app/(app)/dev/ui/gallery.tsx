'use client';

// Dev-only visual QA. The sample copy below is fixture text for this page, not product copy,
// so it is not in the dictionaries; the page answers 404 in production.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, StatusChip, StatusIcon, type Tone } from '@/ui/badge';
import { Breadcrumbs } from '@/ui/breadcrumbs';
import { Button, ButtonLink, type ButtonSize, type ButtonVariant } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { CodeChip } from '@/ui/code-chip';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { CopyField } from '@/ui/copy-field';
import { Dialog } from '@/ui/dialog';
import { Drawer } from '@/ui/drawer';
import { EmptyState } from '@/ui/empty-state';
import { IconButton } from '@/ui/icon-button';
import { IconCopy, IconDownload, IconMore, IconPrint, IconSearch, IconX } from '@/ui/icons';
import { Field, Input } from '@/ui/input';
import { Kbd } from '@/ui/kbd';
import { Menu } from '@/ui/menu';
import { Page, Section } from '@/ui/page';
import { Popover } from '@/ui/popover';
import { Progress } from '@/ui/progress';
import { Segmented } from '@/ui/segmented';
import { Select } from '@/ui/select';
import { Skeleton } from '@/ui/skeleton';
import { Spinner } from '@/ui/spinner';
import { Stat } from '@/ui/stat';
import { Stepper } from '@/ui/stepper';
import { Table, Td, Th, Tr } from '@/ui/table';
import { Textarea } from '@/ui/textarea';
import { THEMES, type Theme } from '@/ui/theme';
import { useToast } from '@/ui/toast';
import { Tooltip } from '@/ui/tooltip';

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'danger-ghost'];
const SIZES: ButtonSize[] = ['compact', 'sm', 'md'];
const TONES: Tone[] = ['neutral', 'good', 'warn', 'danger', 'info', 'brand'];
const COLORS = [
  'base', 'surface', 'raised', 'sunken', 'overlay', 'fg', 'muted', 'subtle', 'inverse', 'line', 'line-strong', 'line-input',
  'brand', 'brand-hover', 'brand-active', 'brand-tint', 'brand-ink', 'on-fill', 'focus',
  'good', 'good-tint', 'good-ink', 'warn', 'warn-tint', 'warn-ink', 'danger', 'danger-tint', 'danger-ink', 'info', 'info-tint', 'info-ink',
];

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-line py-3 last:border-b-0 sm:grid-cols-[10rem_1fr] sm:items-center">
      <span className="text-small text-muted">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** Switches data-theme on the enclosing .app, for this QA page only (the real switch lives in the shell). */
function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>('light');
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    anchor.current?.closest('.app')?.setAttribute('data-theme', theme);
  }, [theme]);
  return (
    <div ref={anchor}>
      <Segmented label="Mavzu" value={theme} onChange={setTheme} options={THEMES.map((t) => ({ value: t, label: t }))} />
    </div>
  );
}

function Tokens() {
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {COLORS.map((name) => (
          <div key={name} className="overflow-hidden rounded-md border border-line">
            <div className="h-10" style={{ background: `var(--color-${name})` }} />
            <div className="px-2 py-1 font-mono text-micro text-muted">{name}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-1">
        <p className="text-title">Sarlavha (title) 22/28</p>
        <p className="text-section">Boʻlim sarlavhasi (section) 16/24</p>
        <p className="text-body">Asosiy matn (body) 15/22: katalogdagi har bir qator tasniflagich bilan solishtiriladi.</p>
        <p className="text-data">Jadval matni (data) 14/20 — 12 345 qator</p>
        <p className="text-small text-muted">Kichik matn (small) 13/18</p>
        <p className="text-micro text-muted">Mayda matn (micro) 12/16</p>
        <p><CodeChip code="02201001001401003" /></p>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <div className="grid size-24 place-items-center rounded-sm border border-line bg-raised text-small text-muted shadow-sm">sm · 6</div>
        <div className="grid size-24 place-items-center rounded-md border border-line bg-raised text-small text-muted shadow-pop">pop · 8</div>
        <div className="grid size-24 place-items-center rounded-lg border border-line bg-raised text-small text-muted shadow-overlay">overlay · 12</div>
      </div>
    </>
  );
}

function Buttons() {
  const [busy, setBusy] = useState(false);
  return (
    <>
      {VARIANTS.map((v) => (
        <Row key={v} label={v}>
          {SIZES.map((s) => <Button key={s} variant={v} size={s}>Saqlash ({s})</Button>)}
          <Button variant={v} disabled>Oʻchirilgan</Button>
          <Button variant={v} loading>Yuklanmoqda</Button>
        </Row>
      ))}
      <Row label="with icon / link">
        <Button variant="primary"><IconDownload size={16} />Excel yuklab olish</Button>
        <ButtonLink href="#buttons" variant="secondary"><IconPrint size={16} />Chop etish</ButtonLink>
        <Button variant="secondary" loading={busy} onClick={() => { setBusy(true); void wait(1500).then(() => setBusy(false)); }}>Async: 1,5 s</Button>
      </Row>
      <Row label="icon button">
        {SIZES.map((s) => <IconButton key={s} size={s} label={`Qidirish (${s})`} icon={<IconSearch size={16} />} />)}
        <IconButton variant="secondary" label="Nusxa olish" icon={<IconCopy size={16} />} />
        <IconButton variant="danger-ghost" label="Oʻchirish" icon={<IconX size={16} />} />
        <IconButton label="Yuklanmoqda" icon={<IconSearch size={16} />} loading />
        <IconButton label="Mavjud emas" icon={<IconSearch size={16} />} disabled />
      </Row>
    </>
  );
}

function Status() {
  return (
    <>
      <Row label="badge">{TONES.map((t) => <Badge key={t} tone={t}>{t} 12</Badge>)}</Row>
      <Row label="badge + icon">{TONES.map((t) => <Badge key={t} tone={t} icon={<StatusIcon tone={t} size={12} />}>{t}</Badge>)}</Row>
      <Row label="status chip">{TONES.map((t) => <StatusChip key={t} tone={t}>{t}</StatusChip>)}</Row>
      <Row label="chip + icon">{TONES.map((t) => <StatusChip key={t} tone={t} icon={<StatusIcon tone={t} size={12} />}>{t}</StatusChip>)}</Row>
      <Row label="stepper"><Stepper stages={['Yuklash', 'Ustunlar', 'Tekshiruv']} current={1} /></Row>
      <Row label="kbd / spinner">
        <span className="text-small text-muted"><Kbd>J</Kbd> / <Kbd>K</Kbd> qatorlar, <Kbd>Enter</Kbd> qabul qilish</span>
        <Spinner label="Yuklanmoqda" />
        <span className="text-brand"><Spinner size={20} /></span>
      </Row>
      <Row label="tooltip">
        <Tooltip content="Kod 17 raqamdan iborat"><Button size="sm">Hover yoki focus</Button></Tooltip>
        <Tooltip content="Pastda" side="bottom"><Button size="sm">Pastda</Button></Tooltip>
      </Row>
      <Row label="breadcrumbs">
        <Breadcrumbs items={[{ label: 'Mijozlar', href: '/clients' }, { label: 'Akfa Savdo', href: '#' }, { label: '2026-10 katalog.xlsx' }]} />
      </Row>
      <Row label="skeleton"><Skeleton className="h-4 w-48" /><Skeleton className="h-8 w-24" /></Row>
    </>
  );
}

function Forms() {
  const [mode, setMode] = useState<'all' | 'risky' | 'reviewed'>('risky');
  const [density, setDensity] = useState<'compact' | 'md'>('compact');
  const [checked, setChecked] = useState(true);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mijoz nomi" hint="Hisobotlarda shunday koʻrinadi" required><Input placeholder="Masalan, Akfa Savdo" /></Field>
        <Field label="STIR" error="STIR 9 raqamdan iborat boʻlishi kerak"><Input defaultValue="30512" /></Field>
        <Field label="Oʻchirilgan"><Input disabled defaultValue="Tahrirlab boʻlmaydi" /></Field>
        <Field label="Faqat oʻqish uchun"><Input readOnly defaultValue="mxk_live_…" /></Field>
        <Select label="Ustun" hint="Tovar nomi qaysi ustunda" defaultValue="1">
          <option value="0">A — Kod</option><option value="1">B — Nomi</option><option value="2">C — Narxi</option>
        </Select>
        <Select label="Xato bilan" error="Ustunni tanlang" defaultValue="">
          <option value="">Tanlanmagan</option><option value="1">B — Nomi</option>
        </Select>
        <Field label="Izoh"><Textarea placeholder="Mijozga savol" /></Field>
        <Field label="Izoh (xato)" error="Izoh boʻsh"><Textarea /></Field>
      </div>
      <Row label="sizes">
        <Input size="compact" placeholder="compact 32" className="max-w-40" />
        <Input placeholder="md 36" className="max-w-40" />
        <Input size="lg" placeholder="lg 40" className="max-w-40" />
        <Select size="compact" wrapperClassName="w-40"><option>compact</option></Select>
        <Button size="sm">sm 32</Button><Button>md 36</Button>
      </Row>
      <Row label="checkbox">
        <Checkbox label="Faqat xavfli qatorlar" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <Checkbox label="Hammasi tanlangan emas" indeterminate />
        <Checkbox label="Oʻchirilgan" disabled />
        <Checkbox label="Tavsif bilan" description="Har oy 1-sanada eslatma yuboriladi" defaultChecked />
      </Row>
      <Row label="segmented">
        <Segmented label="Koʻrinish" value={mode} onChange={setMode} options={[{ value: 'all', label: 'Hammasi' }, { value: 'risky', label: 'Xavfli' }, { value: 'reviewed', label: 'Koʻrilgan' }]} />
        <Segmented label="Zichlik" size="md" value={density} onChange={setDensity} options={[{ value: 'compact', label: 'Ixcham' }, { value: 'md', label: 'Keng' }]} />
        <Segmented label="Oʻchirilgan" disabled value="a" onChange={() => undefined} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />
      </Row>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <CopyField label="Mijoz havolasi" value="https://mxik.example/r/8f3k2p" />
        <CopyField label="API kalit" value="mxk_test_2b7c9d" mono size="compact" />
      </div>
    </>
  );
}

function Data() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Mijozlar" value="24" />
        <Stat label="Xavfli qatorlar" value="1 284" tone="danger" hint="3 ta katalogda" href="#data" />
        <Stat label="Koʻrib chiqilgan" value="62%" tone="good" />
        <Stat label="Eʼtibor talab" value="7" tone="warn" href="#data" />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Progress label="Koʻrib chiqilgan qatorlar" value={120} max={400} valueText="120 / 400" />
        <Progress label="Tekshiruv" value={88} tone="good" />
        <Progress label="Xavfli" value={35} tone="danger" size="sm" />
        <Progress label="Navbatda" />
      </div>
      <div className="mt-4">
        <Table label="Namuna jadval">
          <thead>
            <tr>
              {['#', 'Tovar', 'Hozirgi kod', 'Taklif', 'Narxi', 'Soni', 'Holat', 'Mijoz', 'Sana'].map((h, i) => <Th key={h} numeric={i === 4 || i === 5}>{h}</Th>)}
              <Th><span className="sr-only">Amallar</span></Th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map((n) => (
              <Tr key={n} interactive selected={n === 2}>
                <Td numeric>{n}</Td>
                <Td className="whitespace-nowrap">Sut 3,2% 1 L Nestle</Td>
                <Td><CodeChip code="02201001001401003" /></Td>
                <Td><CodeChip code="02201001002001002" /></Td>
                <Td numeric>12 500</Td>
                <Td numeric>{n * 40}</Td>
                <Td><StatusChip tone={n === 1 ? 'danger' : 'good'} icon={<StatusIcon tone={n === 1 ? 'danger' : 'good'} size={12} />}>{n === 1 ? 'Kod yoʻq' : 'Mos'}</StatusChip></Td>
                <Td className="whitespace-nowrap">Akfa Savdo MChJ</Td>
                <Td className="whitespace-nowrap text-muted">19.10.2026</Td>
                <Td><Button size="compact">Qabul qilish</Button></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      <div className="mt-4">
        <Table label="Yopishqoq sarlavha" stickyHeader maxHeight="12rem">
          <thead><tr><Th>Qator</Th><Th numeric>Qiymat</Th></tr></thead>
          <tbody>{Array.from({ length: 12 }, (_, i) => <tr key={i}><Td>Qator {i + 1}</Td><Td numeric>{(i + 1) * 1000}</Td></tr>)}</tbody>
        </Table>
      </div>
      <div className="mt-4 grid gap-4 rounded-ctl border border-line sm:grid-cols-2">
        <EmptyState size="compact" title="Hali katalog yoʻq" hint="Excel yoki CSV faylni yuklang" action={<Button variant="primary">Katalog yuklash</Button>} />
        <EmptyState size="compact" tone="danger" title="Tekshiruv toʻxtadi" hint="Fayl ochilmadi" action={<><Button>Qayta urinish</Button><Button variant="ghost">Bekor qilish</Button></>} />
      </div>
    </>
  );
}

function Overlays() {
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState<'none' | 'default' | 'danger' | 'fail'>('none');
  const [drawer, setDrawer] = useState<'none' | 'plain' | 'backdrop'>('none');
  return (
    <>
      <Row label="dialog">
        <Button onClick={() => setDialog(true)}>Dialog</Button>
        <Button onClick={() => setConfirm('default')}>Tasdiqlash</Button>
        <Button variant="danger" onClick={() => setConfirm('danger')}>Oʻchirish (muvaffaqiyat)</Button>
        <Button variant="danger" onClick={() => setConfirm('fail')}>Oʻchirish (xato)</Button>
      </Row>
      <Row label="popover / menu">
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
          { label: 'Excel', onSelect: () => toast('Excel tayyorlanmoqda') },
          { label: '1C uchun CSV', onSelect: () => toast('CSV tayyorlanmoqda') },
          { label: 'PDF hisobot', disabled: true },
          { label: 'Katalogni oʻchirish', tone: 'danger', onSelect: () => setConfirm('danger') },
        ]} />
        <Menu label="Boshqa amallar" iconOnly icon={<IconMore size={18} />} align="end" items={[
          { label: 'Nusxa olish', icon: <IconCopy size={16} />, onSelect: () => toast('Nusxa olindi') },
          { label: 'Chop etish', icon: <IconPrint size={16} />, onSelect: () => toast('Chop etish') },
        ]} />
      </Row>
      <Row label="drawer">
        <Button onClick={() => setDrawer('plain')}>Drawer</Button>
        <Button onClick={() => setDrawer('backdrop')}>Drawer + backdrop</Button>
      </Row>
      <Row label="toast">
        <Button onClick={() => toast('Oʻzgarishlar saqlandi')}>OK</Button>
        <Button onClick={() => toast('Saqlanmadi: tarmoq bilan aloqa yoʻq', { tone: 'error' })}>Error</Button>
        <Button onClick={() => toast('12 ta qator qabul qilindi', { action: { label: 'Bekor qilish', run: () => toast('Bekor qilindi') } })}>With undo</Button>
      </Row>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Mijoz qoʻshish"
        description="Mijoz nomi va STIR hisobot sarlavhasida koʻrinadi."
        footer={<><Button onClick={() => setDialog(false)}>Bekor qilish</Button><Button variant="primary" onClick={() => setDialog(false)}>Mijozni qoʻshish</Button></>}
      >
        <div className="space-y-3">
          <Field label="Mijoz nomi" required><Input /></Field>
          <Field label="STIR"><Input inputMode="numeric" /></Field>
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirm === 'default'}
        onClose={() => setConfirm('none')}
        title="Takliflarni qabul qilasizmi?"
        description="Tanlangan qatorlarga taklif qilingan kod yoziladi. Keyin bekor qilish mumkin."
        count={12}
        scope="Akfa Savdo · 2026-10 katalog.xlsx"
        confirmLabel="12 ta taklifni qabul qilish"
        onConfirm={() => wait(800)}
      />
      <ConfirmDialog
        open={confirm === 'danger' || confirm === 'fail'}
        onClose={() => setConfirm('none')}
        tone="danger"
        title="Katalogni oʻchirasizmi?"
        description="Katalog va undagi barcha qarorlar oʻchiriladi. Buni qaytarib boʻlmaydi."
        count={1284}
        scope="Akfa Savdo · 2026-10 katalog.xlsx"
        confirmLabel="Katalogni oʻchirish"
        onConfirm={async () => {
          await wait(900);
          return confirm === 'fail' ? { ok: false, error: 'Oʻchirilmadi: katalog hozir tekshirilmoqda.' } : { ok: true };
        }}
      />
      <Drawer
        open={drawer !== 'none'}
        onClose={() => setDrawer('none')}
        title="Qator #42"
        backdrop={drawer === 'backdrop'}
        footer={<div className="flex gap-2"><Button variant="primary">Qabul qilish</Button><Button>Rad etish</Button></div>}
      >
        <div className="space-y-3">
          <p className="text-data">Sut 3,2% 1 L Nestle</p>
          <Field label="Izoh (Escape matn boʻlsa yopmaydi)"><Textarea defaultValue="Mijozdan soʻrash kerak" /></Field>
          <Menu label="Amallar" size="sm" items={[{ label: 'Nusxa olish' }, { label: 'Lugʻatga qoʻshish' }]} />
        </div>
      </Drawer>
    </>
  );
}

export function Gallery() {
  return (
    <Page title="UI gallery" hint="Har bir primitiv har holatda: yorugʻ va qorongʻi mavzuda tekshirish uchun. Faqat dev." wide crumbs={[{ label: 'Dev', href: '/dev/ui' }]} actions={<ThemeSwitch />}>
      <Section title="Tokens"><Tokens /></Section>
      <Section title="Buttons"><div id="buttons"><Buttons /></div></Section>
      <Section title="Status, hints, navigation"><Status /></Section>
      <Section title="Forms"><Forms /></Section>
      <Section title="Data"><div id="data"><Data /></div></Section>
      <Section title="Overlays"><Overlays /></Section>
    </Page>
  );
}
