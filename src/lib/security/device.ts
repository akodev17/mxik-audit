// A short, readable name for a browser from its User-Agent header: browser with its major version,
// then the system, so two sessions on different browser versions can be told apart.
const BROWSERS: [RegExp, string][] = [
  [/Edg\/(\d+)/, 'Edge'], [/OPR\/(\d+)/, 'Opera'], [/Firefox\/(\d+)/, 'Firefox'], [/Chrome\/(\d+)/, 'Chrome'], [/Version\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [[/Windows/, 'Windows'], [/Android/, 'Android'], [/iPhone|iPad|iOS/, 'iOS'], [/Mac OS X/, 'macOS'], [/Linux/, 'Linux']];

export function deviceLabel(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = BROWSERS.map(([re, name]) => {
    const version = re.exec(userAgent)?.[1];
    return version ? `${name} ${version}` : null;
  }).find(Boolean);
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
  return [browser, system].filter(Boolean).join(', ') || null;
}
