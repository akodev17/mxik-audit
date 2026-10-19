// Password checks that take the same time whether or not the account exists.
import { verifyPassword } from '../password.js';

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

// A well-formed scrypt hash of a random value nobody knows: verifying against it costs what a real check costs.
const DUMMY_HASH = 'scrypt$5f1d6a0c9b8e47f2a3c4d5e6f7a8b9c0$'
  + '9a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f801';

/** True only for an existing user with this password; a missing user still pays for one scrypt run. */
export async function passwordMatches(user: { passwordHash: string } | null, password: string): Promise<boolean> {
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  return user !== null && ok;
}

export const passwordAcceptable = (password: string): boolean => password.length >= MIN_PASSWORD && password.length <= MAX_PASSWORD;
