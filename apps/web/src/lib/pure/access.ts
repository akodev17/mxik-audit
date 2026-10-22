// Web-local copies of small db-free domain helpers for files the Wave 3 lint rule keeps away from
// @tasnivo/domain (apps/web/eslint.migrated.mjs); pure.test.ts compares each with its original.
// Role checks the pages show or hide controls by (domain access.ts canWrite / isAdminRole).
import type { Role } from '@/lib/api/me';

export const canWrite = (user: { role: Role }): boolean => user.role === 'admin' || user.role === 'accountant';
export const isAdminRole = (user: { role: Role }): boolean => user.role === 'admin';
