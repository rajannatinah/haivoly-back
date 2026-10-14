import { LANGUE_EMAIL_PAR_DEFAUT } from '../../mail/mail-modeles';

export const LANGUES_PROFIL = ['fr', 'en', 'mg'] as const;
export type LangueProfil = (typeof LANGUES_PROFIL)[number];

/** Normalise et valide ; `null` quand la valeur est absente ou inconnue. */
export function normaliserLangue(
  brut: string | null | undefined,
): LangueProfil | null {
  if (!brut) return null;
  const code = String(brut).trim().toLowerCase().split('-')[0];
  return (LANGUES_PROFIL as readonly string[]).includes(code)
    ? (code as LangueProfil)
    : null;
}

export const LANGUE_PAR_DEFAUT_PROJET: LangueProfil = LANGUE_EMAIL_PAR_DEFAUT;
