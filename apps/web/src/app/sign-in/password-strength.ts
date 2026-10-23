// A rough, local strength hint for new passwords (sign-up, reset, invite). It only advises: the
// server's rule (minimum length) is what decides, and nothing typed leaves the browser for this.

export type Strength = 0 | 1 | 2 | 3 | 4;

const COMMON = /^(?:password|parol|qwerty|qwertyuiop|12345678|123456789|1234567890|11111111|00000000|tasnivo)\d*$/i;

/** 0 = nothing typed, 1 weak, 2 fair, 3 good, 4 strong. Shorter than `min` is always weak. */
export function passwordStrength(password: string, min: number): Strength {
  if (!password) return 0;
  if (password.length < min || COMMON.test(password) || /^(.)\1*$/.test(password)) return 1;
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}]/u].filter((re) => re.test(password)).length;
  let score = 1;
  if (password.length >= 12) score += 1;
  if (classes >= 2) score += 1;
  if (classes >= 3 || password.length >= 16) score += 1;
  return Math.min(score, 4) as Strength;
}
