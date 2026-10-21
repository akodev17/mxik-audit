'use client';

import { useState } from 'react';
import { Button, ButtonLink, type ButtonSize, type ButtonVariant } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { CodeChip } from '@/ui/code-chip';
import { CopyField } from '@/ui/copy-field';
import { EmptyState } from '@/ui/empty-state';
import { IconButton } from '@/ui/icon-button';
import { IconCopy, IconDownload, IconPrint, IconSearch, IconX } from '@/ui/icons';
import { Field, Input } from '@/ui/input';
import { Page, Section } from '@/ui/page';
import { Segmented } from '@/ui/segmented';
import { Select } from '@/ui/select';
import { BarChart } from '@/ui/bar-chart';
import { RowList } from '@/ui/row-list';
import { TabPanels } from '@/ui/tab-panels';
import { Skeleton } from '@/ui/skeleton';
import { StatRow } from '@/ui/stat-row';
import { Stat } from '@/ui/stat';
import { Textarea } from '@/ui/textarea';
import { Block, PatternNote, Row, Stage, Sub } from './kit';

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'danger-ghost'];
const SIZES: ButtonSize[] = ['compact', 'sm', 'md'];
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function TypographySection() {
  return (
    <Block id="typography" title="Typography" hint="Onest for text, IBM Plex Mono for identifiers. Sizes are the text-* utilities; weights 400, 500, 600.">
      <Stage className="space-y-4">
        <div><p className="font-mono text-micro text-muted">text-title / h1 · 600</p><h1 className="text-title">Katalog tekshiruvi natijalari</h1></div>
        <div><p className="font-mono text-micro text-muted">text-section / h2 · 600</p><h2 className="text-section">Koʻrib chiqish navbati</h2></div>
        <div><p className="font-mono text-micro text-muted">text-body · 400</p><p className="max-w-2xl text-body">Har bir qator rasmiy MXIK tasniflagichi bilan solishtiriladi; taklif qarorga aylanishidan oldin odam tomonidan tasdiqlanadi.</p></div>
        <div><p className="font-mono text-micro text-muted">text-data · 400 (tables, controls)</p><p className="text-data">Sut 3,2% 1 L Nestle · 12 500 soʻm</p></div>
        <div><p className="font-mono text-micro text-muted">text-small text-muted (supporting)</p><p className="text-small text-muted">Oxirgi tekshiruv 19.10.2026, 14:32</p></div>
        <div><p className="font-mono text-micro text-muted">text-small font-medium (label)</p><p className="text-small font-medium">Mijoz nomi</p></div>
        <div><p className="font-mono text-micro text-muted">text-micro text-muted (caption)</p><p className="text-micro text-muted">Namunaviy maʼlumot, haqiqiy mijoz emas</p></div>
        <div><p className="font-mono text-micro text-muted">link</p><a href="#typography" className="text-data font-medium text-brand-ink underline underline-offset-4 hover:text-brand-hover">Tarixni koʻrish</a></div>
        <div><p className="font-mono text-micro text-muted">numeric: tabular-nums</p><p className="text-title tabular-nums">1 284 <span className="text-small font-normal text-muted">xavfli qator</span></p></div>
        <div><p className="font-mono text-micro text-muted">identifier: CodeChip (font-mono, no wrap)</p><CodeChip code="02201001001401003" /></div>
      </Stage>
    </Block>
  );
}

export function ButtonsSection() {
  const [busy, setBusy] = useState(false);
  return (
    <Block id="buttons" title="Buttons and actions" hint="Variants in src/ui/button.tsx: primary, secondary, ghost, danger, danger-ghost. There is no separate outline variant: secondary is the bordered one.">
      <Stage>
        {VARIANTS.map((v) => (
          <Row key={v} label={v}>
            {SIZES.map((s) => <Button key={s} variant={v} size={s}>Saqlash · {s}</Button>)}
            <Button variant={v} disabled>Disabled</Button>
            <Button variant={v} loading>Loading</Button>
          </Row>
        ))}
        <Row label="with icon / link">
          <Button variant="primary"><IconDownload size={16} />Excel yuklab olish</Button>
          <ButtonLink href="#buttons" variant="secondary"><IconPrint size={16} />Chop etish</ButtonLink>
          <Button variant="secondary" loading={busy} onClick={() => { setBusy(true); void wait(1500).then(() => setBusy(false)); }}>Loading demo, 1.5 s</Button>
        </Row>
        <Row label="IconButton">
          {SIZES.map((s) => <IconButton key={s} size={s} label={`Qidirish ${s}`} icon={<IconSearch size={16} />} />)}
          <IconButton variant="secondary" label="Nusxa olish" icon={<IconCopy size={16} />} />
          <IconButton variant="danger-ghost" label="Oʻchirish" icon={<IconX size={16} />} />
          <IconButton label="Loading" icon={<IconSearch size={16} />} loading />
          <IconButton label="Disabled" icon={<IconSearch size={16} />} disabled />
        </Row>
      </Stage>
      <p className="text-small text-muted">Hover, focus-visible and active states are live: tab to a button or press it. Disabled and loading ignore the pointer.</p>
    </Block>
  );
}

export function FormsSection() {
  const [mode, setMode] = useState<'all' | 'risky' | 'reviewed'>('risky');
  const [checked, setChecked] = useState(true);
  const [value, setValue] = useState('30512');
  return (
    <Block id="forms" title="Form controls" hint="Field links label, hint and error to the control by id. The application has no shared switch, date picker or file-upload component; native inputs use the same control styles.">
      <Stage>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Text input" hint="Hint under the control" required><Input placeholder="Akfa Savdo" /></Field>
          <Field label="Search input"><Input type="search" placeholder="Tovar nomi yoki kod" /></Field>
          <Field label="Error" error={value.length === 9 ? undefined : 'STIR 9 raqamdan iborat boʻlishi kerak'}>
            <Input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          </Field>
          <Field label="Success state" hint="Tekshirildi"><Input defaultValue="305123456" className="border-good" /></Field>
          <Field label="Disabled"><Input disabled defaultValue="Tahrirlab boʻlmaydi" /></Field>
          <Field label="Read-only"><Input readOnly defaultValue="mxk_live_…" /></Field>
          <Select label="Select" hint="Tovar nomi qaysi ustunda" defaultValue="1">
            <option value="0">A, Kod</option><option value="1">B, Nomi</option><option value="2">C, Narxi</option>
          </Select>
          <Select label="Select with error" error="Ustunni tanlang" defaultValue=""><option value="">Tanlanmagan</option><option value="1">B, Nomi</option></Select>
          <Field label="Textarea"><Textarea placeholder="Mijozga savol" /></Field>
          <Field label="Textarea with error" error="Izoh boʻsh"><Textarea /></Field>
          <Field label="Date (native input)"><Input type="date" defaultValue="2026-10-21" /></Field>
          <Field label="File (native input)" hint=".xlsx, .csv"><Input type="file" accept=".xlsx,.csv" /></Field>
        </div>
        <div className="mt-2 border-t border-line">
          <Row label="sizes"><Input size="compact" placeholder="compact" className="max-w-36" /><Input placeholder="md" className="max-w-36" /><Input size="lg" placeholder="lg" className="max-w-36" /></Row>
          <Row label="Checkbox">
            <Checkbox label="Faqat xavfli qatorlar" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <Checkbox label="Indeterminate" indeterminate />
            <Checkbox label="Disabled" disabled />
            <Checkbox label="Description" description="Har oy 1-sanada eslatma" defaultChecked />
          </Row>
          <Row label="Segmented (radio group)">
            <Segmented label="Koʻrinish" value={mode} onChange={setMode} options={[{ value: 'all', label: 'Hammasi' }, { value: 'risky', label: 'Xavfli' }, { value: 'reviewed', label: 'Koʻrilgan' }]} />
            <Segmented label="Disabled" disabled value="a" onChange={() => undefined} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />
          </Row>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <CopyField label="CopyField" value="https://example.test/r/demo" />
          <CopyField label="CopyField mono" value="mxk_test_demo" mono size="compact" />
        </div>
      </Stage>
    </Block>
  );
}

export function LayoutSection() {
  return (
    <Block id="layout" title="Cards and layout" hint="Surfaces: base (page, sidebar), surface (panels, active nav item, table heads), raised (cards), sunken (wells). The app frame is a header (brand cell, section tabs, account controls) over a slim icon rail and a full-bleed page divided by hairlines. Prefer open lists and hairlines over nested boxes; shadow only for floating layers.">
      <Sub title="Surfaces">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['bg-base border border-line', 'base: the page'],
            ['bg-surface border border-line', 'surface: panels, table heads'],
            ['bg-raised border border-line', 'raised: standard card'],
            ['bg-sunken border border-line', 'sunken: wells, tracks'],
          ].map(([cls, label]) => <div key={label} className={`rounded-ctl p-4 text-small ${cls}`}>{label}</div>)}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-ctl border border-line bg-raised p-4 text-small">Standard card: border-line, no shadow</div>
          <div className="rounded-ctl border border-line bg-raised p-4 text-small shadow-pop">Elevated: shadow-pop (menus, popovers)</div>
          <div className="rounded-lg border border-line bg-raised p-4 text-small shadow-overlay">Overlay: rounded-lg + shadow-overlay</div>
        </div>
      </Sub>

      <Sub title="Page header and sections" note="Page and Section from src/ui/page.tsx">
        <div className="rounded-ctl border border-line bg-base">
          <Page title="Mijozlar" hint="Mijozlar boʻyicha nima kutayotgani va keyingi qadam." actions={<Button variant="primary" size="sm">Mijoz qoʻshish</Button>} crumbs={[{ label: 'Bosh sahifa', href: '#layout' }]}>
            <Section title="Eʼtibor talab qiladiganlar" hint="Birinchi navbatda koʻriladigan mijozlar">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Xavfli qatorlar" value="1 284" tone="danger" hint="3 ta katalogda" />
                <Stat label="Koʻrib chiqilgan" value="62%" tone="good" />
                <Stat label="Eʼtibor kerak" value="7" tone="warn" />
                <Stat label="Mijozlar" value="24" />
              </div>
            </Section>
          </Page>
        </div>
      </Sub>

      <Sub title="Summary row" note="StatRow: hairline-divided measures with no boxes; value, unit, one line of context, optional bar and link">
        <StatRow label="Namuna" items={[
          { key: 'a', label: 'Ochiq xavfli qatorlar', value: '107', tone: 'danger', hint: '113 ta topilma: ayrim qatorlarda bir nechta', href: '#layout' },
          { key: 'b', label: 'Koʻrib chiqilgan', value: '52', unit: '/ 107', hint: '48% bajarildi', bar: { done: 52, total: 107 } },
          { key: 'c', label: 'Eʼtibor kerak', value: '1', tone: 'warn', hint: '1 ta mijozdan' },
          { key: 'd', label: 'Muddati oʻtgan tekshiruvlar', value: '0', hint: 'oylik vazifalar' },
        ]} />
      </Sub>

      <Sub title="Large summary row" note={"StatRow size=lg and bare: the dashboard version, hairlines supplied by the page grid"}>
        <StatRow size="lg" bare label="Namuna" items={[
          { key: 'a', label: 'Ochiq xavfli qatorlar', value: '107', tone: 'danger', hint: '113 ta topilma' },
          { key: 'b', label: 'Koʻrib chiqilgan', value: '52', unit: '/ 107', bar: { done: 52, total: 107 }, hint: '48% bajarildi' },
          { key: 'c', label: 'Eʼtibor kerak', value: '1', tone: 'warn' },
          { key: 'd', label: 'Muddati oʻtgan', value: '0' },
        ]} />
      </Sub>

      <Sub title="Bar chart" note="BarChart: zero baseline, the tallest bar in brand colour, counts printed on the bars, columns link to filtered lists">
        <BarChart label="Namuna" items={[
          { key: 'a', label: 'Kod yoʻq', value: 47, display: '47 · 42%' },
          { key: 'b', label: 'Nomga mos emas', value: 36, display: '36 · 32%' },
          { key: 'c', label: 'Tasniflagichda yoʻq', value: 17, display: '17 · 15%' },
          { key: 'd', label: 'Oʻlchov birligi', value: 13, display: '13 · 12%' },
        ]} height={160} />
      </Sub>

      <Sub title="Tab panels" note="TabPanels: in-page tabs with arrow-key navigation; every panel is already on the page">
        <TabPanels label="Namuna" tabs={[
          { id: 'a', label: 'Mijozlar', content: <p className="text-small text-muted">Birinchi panel</p> },
          { id: 'b', label: 'Harakatlar', content: <p className="text-small text-muted">Ikkinchi panel</p> },
        ]} />
      </Sub>

      <Sub title="Open list" note="RowList: hairlines between rows, no box. For secondary content such as recent activity">
        <RowList>
          {[['Demo ishga tushirildi', '21.10.2026 15:45'], ['Tahlil tugadi', '21.10.2026 15:45'], ['Taklif qabul qilindi', '21.10.2026 15:52']].map(([t, d]) => (
            <li key={t} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5"><span><span className="block font-medium">{t}</span><span className="block text-small text-muted">namuna@example.test · Namunaviy MChJ</span></span><time className="text-small tabular-nums text-muted">{d}</time></li>
          ))}
        </RowList>
      </Sub>

      <Sub title="Sidebar layout and content grid">
        <div className="grid min-h-48 overflow-hidden rounded-ctl border border-line md:grid-cols-[12rem_minmax(0,1fr)]">
          <div className="hidden border-r border-line bg-surface p-3 text-small text-muted md:block">Sidebar 12rem</div>
          <div className="grid gap-3 bg-base p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_16rem]">
            <div className="rounded-ctl border border-line bg-raised p-4 text-small xl:col-span-1">Main column: minmax(0, 1fr)</div>
            <div className="rounded-ctl border border-line bg-raised p-4 text-small">Aside: fixed 16rem from xl</div>
          </div>
        </div>
        <p className="mt-2 text-small text-muted">Containers: max-w-page 64rem (forms, lists), max-w-page-wide 80rem (tables, dashboards).</p>
      </Sub>

      <Sub title="Empty states and skeletons">
        <div className="grid gap-4 rounded-ctl border border-line sm:grid-cols-2">
          <EmptyState size="compact" title="Hali katalog yoʻq" hint="Excel yoki CSV faylni yuklang" action={<Button variant="primary">Katalog yuklash</Button>} />
          <EmptyState size="compact" tone="danger" title="Tekshiruv toʻxtadi" hint="Fayl ochilmadi" action={<Button>Qayta urinish</Button>} />
        </div>
        <div className="mt-3 space-y-2 rounded-ctl border border-line bg-raised p-4"><Skeleton className="h-4 w-48" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
      </Sub>
      <PatternNote>Page-level loading uses PageSkeleton from src/ui/skeleton.tsx.</PatternNote>
    </Block>
  );
}
