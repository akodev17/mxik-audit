// "Nega bu kod?": stored match evidence as a short list of signals. Pure.
import type { MatchEvidence } from '../core/match/evidence.js';

export type SignalTone = 'good' | 'warn' | 'bad' | 'neutral';
export type Signal = { label: string; text: string; tone: SignalTone };

type Input = { evidence: MatchEvidence | null; confidence: number | null; rowUnit: string | null; codeUnit: string | null };

export function rowSignals({ evidence, confidence, rowUnit, codeUnit }: Input): Signal[] {
  if (!evidence) {
    return confidence === null ? [] : [{ label: 'Moslik', text: `Moslik bahosi: ${Math.round(confidence * 100)}%.`, tone: 'neutral' }];
  }
  const out: Signal[] = [];
  if (evidence.stage === 'dictionary') {
    out.push({ label: 'Lugʻat', text: `Firmangiz bu mahsulotni shu kodga ${evidence.dictionaryUses ?? 1} marta tasdiqlagan.`, tone: 'good' });
  }
  if (evidence.barcode) out.push({ label: 'Shtrix-kod', text: 'Qatordagi shtrix-kod tasniflagichda aynan shu kodga biriktirilgan.', tone: 'good' });
  if (evidence.exactName) out.push({ label: 'Nom', text: 'Tovar nomi tasniflagichdagi nom bilan bir xil.', tone: 'good' });
  if (!evidence.barcode && !evidence.exactName && evidence.stage !== 'dictionary') {
    out.push(evidence.matchedWords.length > 0
      ? { label: 'Nom', text: `Mos soʻzlar: ${evidence.matchedWords.join(', ')}.`, tone: 'good' }
      : { label: 'Nom', text: 'Tovar nomi va kod nomida umumiy soʻz yoʻq.', tone: 'bad' });
  }
  if (evidence.unit === 'match') out.push({ label: 'Birlik', text: `Oʻlchov birligi mos: ${rowUnit ?? codeUnit ?? ''}.`, tone: 'good' });
  if (evidence.unit === 'conflict') out.push({ label: 'Birlik', text: `Qatorda “${rowUnit ?? ''}”, kod talab qiladi “${codeUnit ?? ''}”.`, tone: 'bad' });
  if (evidence.unit === 'unknown') out.push({ label: 'Birlik', text: 'Oʻlchov birligini solishtirib boʻlmadi.', tone: 'warn' });
  if (evidence.unit === 'none') out.push({ label: 'Birlik', text: 'Kodga qatʼiy oʻlchov birligi biriktirilmagan.', tone: 'neutral' });
  if (evidence.rerankNone) out.push({ label: 'Tahlil', text: 'Topilgan kodlarning hech biri bu tovarga mos kelmadi.', tone: 'bad' });
  else if (evidence.rerankReason) out.push({ label: 'Tahlil', text: evidence.rerankReason, tone: 'neutral' });
  return out;
}
