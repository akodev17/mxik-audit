// Web-local copies of small db-free domain helpers (the web app may not import @tasnivo/domain);
// tests/web-parity/pure.test.ts compares each with its original.
// Role checks the pages show or hide controls by (domain access.ts canWrite / isAdminRole).
import type { Role } from '@/lib/api/me';

export const canWrite = (user: { role: Role }): boolean => user.role === 'admin' || user.role === 'accountant';
export const isAdminRole = (user: { role: Role }): boolean => user.role === 'admin';
