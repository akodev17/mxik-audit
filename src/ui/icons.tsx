// Minimal stroke icons, 20px; decorative so they carry no label.
import type { SVGProps } from 'react';

function Svg(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props} />;
}

export const IconUsers = () => <Svg><circle cx="7.5" cy="7" r="3" /><path d="M2 16c0-3 2.5-4.5 5.5-4.5S13 13 13 16" /><path d="M13.5 4.5a2.8 2.8 0 0 1 0 5.5M15 12c2 .4 3 1.7 3 4" /></Svg>;
export const IconTable = () => <Svg><rect x="2.5" y="3.5" width="15" height="13" rx="1.5" /><path d="M2.5 8h15M2.5 12h15M8 3.5v13" /></Svg>;
export const IconUpload = () => <Svg><path d="M10 13V3.5M6 7l4-4 4 4" /><path d="M3 13v3.5h14V13" /></Svg>;
export const IconGear = () => <Svg><circle cx="10" cy="10" r="2.6" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></Svg>;
export const IconBell = () => <Svg><path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5 1.5 5h-13S5 12 5 8Z" /><path d="M8.5 16a1.6 1.6 0 0 0 3 0" /></Svg>;
export const IconSearch = () => <Svg><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 4 4" /></Svg>;
export const IconChevron = () => <Svg><path d="m7 4 6 6-6 6" /></Svg>;
export const IconMenu = () => <Svg><path d="M3 5.5h14M3 10h14M3 14.5h14" /></Svg>;
export const IconDownload = () => <Svg><path d="M10 3.5V13M6 9l4 4 4-4" /><path d="M3 13v3.5h14V13" /></Svg>;
export const IconPrint = () => <Svg><path d="M6 7V3h8v4M6 14H3.5V8.5h13V14H14" /><rect x="6" y="11" width="8" height="6" /></Svg>;
export const IconCheck = () => <Svg><path d="m4 10.5 4 4 8-9" /></Svg>;
