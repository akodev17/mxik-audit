import type { Role } from '@/lib/api/me';
import type { Tone } from '@/ui/badge';

/** A role's badge tone: admins stand out, accountants are the working default, viewers are quiet. */
export const ROLE_TONE: Record<Role, Tone> = { admin: 'brand', accountant: 'info', viewer: 'neutral' };
