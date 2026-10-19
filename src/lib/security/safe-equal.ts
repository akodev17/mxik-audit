// Constant-time comparison of two strings (signatures, one-time states).
import { createHash, timingSafeEqual } from 'node:crypto';

// Hashing first gives equal-length inputs, so the comparison never leaks the length either.
const digest = (s: string): Buffer => createHash('sha256').update(s).digest();

export const safeEqualText = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b));
