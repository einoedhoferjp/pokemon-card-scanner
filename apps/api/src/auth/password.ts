// Passwort-Hashing (Argon2id ueber @node-rs/argon2 - vorkompilierte Binaries,
// kein Build-Schritt noetig).

import { hash, verify } from "@node-rs/argon2";

// OWASP-Empfehlung fuer Argon2id: 19 MiB, 2 Iterationen, 1 Parallelitaet
const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashString: string, password: string): Promise<boolean> {
  try {
    return await verify(hashString, password);
  } catch {
    return false;
  }
}

/**
 * Dummy-Hash fuer "Nutzer existiert nicht": verhindert, dass die Antwortzeit
 * verraet, ob eine E-Mail registriert ist (User-Enumeration).
 */
export async function fakeVerify(password: string): Promise<void> {
  await verify(
    "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$1X1i1JcVhVMF9Yn8k4q8Q0R0J0k8kQW3Qd6T7b0jJ0c",
    password,
  ).catch(() => false);
}
