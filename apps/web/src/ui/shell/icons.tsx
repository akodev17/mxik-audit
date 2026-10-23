// Shell-only icons in the same stroke style as src/ui/icons.tsx; decorative (aria-hidden).
import type { SVGProps } from 'react';
import type { IconProps } from '../icons';

function Svg({ size = 20, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" {...props} />;
}

export const IconQueue = (p: IconProps) => <Svg {...p}><path d="m3 5.5 1.5 1.5L7 4.5M3 11l1.5 1.5L7 10" /><path d="M10 6h7M10 11.5h7M3.5 16h13.5" /></Svg>;
export const IconHelp = (p: IconProps) => <Svg {...p}><circle cx="10" cy="10" r="7.5" /><path d="M7.8 7.8a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.4M10 14.4v.1" /></Svg>;
export const IconPanel = (p: IconProps) => <Svg {...p}><rect x="2.5" y="3.5" width="15" height="13" rx="1.5" /><path d="M7.5 3.5v13" /></Svg>;
export const IconHash = (p: IconProps) => <Svg {...p}><path d="M8 3 6.5 17M13.5 3 12 17M4 7.5h13M3 12.5h13" /></Svg>;
export const IconBox = (p: IconProps) => <Svg {...p}><path d="m10 2.8 7 3.6v7.2l-7 3.6-7-3.6V6.4l7-3.6Z" /><path d="m3 6.4 7 3.6 7-3.6M10 10v7.2" /></Svg>;
export const IconArrowLeft = (p: IconProps) => <Svg {...p}><path d="M16 10H4M9 5l-5 5 5 5" /></Svg>;
export const IconSwitch = (p: IconProps) => <Svg {...p}><path d="M4 7h11l-3-3M16 13H5l3 3" /></Svg>;
export const IconTeam = (p: IconProps) => <Svg {...p}><circle cx="8" cy="7" r="3" /><path d="M2.5 16c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" /><path d="M15.5 5v5M13 7.5h5" /></Svg>;
export const IconClock = (p: IconProps) => <Svg {...p}><circle cx="10" cy="10" r="7.5" /><path d="M10 6v4.2l2.8 1.8" /></Svg>;
export const IconFlag = (p: IconProps) => <Svg {...p}><path d="M4.5 17V3.5M4.5 4h9l-1.8 3.2L13.5 10.5h-9" /></Svg>;
