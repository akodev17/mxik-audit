// Minimal stroke icons, 20px by default; decorative (aria-hidden) so the text beside them carries the meaning.
import type { SVGProps } from 'react';

export type IconProps = { size?: number; className?: string };

function Svg({ size = 20, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" {...props} />;
}

export const IconUsers = (p: IconProps) => <Svg {...p}><circle cx="7.5" cy="7" r="3" /><path d="M2 16c0-3 2.5-4.5 5.5-4.5S13 13 13 16" /><path d="M13.5 4.5a2.8 2.8 0 0 1 0 5.5M15 12c2 .4 3 1.7 3 4" /></Svg>;
export const IconTable = (p: IconProps) => <Svg {...p}><rect x="2.5" y="3.5" width="15" height="13" rx="1.5" /><path d="M2.5 8h15M2.5 12h15M8 3.5v13" /></Svg>;
export const IconUpload = (p: IconProps) => <Svg {...p}><path d="M10 13V3.5M6 7l4-4 4 4" /><path d="M3 13v3.5h14V13" /></Svg>;
export const IconGear = (p: IconProps) => <Svg {...p}><circle cx="10" cy="10" r="2.6" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></Svg>;
export const IconBell = (p: IconProps) => <Svg {...p}><path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5 1.5 5h-13S5 12 5 8Z" /><path d="M8.5 16a1.6 1.6 0 0 0 3 0" /></Svg>;
export const IconSearch = (p: IconProps) => <Svg {...p}><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 4 4" /></Svg>;
export const IconChevron = (p: IconProps) => <Svg {...p}><path d="m7 4 6 6-6 6" /></Svg>;
export const IconChevronDown = (p: IconProps) => <Svg {...p}><path d="m5 7.5 5 5 5-5" /></Svg>;
export const IconMenu = (p: IconProps) => <Svg {...p}><path d="M3 5.5h14M3 10h14M3 14.5h14" /></Svg>;
export const IconDownload = (p: IconProps) => <Svg {...p}><path d="M10 3.5V13M6 9l4 4 4-4" /><path d="M3 13v3.5h14V13" /></Svg>;
export const IconPrint = (p: IconProps) => <Svg {...p}><path d="M6 7V3h8v4M6 14H3.5V8.5h13V14H14" /><rect x="6" y="11" width="8" height="6" /></Svg>;
export const IconCheck = (p: IconProps) => <Svg {...p}><path d="m4 10.5 4 4 8-9" /></Svg>;
export const IconBook = (p: IconProps) => <Svg {...p}><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16v13H5.5A1.5 1.5 0 0 0 4 17.5v-13Z" /><path d="M4 17.5A1.5 1.5 0 0 1 5.5 16H16v1.5H5.5" /></Svg>;
export const IconHome = (p: IconProps) => <Svg {...p}><path d="M3 9.5 10 3l7 6.5V17H3V9.5Z" /><path d="M8 17v-5h4v5" /></Svg>;
export const IconComment = ({ size = 14, className }: IconProps) => <Svg size={size} className={className} strokeLinecap={undefined}><path d="M3 4.5h14v9H8l-4 3v-3H3v-9Z" /></Svg>;
export const IconList = (p: IconProps) => <Svg {...p}><path d="M7 5.5h10M7 10h10M7 14.5h10" /><circle cx="3.8" cy="5.5" r="0.9" /><circle cx="3.8" cy="10" r="0.9" /><circle cx="3.8" cy="14.5" r="0.9" /></Svg>;
export const IconX = (p: IconProps) => <Svg {...p}><path d="m5 5 10 10M15 5 5 15" /></Svg>;
export const IconMore = (p: IconProps) => <Svg {...p}><circle cx="4.5" cy="10" r="1" /><circle cx="10" cy="10" r="1" /><circle cx="15.5" cy="10" r="1" /></Svg>;
export const IconCopy = (p: IconProps) => <Svg {...p}><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7" /></Svg>;
/** Warning: a triangle with an exclamation mark. */
export const IconAlert = (p: IconProps) => <Svg {...p}><path d="M10 3 2.5 16.5h15L10 3Z" /><path d="M10 8.5v3.5M10 14.4v.1" /></Svg>;
/** Error: a circle with a cross. */
export const IconError = (p: IconProps) => <Svg {...p}><circle cx="10" cy="10" r="7.5" /><path d="m7.4 7.4 5.2 5.2M12.6 7.4l-5.2 5.2" /></Svg>;
/** Success: a circle with a tick. */
export const IconSuccess = (p: IconProps) => <Svg {...p}><circle cx="10" cy="10" r="7.5" /><path d="m6.8 10.3 2.2 2.2 4.2-4.6" /></Svg>;
export const IconInfo = (p: IconProps) => <Svg {...p}><circle cx="10" cy="10" r="7.5" /><path d="M10 9v4.5M10 6.4v.1" /></Svg>;
/** Nothing here yet: an empty tray. */
export const IconEmpty = (p: IconProps) => <Svg {...p}><path d="M2.5 11.5 5 4.5h10l2.5 7v4h-15v-4Z" /><path d="M2.5 11.5h4.2l1 2h4.6l1-2h4.2" /></Svg>;
export const IconEye = (p: IconProps) => <Svg {...p}><path d="M1.8 10S4.8 4.5 10 4.5 18.2 10 18.2 10 15.2 15.5 10 15.5 1.8 10 1.8 10Z" /><circle cx="10" cy="10" r="2.5" /></Svg>;
export const IconEyeOff = (p: IconProps) => <Svg {...p}><path d="M8.2 4.7A8 8 0 0 1 10 4.5c5.2 0 8.2 5.5 8.2 5.5a14 14 0 0 1-2.1 2.8M5.4 6.1C3 7.5 1.8 10 1.8 10s3 5.5 8.2 5.5a7.6 7.6 0 0 0 3.5-.8" /><path d="M8.2 8.3a2.5 2.5 0 0 0 3.5 3.5M3 3l14 14" /></Svg>;
export const IconMail = (p: IconProps) => <Svg {...p}><rect x="2.5" y="4.5" width="15" height="11" rx="1.5" /><path d="m3 5.5 7 5.5 7-5.5" /></Svg>;
export const IconLock = (p: IconProps) => <Svg {...p}><rect x="4" y="9" width="12" height="8.5" rx="1.5" /><path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" /></Svg>;
export const IconKey = (p: IconProps) => <Svg {...p}><circle cx="6.5" cy="13.5" r="3.5" /><path d="m9 11 7.5-7.5M14 6l2 2M12 8l1.5 1.5" /></Svg>;
export const IconShield = (p: IconProps) => <Svg {...p}><path d="M10 2.5 4 5v4.5c0 3.8 2.6 6.8 6 8 3.4-1.2 6-4.2 6-8V5l-6-2.5Z" /><path d="m7.3 10 2 2 3.5-3.8" /></Svg>;
export const IconArrowRight = (p: IconProps) => <Svg {...p}><path d="M4 10h12M11 5l5 5-5 5" /></Svg>;
export const IconArrowLeft = (p: IconProps) => <Svg {...p}><path d="M16 10H4M9 5l-5 5 5 5" /></Svg>;
export const IconBuilding = (p: IconProps) => <Svg {...p}><path d="M3.5 17.5V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v13.5M12.5 8h3a1 1 0 0 1 1 1v8.5M2 17.5h16" /><path d="M6.5 6.5h3M6.5 9.5h3M6.5 12.5h3" /></Svg>;
export const IconClock = (p: IconProps) => <Svg {...p}><circle cx="10" cy="10" r="7.5" /><path d="M10 6v4.2l2.8 1.8" /></Svg>;
export const IconSparkle = (p: IconProps) => <Svg {...p}><path d="M10 2.5c.6 3.7 1.8 4.9 5.5 5.5-3.7.6-4.9 1.8-5.5 5.5-.6-3.7-1.8-4.9-5.5-5.5 3.7-.6 4.9-1.8 5.5-5.5Z" /><path d="M15.5 13.5c.3 1.6.8 2.1 2.4 2.4-1.6.3-2.1.8-2.4 2.4-.3-1.6-.8-2.1-2.4-2.4 1.6-.3 2.1-.8 2.4-2.4Z" /></Svg>;
/** Telegram: the paper plane (a generic mark, not the brand logo). */
export const IconSend = (p: IconProps) => <Svg {...p}><path d="M17.5 2.5 2.5 8.6l5.7 2.3 2.3 5.7 7-14.1Z" /><path d="m17.5 2.5-9.3 8.4" /></Svg>;
