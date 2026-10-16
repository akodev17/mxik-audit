// Notification wording, shared by the app and Telegram. Pure.

export type UpdateCounts = {
  /** Distinct codes in the client's catalogue that the update archived. */
  archived: number;
  unitChanged: number;
  nameChanged: number;
  /** New problems recorded in the client's catalogue. */
  newFindings: number;
};

export function updateParts(c: UpdateCounts): string[] {
  return [
    c.archived > 0 ? `${c.archived} ta kod arxivlandi` : null,
    c.unitChanged > 0 ? `${c.unitChanged} ta kodning oʻlchov birligi oʻzgardi` : null,
    c.nameChanged > 0 ? `${c.nameChanged} ta kod nomi oʻzgardi` : null,
  ].filter((p): p is string => p !== null);
}

/** "Mijoz X: 3 ta kod arxivlandi, 1 ta kodning oʻlchov birligi oʻzgardi" */
export function updateTitle(clientName: string, c: UpdateCounts): string {
  return `Mijoz ${clientName}: ${updateParts(c).join(', ')}`;
}

export function updateBody(c: UpdateCounts, filename: string, date: Date): string {
  const findings = c.newFindings > 0
    ? `Katalogda ${c.newFindings} ta yangi muammo qayd etildi.`
    : 'Yangi muammo topilmadi.';
  return `Tasniflagich yangilandi (${date.toLocaleDateString('uz-UZ')}). ${findings} Fayl: ${filename}.`;
}
