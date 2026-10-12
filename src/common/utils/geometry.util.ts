
export interface Sommet {
  latitude: number;
  longitude: number;
}

export type DefautGeometrie =
  | 'TROP_PEU_DE_SOMMETS'
  | 'COORDONNEES_INVALIDES'
  | 'SOMMETS_IDENTIQUES'
  | 'SOMMET_ISOLE_ZERO_ZERO'
  | 'POLYGONE_DEGENERE'
  | 'AUTO_INTERSECTION';

export interface ResultatValidationGeometrie {
  valide: boolean;
  defauts: DefautGeometrie[];
  /** Index des sommets posant problème, lorsque cela a du sens. */
  indexConcernes: number[];
}

const LATITUDE_MAX = 90;
const LONGITUDE_MAX = 180;
/** Seuil en dessous duquel deux sommets sont considérés identiques (~1 cm). */
export const SEUIL_DOUBLON_DEG = 1e-7;
/** Surface minimale crédible pour une parcelle agricole (m²). */
export const SURFACE_MINIMALE_M2 = 1;

/** Sommets identiques au sens du seuil {@link SEUIL_DOUBLON_DEG}. */
export function sontEgaux(a: Sommet, b: Sommet): boolean {
  return (
    Math.abs(a.latitude - b.latitude) <= SEUIL_DOUBLON_DEG &&
    Math.abs(a.longitude - b.longitude) <= SEUIL_DOUBLON_DEG
  );
}

function coordonneesValides(point: Sommet): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= LATITUDE_MAX &&
    Math.abs(point.longitude) <= LONGITUDE_MAX
  );
}

export function dedupliquer(points: readonly Sommet[]): Sommet[] {
  const resultat: Sommet[] = [];

  for (const point of points) {
    const dernier = resultat[resultat.length - 1];
    if (dernier && sontEgaux(dernier, point)) continue;
    resultat.push(point);
  }

  // Fermeture explicite : le dernier sommet recopie le premier.
  if (
    resultat.length > 1 &&
    sontEgaux(resultat[0], resultat[resultat.length - 1])
  ) {
    resultat.pop();
  }

  return resultat;
}

/** Produit en croix (b - a) x (c - a). */
function orientation(a: Sommet, b: Sommet, c: Sommet): number {
  return (
    (b.longitude - a.longitude) * (c.latitude - a.latitude) -
    (b.latitude - a.latitude) * (c.longitude - a.longitude)
  );
}

function surSegment(a: Sommet, b: Sommet, p: Sommet): boolean {
  return (
    Math.min(a.latitude, b.latitude) <= p.latitude &&
    p.latitude <= Math.max(a.latitude, b.latitude) &&
    Math.min(a.longitude, b.longitude) <= p.longitude &&
    p.longitude <= Math.max(a.longitude, b.longitude)
  );
}

/** Les segments [p1,p2] et [p3,p4] se croisent-ils (hors extrémités communes) ? */
function seCroisent(p1: Sommet, p2: Sommet, p3: Sommet, p4: Sommet): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);

  if (o1 * o2 < 0 && o3 * o4 < 0) return true;

  // Cas colinéaires : un point d'un segment touche l'autre segment.
  if (o1 === 0 && surSegment(p1, p2, p3)) return true;
  if (o2 === 0 && surSegment(p1, p2, p4)) return true;
  if (o3 === 0 && surSegment(p3, p4, p1)) return true;
  if (o4 === 0 && surSegment(p3, p4, p2)) return true;

  return false;
}

export function aDesAutoIntersections(points: readonly Sommet[]): boolean {
  const n = points.length;
  if (n < 4) return false;

  for (let i = 0; i < n; i += 1) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];

    for (let j = i + 1; j < n; j += 1) {
      const b1 = points[j];
      const b2 = points[(j + 1) % n];

      // Voisins immédiats (y compris le repli du dernier côté sur le premier).
      const adjacents =
        i === j || (i + 1) % n === j || (j + 1) % n === i;
      if (adjacents) continue;

      if (seCroisent(a1, a2, b1, b2)) return true;
    }
  }

  return false;
}

/** Valide la géométrie d'un polygone de parcelle. */
export function validerGeometrie(
  points: readonly Sommet[],
  surfaceM2?: number,
): ResultatValidationGeometrie {
  const defauts: DefautGeometrie[] = [];
  const indexConcernes: number[] = [];

  if (!Array.isArray(points) || points.length < 3) {
    return {
      valide: false,
      defauts: ['TROP_PEU_DE_SOMMETS'],
      indexConcernes: [],
    };
  }

  points.forEach((point, index) => {
    if (!coordonneesValides(point)) {
      if (!defauts.includes('COORDONNEES_INVALIDES')) {
        defauts.push('COORDONNEES_INVALIDES');
      }
      indexConcernes.push(index);
    }
  });

  if (defauts.length > 0) {
    return { valide: false, defauts, indexConcernes };
  }

  const dedupliques = dedupliquer(points);
  if (dedupliques.length < points.length) {
    defauts.push('SOMMETS_IDENTIQUES');
  }

  if (dedupliques.some(
    (point) => point.latitude === 0 && point.longitude === 0,
  )) {
    defauts.push('SOMMET_ISOLE_ZERO_ZERO');
  }

  if (dedupliques.length < 3) {
    return {
      valide: false,
      defauts: defauts.length > 0 ? defauts : ['TROP_PEU_DE_SOMMETS'],
      indexConcernes,
    };
  }

  if (surfaceM2 !== undefined && surfaceM2 < SURFACE_MINIMALE_M2) {
    defauts.push('POLYGONE_DEGENERE');
  }

  if (aDesAutoIntersections(dedupliques)) {
    defauts.push('AUTO_INTERSECTION');
  }

  return {
    valide: defauts.length === 0,
    defauts,
    indexConcernes,
  };
}

/** Libellé français d'un défaut, pour les messages d'erreur de l'API. */
export const MESSAGE_PAR_DEFAUT: Record<DefautGeometrie, string> = {
  TROP_PEU_DE_SOMMETS: 'Une parcelle doit avoir au moins 3 points GPS distincts.',
  COORDONNEES_INVALIDES:
    'Certaines coordonnées GPS sont hors des plages valides (latitude -90/90, longitude -180/180).',
  SOMMETS_IDENTIQUES:
    'Des points GPS sont identiques. Déplacez-vous entre deux relevés pour obtenir des sommets distincts.',
  SOMMET_ISOLE_ZERO_ZERO:
    'Un point GPS vaut (0 ; 0) : la position n’a pas pu être acquise.',
  POLYGONE_DEGENERE:
    'La délimitation est trop petite pour être une parcelle valide.',
  AUTO_INTERSECTION:
    'La délimitation se croise elle-même. Relevez les sommets dans l’ordre du contour.',
};

export function messagesDesDefauts(defauts: DefautGeometrie[]): string[] {
  return defauts.map((defaut) => MESSAGE_PAR_DEFAUT[defaut]);
}
