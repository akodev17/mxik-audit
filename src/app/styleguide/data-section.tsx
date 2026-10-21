'use client';

import { useMemo, useState } from 'react';
import { StatusChip, StatusIcon, type Tone } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { CodeChip } from '@/ui/code-chip';
import { Drawer } from '@/ui/drawer';
import { Progress } from '@/ui/progress';
import { Segmented } from '@/ui/segmented';
import { Table, Td, Th, Tr } from '@/ui/table';
import { useToast } from '@/ui/toast';
import { Block, PatternNote, Sub } from './kit';

// Demonstration data only: invented products, codes in the right shape. Nothing here is read from or written to the app.
type Kind = 'ok' | 'missing' | 'notfound' | 'mismatch' | 'unit';
type Review = 'new' | 'accepted' | 'rejected';
type Sample = { id: number; name: string; unit: string; code: string | null; suggest: string | null; kind: Kind; why: string };

const SAMPLE: Sample[] = [
  { id: 1, name: 'Sut 3,2% 1 L (namuna)', unit: 'l', code: '04001001001001001', suggest: null, kind: 'ok', why: 'Kod bor, tasniflagichda bor, nomga mos, birlik mos.' },
  { id: 2, name: 'Mineral suv 1,5 L (namuna)', unit: 'dona', code: null, suggest: '02201001002001002', kind: 'missing', why: 'Qatorda MXIK kodi yoʻq. Taklif nomdan topildi.' },
  { id: 3, name: 'Sharbat olma 1 L (namuna)', unit: 'l', code: '02201001001401003', suggest: '02201002001001001', kind: 'mismatch', why: 'Kod boshqa guruhga tegishli: sinf darajasida ajraladi.' },
  { id: 4, name: 'Un 1-nav 50 kg (namuna)', unit: 'dona', code: '99999999999999999', suggest: null, kind: 'notfound', why: 'Kod tasniflagichda topilmadi.' },
  { id: 5, name: 'Yogʻ kungaboqar 1 L (namuna)', unit: 'dona', code: '01512001001001001', suggest: null, kind: 'unit', why: 'Kod «litr» birligiga qatʼiy bogʻlangan, qatorda «dona».' },
  { id: 6, name: 'Shakar 1 kg (namuna)', unit: 'kg', code: '01701001001001001', suggest: null, kind: 'ok', why: 'Muammo topilmadi.' },
  { id: 7, name: 'Non Patir (namuna)', unit: 'dona', code: null, suggest: '01905001001001001', kind: 'missing', why: 'Qatorda MXIK kodi yoʻq.' },
  { id: 8, name: 'Choy qora 100 g (namuna)', unit: 'dona', code: '00902001001001001', suggest: '00902001002001001', kind: 'mismatch', why: 'Subpozitsiya darajasida ajraladi.' },
];
const LABEL: Record<Kind, { label: string; tone: Tone }> = {
  ok: { label: 'Muammosiz', tone: 'good' },
  missing: { label: 'Kod yoʻq', tone: 'danger' },
  notfound: { label: 'Bazada topilmadi', tone: 'danger' },
  mismatch: { label: 'Nomga mos emas', tone: 'warn' },
  unit: { label: 'Oʻlchov birligi', tone: 'warn' },
};
const REVIEW: Record<Review, { label: string; tone: Tone }> = {
  new: { label: 'Koʻrilmagan', tone: 'neutral' },
  accepted: { label: 'Qabul qilingan', tone: 'brand' },
  rejected: { label: 'Rad etilgan', tone: 'neutral' },
};
const PAGE = 4;

export function DataSection() {
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'risky' | 'clean'>('all');
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [reviews, setReviews] = useState<Record<number, Review>>({});
  const [open, setOpen] = useState<Sample | null>(null);

  const rows = useMemo(() => SAMPLE.filter((r) => (filter === 'all' ? true : filter === 'risky' ? r.kind !== 'ok' : r.kind === 'ok')), [filter]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const allOn = shown.length > 0 && shown.every((r) => picked.has(r.id));
  const someOn = shown.some((r) => picked.has(r.id));
  const decided = Object.values(reviews).length;
  const risky = SAMPLE.filter((r) => r.kind !== 'ok').length;

  const toggle = (id: number): void => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const decide = (to: Review): void => {
    setReviews((cur) => ({ ...cur, ...Object.fromEntries([...picked].map((id) => [id, to])) }));
    toast(`${picked.size} ta namunaviy qator: ${REVIEW[to].label.toLowerCase()} (faqat demo)`);
    setPicked(new Set());
  };

  return (
    <Block id="data" title="Tables and MXIK validation" hint="Table, Tr, CodeChip and StatusChip are the shared pieces. The rows are invented demonstration data and every action stays inside this page.">
      <Sub title="Catalogue review table" note="Demo data: selection, filter, bulk actions, pagination and a row detail panel">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Filtr" value={filter} onChange={(v) => { setFilter(v); setPage(0); setPicked(new Set()); }}
            options={[{ value: 'all', label: 'Hammasi' }, { value: 'risky', label: 'Xavfli' }, { value: 'clean', label: 'Muammosiz' }]}
          />
          <div className="w-56"><Progress size="sm" tone="good" label="Koʻrib chiqilgan" value={decided} max={risky} valueText={`${decided} / ${risky}`} /></div>
        </div>

        <div className="min-h-9" aria-live="polite">
          {picked.size > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-ctl border border-brand bg-brand-tint px-3 py-2 text-small text-brand-ink">
              <span className="font-medium">{picked.size} ta tanlandi</span>
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="primary" onClick={() => decide('accepted')}>Qabul qilish</Button>
                <Button size="sm" onClick={() => decide('rejected')}>Rad etish</Button>
                <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Bekor qilish</Button>
              </span>
            </div>
          ) : null}
        </div>

        <Table label="Namunaviy katalog (demo)">
          <thead>
            <tr>
              <Th className="w-10"><Checkbox label="Sahifadagi hammasini tanlash" hideLabel checked={allOn} indeterminate={!allOn && someOn} onChange={() => setPicked((cur) => { const n = new Set(cur); shown.forEach((r) => (allOn ? n.delete(r.id) : n.add(r.id))); return n; })} /></Th>
              <Th>Tovar</Th><Th>Hozirgi kod</Th><Th>Taklif</Th><Th>Holat</Th><Th>Koʻrib chiqish</Th><Th><span className="sr-only">Amallar</span></Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const rv = REVIEW[reviews[r.id] ?? 'new'];
              return (
                <Tr key={r.id} interactive selected={picked.has(r.id)}>
                  <Td><Checkbox label={`${r.name} tanlash`} hideLabel checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></Td>
                  <Td className="whitespace-nowrap">{r.name}</Td>
                  <Td>{r.code ? <CodeChip code={r.code} /> : <span className="text-small text-danger-ink">kod yoʻq</span>}</Td>
                  <Td>{r.suggest ? <CodeChip code={r.suggest} /> : <span className="text-muted">-</span>}</Td>
                  <Td><StatusChip tone={LABEL[r.kind].tone} icon={<StatusIcon tone={LABEL[r.kind].tone} size={12} />}>{LABEL[r.kind].label}</StatusChip></Td>
                  <Td>{r.kind === 'ok' ? <span className="text-muted">-</span> : <StatusChip tone={rv.tone}>{rv.label}</StatusChip>}</Td>
                  <Td><Button size="compact" onClick={() => setOpen(r)}>Batafsil</Button></Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>

        <PatternNote>Pagination is a plain row of buttons in each list page; there is no shared component yet.</PatternNote>
        <div className="flex flex-wrap items-center justify-between gap-2 text-small text-muted">
          <span className="tabular-nums">{rows.length === 0 ? 0 : page * PAGE + 1}-{Math.min(rows.length, page * PAGE + PAGE)} / {rows.length}</span>
          <span className="flex gap-2">
            <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Oldingi</Button>
            <Button size="sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Keyingi</Button>
          </span>
        </div>
      </Sub>

      <Sub title="Status vocabulary" note="Colour is never the only signal: each chip carries an icon and words">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(LABEL) as Kind[]).map((k) => <StatusChip key={k} tone={LABEL[k].tone} icon={<StatusIcon tone={LABEL[k].tone} size={12} />}>{LABEL[k].label}</StatusChip>)}
          {(Object.keys(REVIEW) as Review[]).map((k) => <StatusChip key={k} tone={REVIEW[k].tone}>{REVIEW[k].label}</StatusChip>)}
        </div>
      </Sub>

      <Drawer
        open={open !== null} onClose={() => setOpen(null)} title={open ? `Qator ${open.id}: Nega bu kod?` : ''}
        footer={<div className="flex gap-2"><Button variant="primary" onClick={() => { toast('Demo: hech narsa saqlanmadi'); setOpen(null); }}>Qabul qilish</Button><Button onClick={() => setOpen(null)}>Yopish</Button></div>}
      >
        {open ? (
          <div className="space-y-4 text-data">
            <p className="font-medium">{open.name}</p>
            <dl className="space-y-3">
              <div><dt className="text-small text-muted">Katalogdagi kod</dt><dd className="mt-1">{open.code ? <CodeChip code={open.code} /> : 'kod yoʻq'}</dd></div>
              <div><dt className="text-small text-muted">Taklif (hali qaror emas)</dt><dd className="mt-1">{open.suggest ? <CodeChip code={open.suggest} /> : '-'}</dd></div>
              <div><dt className="text-small text-muted">Izoh</dt><dd className="mt-1">{open.why}</dd></div>
            </dl>
            <p className="text-micro text-muted">Namunaviy maʼlumot. Haqiqiy tekshiruv bajarilmagan.</p>
          </div>
        ) : null}
      </Drawer>
    </Block>
  );
}
