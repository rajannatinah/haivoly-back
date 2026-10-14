export const USERNAME_LONGUEUR_MIN = 3;
export const USERNAME_LONGUEUR_MAX = 30;
/** Algorithme autorisé : lettre, chiffres et séparateurs simples. */
export const USERNAME_REGEX = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
/** Séparateurs acceptés en saisie, normalisés vers `-`. */
const SEPARATEURS = /[._\-\s]+/g;

const REPLACEMENTS_ACCENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[àáâãäå]/g, 'a'],
  [/[èéêë]/g, 'e'],
  [/[ìíîï]/g, 'i'],
  [/[òóôõö]/g, 'o'],
  [/[ùúûü]/g, 'u'],
  [/ç/g, 'c'],
  [/ñ/g, 'n'],
  [/[ýÿ]/g, 'y'],
];

export type MotifErreurUsername =
  | 'VIDEO'
  | 'TROP_COURT'
  | 'TROP_LONG'
  | 'CARACTERES_NON_AUTORISES'
  | 'FORME_INVALIDE';

export interface VerdictUsername {
  valide: boolean;
  motif?: MotifErreurUsername;
}

/** Translittère les accents les plus courants (noms malgaches et français). */
export function translitterer(valeur: string): string {
  let resultat = valeur.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [regex, remplacement] of REPLACEMENTS_ACCENTS) {
    resultat = resultat.replace(regex, remplacement);
  }
  return resultat;
}

export function normaliserUsername(brut: string | null | undefined): string {
  if (!brut) return '';

  const sansAccent = translitterer(String(brut)).toLowerCase();
  const autorise = sansAccent
    .replace(/[^a-z0-9._\-\s]/g, ' ')
    .replace(SEPARATEURS, '-')
    .replace(/^-+|-+$/g, '');

  return autorise.slice(0, USERNAME_LONGUEUR_MAX).replace(/-+$/g, '');
}

/** Composants autorisés pour bâtir une base : nom, prénom, e-mail. */
export interface SourceUsername {
  nom?: string | null;
  prenom?: string | null;
  email?: string | null;
}

function segmentsDe(valeur: string | null | undefined): string[] {
  if (!valeur) return [];
  return translitterer(String(valeur))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter((segment) => segment.length > 0);
}

export function candidatsUsername(source: SourceUsername): string[] {
  const prenom = segmentsDe(source.prenom);
  const nom = segmentsDe(source.nom);
  const locale = segmentsDe((source.email ?? '').split('@')[0]);

  const candidats: string[] = [];
  const ajouter = (valeur: string) => {
    const normalise = normaliserUsername(valeur);
    if (
      normalise.length >= USERNAME_LONGUEUR_MIN &&
      !candidats.includes(normalise)
    ) {
      candidats.push(normalise);
    }
  };

  if (prenom[0]) ajouter(prenom[0]);
  if (nom[0]) ajouter(nom[0]);
  if (prenom[0] && nom[0]) ajouter(`${prenom[0]}-${nom[0][0]}`);
  ajouter([...prenom, ...nom].join(''));
  if (prenom[0] && nom[0]) ajouter(`${prenom[0]}${nom[0]}`);
  // Partie locale de l'e-mail en dernier recours : `Hao.Li@…` vaut `haoli`,
  // pas `hao` — la concaténation conserve assez de matière pour être unique.
  ajouter(locale.join(''));
  if (locale[0]) ajouter(locale[0]);

  if (candidats.length === 0) candidats.push('utilisateur');

  return candidats.slice(0, 6);
}

export function avecSuffixe(base: string, rang: number): string {
  if (rang <= 1) return base;
  const suffixe = String(rang);
  const troncature = Math.max(
    USERNAME_LONGUEUR_MIN,
    USERNAME_LONGUEUR_MAX - suffixe.length,
  );
  const noyau = normaliserUsername(base)
    .slice(0, troncature)
    .replace(/-+$/g, '');
  return `${noyau}${suffixe}`;
}

export function validerFormatUsername(
  valeur: string | null | undefined,
): VerdictUsername {
  if (valeur === undefined || valeur === null || valeur === '') {
    return { valide: false, motif: 'VIDEO' };
  }
  const texte = String(valeur);
  if (texte.length < USERNAME_LONGUEUR_MIN) {
    return { valide: false, motif: 'TROP_COURT' };
  }
  if (texte.length > USERNAME_LONGUEUR_MAX) {
    return { valide: false, motif: 'TROP_LONG' };
  }
  if (/[^a-z0-9._-]/.test(texte)) {
    return { valide: false, motif: 'CARACTERES_NON_AUTORISES' };
  }
  if (!USERNAME_REGEX.test(texte)) {
    return { valide: false, motif: 'FORME_INVALIDE' };
  }
  return { valide: true };
}

/** Un identifiant de connexion est-il une adresse e-mail plutôt qu'un username ? */
export function estUneAdresseEmail(valeur: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur.trim());
}

export function normaliserIdentifiantDeConnexion(brut: string): {
  type: 'email' | 'username';
  valeur: string;
} {
  const valeur = String(brut ?? '').trim();
  if (estUneAdresseEmail(valeur)) {
    return { type: 'email', valeur: valeur.toLowerCase() };
  }
  return { type: 'username', valeur: normaliserUsername(valeur) };
}
