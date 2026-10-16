// What a 17-digit code means, for every screen that shows one: classifier name,
// a short and a full hierarchy path, bound unit and flags. One query per page.
import { db } from './db.js';

export type CodeDetail = {
  code: string;
  name: string;
  nameRu: string;
  /** Group → most specific level, for inline display. */
  shortPath: string;
  /** Group → class → position → subposition, for tooltips and PDFs. */
  fullPath: string;
  /** Strictly bound unit(s), shortened for display; null when the code binds none. */
  unit: string | null;
  unitBinding: 'strict' | 'recommended' | 'none';
  unitCanonical: string[];
  isBase: boolean;
  isMarked: boolean | null;
  taxPrivilegeIds: string[];
  /** False when a later classifier import no longer contains the code. */
  live: boolean;
  groupCode: string;
  subPositionCode: string;
};

const CODE = /^\d{17}$/;

/** The export writes some levels in capitals ("GOʻSHT, BALIQ…"); read them as a sentence. */
export function readableLevel(level: string): string {
  const letters = level.replace(/[^\p{L}]/gu, '');
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  if (letters.length < 4 || upper / letters.length < 0.7) return level;
  const lower = level.toLocaleLowerCase('uz');
  return lower.charAt(0).toLocaleUpperCase('uz') + lower.slice(1);
}

/** Many codes accept a long list of units; three are enough inline. */
export function shortUnitList(units: readonly string[]): string {
  return units.length > 3 ? `${units.slice(0, 3).join(' / ')} …` : units.join(' / ');
}

export function shortPathOf(levels: readonly (string | null)[]): string {
  const present = levels.filter((s): s is string => Boolean(s)).map(readableLevel);
  if (present.length <= 2) return present.join(' → ');
  return [present[0], present[present.length - 1]].join(' → ');
}

/** Details for every valid code given; unknown or malformed codes are simply absent. */
export async function codeDetails(codes: Iterable<string | null | undefined>): Promise<Map<string, CodeDetail>> {
  const wanted = [...new Set([...codes].filter((c): c is string => typeof c === 'string' && CODE.test(c)))];
  if (wanted.length === 0) return new Map();
  const rows = await db.mxikCode.findMany({
    where: { code: { in: wanted } },
    select: {
      code: true, nameUz: true, nameRu: true, groupCode: true, subPositionCode: true,
      groupNameUz: true, classNameUz: true, positionNameUz: true, subPositionNameUz: true,
      unitBinding: true, unitCanonical: true, isBase: true, isMarked: true,
      taxPrivilegeIds: true, retiredAt: true,
    },
  });
  return new Map(rows.map((r) => {
    const levels = [r.groupNameUz, r.classNameUz, r.positionNameUz, r.subPositionNameUz];
    const strict = r.unitBinding === 'strict' && r.unitCanonical.length > 0;
    const detail: CodeDetail = {
      code: r.code.trim(),
      name: r.nameUz,
      nameRu: r.nameRu,
      shortPath: shortPathOf(levels),
      fullPath: levels.filter((s): s is string => Boolean(s)).map(readableLevel).join(' → '),
      unit: strict ? shortUnitList(r.unitCanonical) : null,
      unitBinding: r.unitBinding,
      unitCanonical: r.unitCanonical,
      isBase: r.isBase,
      isMarked: r.isMarked,
      taxPrivilegeIds: r.taxPrivilegeIds.filter((id) => id !== '' && id !== '0'),
      live: r.retiredAt === null,
      groupCode: r.groupCode,
      subPositionCode: r.subPositionCode,
    };
    return [detail.code, detail] as const;
  }));
}

/** JSON-safe subset for client components. */
export type CodeInfo = Pick<CodeDetail, 'code' | 'name' | 'shortPath' | 'fullPath' | 'unit' | 'isMarked' | 'live' | 'isBase'>;

export function toCodeInfo(detail: CodeDetail | undefined | null): CodeInfo | null {
  if (!detail) return null;
  const { code, name, shortPath, fullPath, unit, isMarked, live, isBase } = detail;
  return { code, name, shortPath, fullPath, unit, isMarked, live, isBase };
}
