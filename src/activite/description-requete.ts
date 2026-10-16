/**
 * Description d'une requête métier faite EN LIGNE (B-16). Fichier pur.
 *
 * Une action terrain doit notifier le propriétaire quel que soit le canal :
 * hors ligne, `POST /sync` le faisait déjà (13/13) ; en ligne, aucune route
 * métier ne le faisait (0/15). L'intercepteur `ActiviteEnLigneInterceptor`
 * s'appuie sur ces fonctions pour décrire chaque requête réussie avec le même
 * vocabulaire que le journal de synchronisation (CREATE/UPDATE/DELETE ×
 * PARCELLE, CULTURE, INTERVENTION, OBSERVATION, RECOLTE, POINT_GPS, PHOTO).
 */

export type TypeActionActivite = 'CREATE' | 'UPDATE' | 'DELETE';
export type TypeEntiteActivite =
  | 'PARCELLE'
  | 'CULTURE'
  | 'INTERVENTION'
  | 'OBSERVATION'
  | 'RECOLTE'
  | 'POINT_GPS'
  | 'PHOTO';

export interface DescriptionRequete {
  actionType: TypeActionActivite;
  entityType: TypeEntiteActivite;
}

const ACTIONS_PAR_METHODE: Readonly<Record<string, TypeActionActivite>> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

/**
 * Premier segment des routes métier. Tout le reste est exclu : `/sync` et
 * `/actions` (journalisés et notifiés par la synchronisation), `/auth`,
 * `/users`, `/recommendations`, `/dashboard`, `/health`.
 */
const RACINES_METIER = new Set([
  'parcelles',
  'cultures',
  'interventions',
  'observations',
  'recoltes',
]);

/** Dernier segment statique → entité concernée. */
const ENTITES_PAR_SEGMENT: Readonly<Record<string, TypeEntiteActivite>> = {
  parcelles: 'PARCELLE',
  cultures: 'CULTURE',
  interventions: 'INTERVENTION',
  observations: 'OBSERVATION',
  recolte: 'RECOLTE',
  recoltes: 'RECOLTE',
  'points-gps': 'POINT_GPS',
  delimitation: 'POINT_GPS',
  photos: 'PHOTO',
};

/** Segments d'action sans entité propre (`/photos/upload` = ajout de photo). */
const SEGMENTS_NEUTRES = new Set(['upload']);

function segmentsStatiques(cheminRoute: string): string[] {
  return cheminRoute
    .split('?')[0]
    .split('/')
    .filter((segment) => segment.length > 0 && !segment.startsWith(':'));
}

/**
 * Décrit une requête d'après sa méthode et le MOTIF de route Express
 * (`req.route.path`, ex. `/parcelles/:parcelleId/cultures/:id`). `null` si la
 * requête n'est pas une action métier (lecture, route technique, inconnue).
 */
export function decrireRequeteMetier(
  methode: string,
  cheminRoute: string | undefined,
): DescriptionRequete | null {
  const actionType = ACTIONS_PAR_METHODE[methode.toUpperCase()];
  if (!actionType || !cheminRoute) return null;
  const segments = segmentsStatiques(cheminRoute);
  if (segments.length === 0 || !RACINES_METIER.has(segments[0])) return null;
  const significatifs = segments.filter(
    (segment) => !SEGMENTS_NEUTRES.has(segment),
  );
  const entityType =
    ENTITES_PAR_SEGMENT[significatifs[significatifs.length - 1]];
  return entityType ? { actionType, entityType } : null;
}

/** Corps de réponse sans l'enveloppe `{ success, data, message }` (si présente). */
export function deballerReponse(reponse: unknown): unknown {
  if (
    reponse !== null &&
    typeof reponse === 'object' &&
    (reponse as { success?: unknown }).success === true &&
    'data' in reponse
  ) {
    return reponse.data;
  }
  return reponse;
}

function texte(valeur: unknown): string | null {
  return typeof valeur === 'string' && valeur.trim() !== ''
    ? valeur.trim()
    : null;
}

/**
 * Identifiant de l'entité : celui de la réponse, sinon le paramètre de route
 * (`:id`, puis le dernier paramètre). Pour un tracé (`points-gps`), la réponse
 * est une liste : on retient la parcelle ou la culture délimitée.
 */
export function identifiantEntite(
  reponse: unknown,
  parametres: Readonly<Record<string, string | undefined>> = {},
): string | null {
  const corps = deballerReponse(reponse);
  if (corps !== null && typeof corps === 'object' && !Array.isArray(corps)) {
    const id = texte((corps as { id?: unknown }).id);
    if (id) return id;
  }
  if (texte(parametres.id)) return texte(parametres.id);
  const valeurs = Object.values(parametres).filter((valeur): valeur is string =>
    Boolean(texte(valeur)),
  );
  return valeurs.length > 0 ? valeurs[valeurs.length - 1] : null;
}

const LONGUEUR_LIBELLE = 60;

function tronquer(valeur: string): string {
  return valeur.length > LONGUEUR_LIBELLE
    ? `${valeur.slice(0, LONGUEUR_LIBELLE - 1).trimEnd()}…`
    : valeur;
}

/**
 * Libellé lisible de l'élément concerné, pour le message du propriétaire
 * (« Rizière Nord », « Irrigation », « 1850 kg »…). `null` si inconnu.
 */
export function libelleEntite(
  entityType: string,
  reponse: unknown,
): string | null {
  const corps = deballerReponse(reponse);
  if (corps === null || typeof corps !== 'object' || Array.isArray(corps))
    return null;
  const valeurs = corps as Record<string, unknown>;
  const nom = texte(valeurs.nom);
  if (nom) return tronquer(nom);
  switch (entityType) {
    case 'INTERVENTION':
      return texte(valeurs.type) ? tronquer(String(valeurs.type)) : null;
    case 'OBSERVATION':
      return texte(valeurs.description)
        ? tronquer(String(valeurs.description))
        : null;
    case 'RECOLTE': {
      const quantite =
        typeof valeurs.quantite === 'number' ||
        typeof valeurs.quantite === 'string'
          ? valeurs.quantite
          : null;
      const unite = texte(valeurs.unite);
      return quantite !== null && unite ? `${quantite} ${unite}` : null;
    }
    default:
      return null;
  }
}

/** Taille maximale du corps conservé au journal (le reste est signalé, pas stocké). */
export const TAILLE_MAX_CHARGE_JOURNAL = 20_000;

/**
 * Charge utile journalisée : le corps JSON de la requête, tel que validé.
 * Rien pour un envoi de fichier (multipart) ou un corps trop volumineux.
 */
export function chargeJournal(
  corps: unknown,
  typeContenu: string | undefined,
): { payload: Record<string, unknown> | null; tronque: boolean } {
  if (typeContenu?.toLowerCase().includes('multipart/'))
    return { payload: null, tronque: false };
  if (corps === null || typeof corps !== 'object' || Array.isArray(corps))
    return { payload: null, tronque: false };
  const serialise = JSON.stringify(corps);
  if (serialise.length > TAILLE_MAX_CHARGE_JOURNAL)
    return { payload: null, tronque: true };
  return { payload: corps as Record<string, unknown>, tronque: false };
}
