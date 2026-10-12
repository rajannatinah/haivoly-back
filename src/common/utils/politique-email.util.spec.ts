import {
  domaineDe,
  estDomaineJetable,
  estSyntaxiquementValide,
  normaliserEmail,
  politiqueEmail,
  validerEmailInscription,
} from './politique-email.util';

describe('politique-email.util', () => {
  describe('normaliserEmail', () => {
    it('met en minuscules et retire les espaces', () => {
      expect(normaliserEmail('  Rakoto@Test.MG ')).toBe('rakoto@test.mg');
    });
  });

  describe('estSyntaxiquementValide', () => {
    it.each([
      ['rakoto@example.com'],
      ['pre.nom+sous-domaine@mail.example.co.uk'],
      ['r@x.mg'],
    ])('accepte %s', (email) => {
      expect(estSyntaxiquementValide(email)).toBe(true);
    });

    it.each([
      [''],
      ['rakoto'],
      ['rakoto@'],
      ['@example.com'],
      ['rakoto@example'],
      ['rakoto @example.com'],
      ['rakoto@@example.com'],
    ])('refuse %j', (email) => {
      expect(estSyntaxiquementValide(email)).toBe(false);
    });
  });

  describe('estDomaineJetable', () => {
    it('détecte un domaine jetable quel que soit la casse', () => {
      expect(estDomaineJetable('test@YOPMAIL.COM')).toBe(true);
      expect(estDomaineJetable('test@mailinator.com')).toBe(true);
    });

    it('n’assimile pas un fournisseur gratuit classique à un jetable', () => {
      // Le critère est le caractère temporaire, pas la gratuité.
      expect(estDomaineJetable('test@gmail.com')).toBe(false);
      expect(estDomaineJetable('test@yahoo.fr')).toBe(false);
      expect(estDomaineJetable('test@moov.mg')).toBe(false);
    });

    it('ignore un domaine explicitement retiré de la liste', () => {
      const politique = politiqueEmail({ EMAIL_DOMAINES_JETABLES_IGNORES: 'yopmail.com' });
      expect(estDomaineJetable('test@yopmail.com', politique)).toBe(false);
    });

    it('ajoute un domaine via la configuration', () => {
      const politique = politiqueEmail({
        EMAIL_DOMAINES_JETABLES_SUPPLEMENTAIRES: 'mon-jetable.mg, autre.mg',
      });
      expect(estDomaineJetable('test@mon-jetable.mg', politique)).toBe(true);
      expect(estDomaineJetable('test@autre.mg', politique)).toBe(true);
    });
  });

  describe('validerEmailInscription', () => {
    it('accepte une adresse normale', () => {
      expect(validerEmailInscription('rakoto@example.com')).toBeNull();
    });

    it('refuse une adresse syntaxiquement invalide', () => {
      expect(validerEmailInscription('pas-une-adresse')).toBe('EMAIL_INVALIDE');
    });

    it('refuse une adresse jetable', () => {
      expect(validerEmailInscription('rakoto@10minutemail.com')).toBe('EMAIL_JETABLE');
    });

    it('refuse une adresse jetable en casse mixte et avec espaces', () => {
      expect(validerEmailInscription('  Rakoto@GuerrillaMail.COM ')).toBe('EMAIL_JETABLE');
    });

    it('laisse passer un jetable si la politique est désactivée', () => {
      const politique = politiqueEmail({ EMAIL_BLOQUER_JETABLES: 'false' });
      expect(validerEmailInscription('rakoto@mailinator.com', politique)).toBeNull();
    });

    it('signale d’abord l’invalidité syntaxique avant le caractère jetable', () => {
      expect(validerEmailInscription('rakoto@yopmail')).toBe('EMAIL_INVALIDE');
    });
  });

  describe('domaineDe', () => {
    it('extrait le domaine', () => {
      expect(domaineDe('rakoto@example.com')).toBe('example.com');
    });

    it('renvoie une chaîne vide si l’adresse est malformée', () => {
      expect(domaineDe('rakoto')).toBe('');
    });
  });
});
