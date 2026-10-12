import {
  aDesAutoIntersections,
  dedupliquer,
  validerGeometrie,
} from './geometry.util';

const triangle = [
  { latitude: -19.8669, longitude: 47.0332 },
  { latitude: -19.868, longitude: 47.0345 },
  { latitude: -19.866, longitude: 47.035 },
];

describe('geometry.util — validation des polygones de parcelles', () => {
  describe('validerGeometrie', () => {
    it('accepte un triangle valide', () => {
      const resultat = validerGeometrie(triangle, 18_314.78);
      expect(resultat.valide).toBe(true);
      expect(resultat.defauts).toEqual([]);
    });

    it('refuse moins de trois sommets', () => {
      const resultat = validerGeometrie(triangle.slice(0, 2), 0);
      expect(resultat.valide).toBe(false);
      expect(resultat.defauts).toContain('TROP_PEU_DE_SOMMETS');
    });

    it('refuse trois sommets identiques (défaut confirmé par test API réel)', () => {
      const resultat = validerGeometrie([triangle[0], triangle[0], triangle[0]], 0);
      expect(resultat.valide).toBe(false);
      expect(resultat.defauts).toContain('SOMMETS_IDENTIQUES');
    });

    it('refuse un polygone en papillon (auto-intersection)', () => {
      const papillon = [
        { latitude: -19.8669, longitude: 47.0332 },
        { latitude: -19.868, longitude: 47.035 },
        { latitude: -19.8669, longitude: 47.035 },
        { latitude: -19.868, longitude: 47.0332 },
      ];
      const resultat = validerGeometrie(papillon, 0);
      expect(resultat.valide).toBe(false);
      expect(resultat.defauts).toContain('AUTO_INTERSECTION');
    });

    it('refuse une latitude hors plage', () => {
      const resultat = validerGeometrie(
        [{ latitude: 999, longitude: 47.0332 }, triangle[1], triangle[2]],
        100,
      );
      expect(resultat.valide).toBe(false);
      expect(resultat.defauts).toContain('COORDONNEES_INVALIDES');
      expect(resultat.indexConcernes).toEqual([0]);
    });

    it('refuse un sommet à (0 ; 0)', () => {
      const resultat = validerGeometrie(
        [
          { latitude: 0, longitude: 0 },
          triangle[1],
          triangle[2],
        ],
        100,
      );
      expect(resultat.valide).toBe(false);
      expect(resultat.defauts).toContain('SOMMET_ISOLE_ZERO_ZERO');
    });

    it('refuse une surface dégénérée', () => {
      const resultat = validerGeometrie(triangle, 0.0001);
      expect(resultat.valide).toBe(false);
      expect(resultat.defauts).toContain('POLYGONE_DEGENERE');
    });
  });

  describe('dedupliquer', () => {
    it('retire la fermeture explicite sans créer de sommet métier', () => {
      const ferme = [...triangle, triangle[0]];
      expect(dedupliquer(ferme)).toHaveLength(3);
      expect(dedupliquer(ferme)).toEqual(triangle);
    });

    it('retire les doublons consécutifs en conservant l’ordre', () => {
      const avecDoublons = [triangle[0], triangle[0], triangle[1], triangle[1], triangle[2]];
      expect(dedupliquer(avecDoublons)).toEqual(triangle);
    });

    it('préserve l’ordre des sommets non dupliqués', () => {
      const ordre = [triangle[2], triangle[0], triangle[1]];
      expect(dedupliquer(ordre)).toEqual(ordre);
    });
  });

  describe('aDesAutoIntersections', () => {
    it('n’en détecte pas sur un carré convexe', () => {
      const carre = [
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 1 },
        { latitude: 1, longitude: 1 },
        { latitude: 1, longitude: 0 },
      ];
      expect(aDesAutoIntersections(carre)).toBe(false);
    });

    it('détecte un polygone concave croisé', () => {
      const croise = [
        { latitude: 0, longitude: 0 },
        { latitude: 1, longitude: 1 },
        { latitude: 0, longitude: 1 },
        { latitude: 1, longitude: 0 },
      ];
      expect(aDesAutoIntersections(croise)).toBe(true);
    });

    it('accepte un polygone concave simple (en L)', () => {
      const enL = [
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 2 },
        { latitude: 1, longitude: 2 },
        { latitude: 1, longitude: 1 },
        { latitude: 2, longitude: 1 },
        { latitude: 2, longitude: 0 },
      ];
      expect(aDesAutoIntersections(enL)).toBe(false);
    });

    it('accepte un triangle (moins de 4 côtés : impossible à croiser)', () => {
      expect(aDesAutoIntersections(triangle)).toBe(false);
    });
  });
});
