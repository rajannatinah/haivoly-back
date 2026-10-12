
/** Fournisseurs d'e-mail temporaires / jetables connus. */
export const DOMAINES_JETABLES: ReadonlySet<string> = new Set([
  // Services jetables généralistes
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'grr.la',
  'sharklasers.com',
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  'temp-mail.org',
  'tempmail.com',
  'tempmailo.com',
  'tempinbox.com',
  'tempail.com',
  'tempr.email',
  'trashmail.com',
  'trashmail.net',
  'trashmail.me',
  'trashmail.io',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'yopmail.gq',
  'jetable.org',
  'mailnesia.com',
  'maildrop.cc',
  'discard.email',
  'discardmail.com',
  'getnada.com',
  'nada.email',
  'dispostable.com',
  'throwawaymail.com',
  'throwaway.email',
  'fakeinbox.com',
  'fakemail.net',
  'spamgourmet.com',
  'spam4.me',
  'mailcatch.com',
  'mytemp.email',
  'mohmal.com',
  'emailondeck.com',
  'mintemail.com',
  'harakirimail.com',
  'incognitomail.org',
  'objectmail.com',
  'proxymail.eu',
  'rcpt.at',
  'safe-mail.net',
  'selfdestructingmail.com',
  'slopsbox.com',
  'spamavert.com',
  'spambox.us',
  'spamherelots.com',
  'spaml.com',
  'suremail.info',
  'teewars.org',
  'teleworm.us',
  'tempemail.com',
  'tempomail.fr',
  'tempymail.com',
  'tmail.ws',
  'tmails.net',
  'toiea.com',
  'tradermail.info',
  'tyldd.com',
  'uggsrock.com',
  'veryrealemail.com',
  'viditag.com',
  'whatpaas.com',
  'whyspam.me',
  'wuzupmail.net',
  'yepmail.net',
  'zetmail.com',
  // Services « alias » jetables largement utilisés en fraude d'inscription
  'mailforspam.com',
  'emailfake.com',
  'fake-mail.ml',
  'fakemailgenerator.com',
  'generator.email',
  'guerrillamail.info',
  'inboxbear.com',
  'moakt.com',
  'spamfree24.org',
]);

export interface PolitiqueEmail {
  bloquerJetables: boolean;
  supplementaires: ReadonlySet<string>;
  ignores: ReadonlySet<string>;
}

function ensembleDepuisCsv(valeur: string | undefined): ReadonlySet<string> {
  if (!valeur) return new Set();
  return new Set(
    valeur
      .split(',')
      .map((domaine) => domaine.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Politique lue depuis les variables d'environnement. */
export function politiqueEmail(env: NodeJS.ProcessEnv = process.env): PolitiqueEmail {
  const brut = env.EMAIL_BLOQUER_JETABLES;
  return {
    bloquerJetables: brut === undefined ? true : brut.toLowerCase() !== 'false',
    supplementaires: ensembleDepuisCsv(env.EMAIL_DOMAINES_JETABLES_SUPPLEMENTAIRES),
    ignores: ensembleDepuisCsv(env.EMAIL_DOMAINES_JETABLES_IGNORES),
  };
}

/** Normalisation : minuscules, espaces supprimés. */
export function normaliserEmail(brut: string): string {
  return brut.trim().toLowerCase();
}

/** Extraction du domaine (vide si l'adresse est malformée). */
export function domaineDe(email: string): string {
  const atIndex = email.lastIndexOf('@');
  return atIndex >= 0 ? email.slice(atIndex + 1) : '';
}

/** Validité syntaxique — distincte de l'existence réelle de la boîte. */
export function estSyntaxiquementValide(brut: string): boolean {
  const email = normaliserEmail(brut);
  if (email.length === 0 || email.length > 254) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;

  const [local, domaine] = [email.slice(0, email.lastIndexOf('@')), domaineDe(email)];
  return local.length <= 64 && domaine.length <= 253;
}

/** Le fournisseur est-il un service temporaire / jetable ? */
export function estDomaineJetable(
  brut: string,
  politique: PolitiqueEmail = politiqueEmail(),
): boolean {
  const domaine = domaineDe(normaliserEmail(brut));
  if (!domaine) return false;
  if (politique.ignores.has(domaine)) return false;
  return DOMAINES_JETABLES.has(domaine) || politique.supplementaires.has(domaine);
}

export function validerEmailInscription(
  brut: string,
  politique: PolitiqueEmail = politiqueEmail(),
): 'EMAIL_INVALIDE' | 'EMAIL_JETABLE' | null {
  const email = normaliserEmail(brut);

  if (!estSyntaxiquementValide(email)) return 'EMAIL_INVALIDE';
  if (politique.bloquerJetables && estDomaineJetable(email, politique)) {
    return 'EMAIL_JETABLE';
  }

  return null;
}
