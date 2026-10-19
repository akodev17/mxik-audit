// A short, readable name for a browser from its User-Agent header.
const BROWSERS: [RegExp, string][] = [[/Edg\//, 'Edge'], [/OPR\//, 'Opera'], [/Firefox\//, 'Firefox'], [/Chrome\//, 'Chrome'], [/Safari\//, 'Safari']];
const SYSTEMS: [RegExp, string][] = [[/Windows/, 'Windows'], [/Android/, 'Android'], [/iPhone|iPad|iOS/, 'iOS'], [/Mac OS X/, 'macOS'], [/Linux/, 'Linux']];

export function deviceLabel(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
  return [browser, system].filter(Boolean).join(', ') || null;
}
