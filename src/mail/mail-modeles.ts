export const LANGUES_EMAIL = ['fr', 'en', 'mg'] as const;
export type LangueEmail = (typeof LANGUES_EMAIL)[number];

export const LANGUE_EMAIL_PAR_DEFAUT: LangueEmail = 'fr';

/** Clé de message — une entrée par e-mail, déclinée dans les trois langues. */
export const CleMessageEmail = {
  BIENVENUE: 'BIENVENUE',
  VERIFICATION: 'VERIFICATION',
  ACTIVATION_COMPTE: 'ACTIVATION_COMPTE',
  DEFINIR_MOT_DE_PASSE: 'DEFINIR_MOT_DE_PASSE',
  REINITIALISATION_MOT_DE_PASSE: 'REINITIALISATION_MOT_DE_PASSE',
  RECOMMANDATION: 'RECOMMANDATION',
} as const;

export type MessageEmailCle =
  (typeof CleMessageEmail)[keyof typeof CleMessageEmail];

export interface MessageEmail {
  sujet: string;
  texte: string;
  html: string;
}

/** Données injectées dans un modèle. Tout est optionnel sauf le destinataire nominatif. */
export interface ContexteEmail {
  appName: string;
  prenom?: string | null;
  nom?: string | null;
  username?: string | null;
  /** URL sécuritaire déjà construite par le service (jeton inclus). */
  url?: string | null;
  /** Second lien utile (ex. confirmation d'adresse) pour éviter un e-mail de plus. */
  urlSecondaire?: string | null;
  libelleSecondaire?: string | null;
  /** Durée de validité affichée, en minutes. */
  dureeMinutes?: number;
  /** Expéditeur de la recommandation, le cas échéant. */
  emetteur?: string | null;
  titreRecommandation?: string | null;
}

interface Libelles {
  bonjour: string;
  lienAdresse: string;
  bouton: string;
  lienSecours: string;
  ignorez: string;
  piedDePage: string;
  identifiant: string;
}

const LIBELLES: Record<LangueEmail, Libelles> = {
  fr: {
    bonjour: 'Bonjour',
    lienAdresse: 'Confirmer mon adresse e-mail',
    bouton: 'Ouvrir le lien',
    lienSecours:
      'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :',
    ignorez:
      "Si vous n'êtes pas à l'origine de cette opération, ignorez cet e-mail.",
    piedDePage:
      'Message automatique de HaiVoly — ne répondez pas à ce message.',
    identifiant: "Nom d'utilisateur",
  },
  en: {
    bonjour: 'Hello',
    lienAdresse: 'Confirm my email address',
    bouton: 'Open the link',
    lienSecours:
      'If the button does not work, copy this link into your browser:',
    ignorez: 'If you did not request this, please ignore this email.',
    piedDePage: 'Automatic message from HaiVoly — please do not reply.',
    identifiant: 'Username',
  },
  mg: {
    bonjour: 'Manao ahoana',
    lienAdresse: 'Hamafio ny mail-nao',
    bouton: 'Sokafy ny rohy',
    lienSecours:
      'Raha tsy mandeha ny bokotra, adikao eto amin’ny navigateur ny rohy:',
    ignorez:
      'Raha tsy ianao no nanao ity fangatahana ity, aza raharahaina ity mail ity.',
    piedDePage: 'Hafatra avoakan’i HaiVoly — aza mamaly ity mail ity.',
    identifiant: 'Anaram-pikidhana',
  },
};

interface TextesMessage {
  sujet: (contexte: ContexteEmail) => string;
  titre: string;
  corps: (contexte: ContexteEmail, libelles: Libelles) => string[];
  libelleBouton?: (contexte: ContexteEmail) => string;
}

const TEXTES: Record<LangueEmail, Record<MessageEmailCle, TextesMessage>> = {
  fr: {
    BIENVENUE: {
      sujet: (c) => `Bienvenue sur ${c.appName} — votre nom d’utilisateur`,
      titre: 'Bienvenue sur HaiVoly',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        `Votre compte a été créé. Vous pouvez vous connecter avec votre adresse e-mail et le mot de passe choisi lors de l'inscription.`,
        `${l.identifiant} : @${c.username}`,
        'Conservez cet identifiant : il sert à vous retrouver dans HaiVoly et à recevoir les recommandations de votre responsable.',
        c.url
          ? 'Confirmez votre adresse e-mail pour activer complètement le compte.'
          : 'Votre compte est déjà actif.',
      ],
      libelleBouton: (c) =>
        c.url ? 'Confirmer mon adresse' : 'Ouvrir HaiVoly',
    },
    VERIFICATION: {
      sujet: (c) => `Confirmez votre adresse e-mail — ${c.appName}`,
      titre: 'Confirmation de votre adresse e-mail',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        `Confirmez votre adresse pour activer votre compte ${c.appName}.`,
        c.dureeMinutes
          ? `Ce lien expire dans ${c.dureeMinutes} minutes.`
          : 'Ce lien est à usage unique.',
        `${l.identifiant} : @${c.username}`,
      ],
      libelleBouton: () => 'Confirmer mon adresse',
    },
    ACTIVATION_COMPTE: {
      sujet: (c) => `Votre compte ${c.appName} a été créé`,
      titre: 'Un compte vous a été créé',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        `Un compte HaiVoly a été ouvert pour vous par votre responsable.`,
        `${l.identifiant} : @${c.username}`,
        'Aucun mot de passe ne vous est transmis : choisissez-le vous-même à l’aide du lien sécurisé ci-dessous.',
        c.dureeMinutes
          ? `Ce lien est valable ${c.dureeMinutes} minutes et ne fonctionne qu’une seule fois.`
          : 'Ce lien ne fonctionne qu’une seule fois.',
      ],
      libelleBouton: () => 'Définir mon mot de passe',
    },
    DEFINIR_MOT_DE_PASSE: {
      sujet: (c) => `Définissez votre mot de passe — ${c.appName}`,
      titre: 'Définition du mot de passe initial',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        `Définissez le mot de passe de votre compte @${c.username}. Il doit contenir au moins 8 caractères, avec une majuscule, une minuscule et un chiffre.`,
        c.dureeMinutes
          ? `Ce lien expire dans ${c.dureeMinutes} minutes et sera invalidé dès son utilisation.`
          : 'Ce lien sera invalidé dès son utilisation.',
      ],
      libelleBouton: () => 'Choisir mon mot de passe',
    },
    REINITIALISATION_MOT_DE_PASSE: {
      sujet: (c) => `Réinitialisez votre mot de passe — ${c.appName}`,
      titre: 'Réinitialisation du mot de passe',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        'Vous avez demandé la réinitialisation de votre mot de passe.',
        c.dureeMinutes
          ? `Ce lien expire dans ${c.dureeMinutes} minutes.`
          : 'Ce lien est à usage unique.',
      ],
      libelleBouton: () => 'Choisir un nouveau mot de passe',
    },
    RECOMMANDATION: {
      sujet: (c) =>
        `Nouvelle recommandation — ${c.titreRecommandation || c.appName}`,
      titre: 'Vous avez reçu une recommandation',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        c.emetteur
          ? `${c.emetteur} vous a transmis une recommandation dans HaiVoly.`
          : 'Une recommandation vous a été transmise dans HaiVoly.',
        c.titreRecommandation ? `Objet : ${c.titreRecommandation}` : '',
        'Ouvrez l’application pour la consulter et la marquer comme lue.',
      ],
      libelleBouton: () => 'Consulter la recommandation',
    },
  },

  en: {
    BIENVENUE: {
      sujet: (c) => `Welcome to ${c.appName} — your username`,
      titre: 'Welcome to HaiVoly',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        'Your account has been created. Sign in with your email address and the password you chose during registration.',
        `${l.identifiant}: @${c.username}`,
        'Keep this identifier: it is how you are found in HaiVoly and how your manager sends you recommendations.',
        c.url
          ? 'Confirm your email address to fully activate the account.'
          : 'Your account is already active.',
      ],
      libelleBouton: (c) => (c.url ? 'Confirm my email' : 'Open HaiVoly'),
    },
    VERIFICATION: {
      sujet: (c) => `Confirm your email address — ${c.appName}`,
      titre: 'Confirm your email address',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        `Please confirm your address to activate your ${c.appName} account.`,
        c.dureeMinutes
          ? `This link expires in ${c.dureeMinutes} minutes.`
          : 'This link can only be used once.',
        `${l.identifiant}: @${c.username}`,
      ],
      libelleBouton: () => 'Confirm my email',
    },
    ACTIVATION_COMPTE: {
      sujet: (c) => `Your ${c.appName} account has been created`,
      titre: 'An account was created for you',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        'A HaiVoly account was opened for you by your manager.',
        `${l.identifiant}: @${c.username}`,
        'No password is sent to you by email: set it yourself using the secure link below.',
        c.dureeMinutes
          ? `This link is valid for ${c.dureeMinutes} minutes and works only once.`
          : 'This link works only once.',
      ],
      libelleBouton: () => 'Set my password',
    },
    DEFINIR_MOT_DE_PASSE: {
      sujet: (c) => `Set your password — ${c.appName}`,
      titre: 'Set your initial password',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        `Set the password for @${c.username}. Use at least 8 characters with one uppercase letter, one lowercase letter and one digit.`,
        c.dureeMinutes
          ? `This link expires in ${c.dureeMinutes} minutes and is invalidated once used.`
          : 'This link is invalidated once used.',
      ],
      libelleBouton: () => 'Choose my password',
    },
    REINITIALISATION_MOT_DE_PASSE: {
      sujet: (c) => `Reset your password — ${c.appName}`,
      titre: 'Password reset',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        'You asked to reset your password.',
        c.dureeMinutes
          ? `This link expires in ${c.dureeMinutes} minutes.`
          : 'This link can only be used once.',
      ],
      libelleBouton: () => 'Choose a new password',
    },
    RECOMMANDATION: {
      sujet: (c) =>
        `New recommendation — ${c.titreRecommandation || c.appName}`,
      titre: 'You received a recommendation',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        c.emetteur
          ? `${c.emetteur} sent you a recommendation in HaiVoly.`
          : 'A recommendation was sent to you in HaiVoly.',
        c.titreRecommandation ? `Subject: ${c.titreRecommandation}` : '',
        'Open the app to read it and mark it as read.',
      ],
      libelleBouton: () => 'Read the recommendation',
    },
  },

  mg: {
    BIENVENUE: {
      sujet: (c) => `Tongasoa amin'ny ${c.appName} — ny anaram-pikidhanao`,
      titre: 'Tongasoa amin’i HaiVoly',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        'Voaforona ny kaontinao. Midira amin’ny alalan’ny mail-nao sy teny miafina nosafidianao.',
        `${l.identifiant}: @${c.username}`,
        'Tehirizo ity anarana ity: izany no ampiasaina hitadiavana anao any anaty HaiVoly ary handraisanao ny torohevitra avy amin’ny tompon’andraikitra.',
        c.url
          ? 'Hamafio ny mail-nao mba hampiasa tanteraka ny kaontinao.'
          : 'Miasa ny kaontinao.',
      ],
      libelleBouton: (c) =>
        c.url ? 'Hamafy ny mail-nao' : 'Sokafy ny HaiVoly',
    },
    VERIFICATION: {
      sujet: (c) => `Hamarino ny mail-nao — ${c.appName}`,
      titre: 'Fanamafisana ny mail-nao',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        `Hamafio ny mail-nao mba hampiasana ny kaontinao ${c.appName}.`,
        c.dureeMinutes
          ? `Voafetra amin'ny ${c.dureeMinutes} minitra ity rohy ity.`
          : 'Indray mandeha ihany ity rohy ity.',
        `${l.identifiant}: @${c.username}`,
      ],
      libelleBouton: () => 'Hamafy ny mail-nao',
    },
    ACTIVATION_COMPTE: {
      sujet: (c) => `Voaforona ny kaontinao ${c.appName}`,
      titre: 'Noforonina ho anao ny kaontiray',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        'Noforonin’ny tompon’andraikitra ny kaontinao ao HaiVoly.',
        `${l.identifiant}: @${c.username}`,
        'Tsy misy teny miafina alefa amin’ny mail: safidio ianao manokana amin’ny rohy voaaro etsy ambany.',
        c.dureeMinutes
          ? `Mandritra ny ${c.dureeMinutes} minitra ity rohy ity ary indray mandeha ihany no miasa.`
          : 'Indray mandeha ihany no miasa ity rohy ity.',
      ],
      libelleBouton: () => 'Hametraka teny miafina',
    },
    DEFINIR_MOT_DE_PASSE: {
      sujet: (c) => `Asento ny teny miafinao — ${c.appName}`,
      titre: 'Fametrahana ny teny miafina voalohany',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        `Asento ny teny miafin'ny kaontinao @${c.username}. Farafahakeliny 8 singa, misy litera lehibe, litera kely ary isa iray.`,
        c.dureeMinutes
          ? `Voafetra amin'ny ${c.dureeMinutes} minitra ity rohy ity ary ho levona rehefa nampiasaina.`
          : 'Ho foana ity rohy ity rehefa voasokafy.',
      ],
      libelleBouton: () => 'Hisafidy teny miafina',
    },
    REINITIALISATION_MOT_DE_PASSE: {
      sujet: (c) => `Hanovana ny teny miafinao — ${c.appName}`,
      titre: 'Fiovana ny teny miafina',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        'Nangataka ny hanova ny teny miafinao ianao.',
        c.dureeMinutes
          ? `Voafetra amin'ny ${c.dureeMinutes} minitra ity rohy ity.`
          : 'Indray mandeha ihany ity rohy ity.',
      ],
      libelleBouton: () => 'Hisafidy teny miafina vaovao',
    },
    RECOMMANDATION: {
      sujet: (c) =>
        `Torohevitra vaovao — ${c.titreRecommandation || c.appName}`,
      titre: 'Nahazo torohevitra ianao',
      corps: (c, l) => [
        `${l.bonjour} ${c.prenom || c.nom || ''},`,
        c.emetteur
          ? `Nalefa ho anao ny torohevitra avy amin’i ${c.emetteur} ao HaiVoly.`
          : 'Nampitaho torohevitra amin’ny HaiVoly ianao.',
        c.titreRecommandation ? `Lohateny: ${c.titreRecommandation}` : '',
        'Sokafy ny fampiharana mba hamakiana azy ary hampilaziana fa efa novakiana.',
      ],
      libelleBouton: () => 'Jereo ny torohevitra',
    },
  },
};

function echapperHtml(valeur: string): string {
  return String(valeur).replace(/[&<>"']/g, (caractere) => {
    const entites: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entites[caractere] ?? caractere;
  });
}

function enveloppeHtml(params: {
  appName: string;
  langue: LangueEmail;
  titre: string;
  paragraphes: string[];
  bouton?: { url: string; libelle: string };
  secondaire?: { url: string; libelle: string };
  piedDePage: string;
}): string {
  const paragraphes = params.paragraphes
    .filter((ligne) => ligne.trim().length > 0)
    .map(
      (ligne) =>
        `<p style="font-size:14px;line-height:1.65;margin:0 0 12px">${echapperHtml(ligne)}</p>`,
    )
    .join('\n');

  const bouton = params.bouton
    ? `<p style="margin:18px 0"><a href="${echapperHtml(params.bouton.url)}" style="display:inline-block;background:#2E7D32;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;font-size:14px">${echapperHtml(params.bouton.libelle)}</a></p>`
    : '';

  const secondaire = params.secondaire
    ? `<p style="font-size:13px;margin:14px 0 0"><a href="${echapperHtml(params.secondaire.url)}" style="color:#2E7D32;font-weight:600">${echapperHtml(params.secondaire.libelle)}</a></p>`
    : '';

  const lien = params.bouton
    ? `<p style="font-size:12px;color:#667085;word-break:break-all;margin:12px 0 0">${LIBELLES[params.langue].lienSecours}<br />${echapperHtml(params.bouton.url)}</p>`
    : '';

  return `<!doctype html>
<html lang="${params.langue}">
  <body style="margin:0;padding:24px;background:#f5f7f5;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#101828">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e6ece6">
      <h1 style="font-size:18px;margin:0 0 10px;color:#2E7D32">${echapperHtml(params.appName)}</h1>
      <h2 style="font-size:16px;margin:0 0 14px">${echapperHtml(params.titre)}</h2>
      ${paragraphes}
      ${bouton}
      ${secondaire}
      ${lien}
      <p style="font-size:12px;color:#667085;margin:20px 0 0">${echapperHtml(LIBELLES[params.langue].ignorez)}</p>
      <p style="font-size:11px;color:#98A2B3;margin:6px 0 0">${echapperHtml(params.piedDePage)}</p>
    </div>
  </body>
</html>`;
}

export function construireMessage(
  cle: MessageEmailCle,
  contexte: ContexteEmail,
  langueBrute?: string | null,
): MessageEmail {
  const langue = resoudreLangueEmail(langueBrute);
  const texte = TEXTES[langue][cle];
  const libelles = LIBELLES[langue];

  const paragraphes = texte
    .corps(contexte, libelles)
    .filter((ligne) => ligne.trim().length > 0);

  const html = enveloppeHtml({
    appName: contexte.appName,
    langue,
    titre: texte.titre,
    paragraphes,
    ...(contexte.url
      ? {
          bouton: {
            url: contexte.url,
            libelle: texte.libelleBouton
              ? texte.libelleBouton(contexte)
              : libelles.bouton,
          },
        }
      : {}),
    ...(contexte.urlSecondaire
      ? {
          secondaire: {
            url: contexte.urlSecondaire,
            libelle: contexte.libelleSecondaire ?? libelles.lienSecours,
          },
        }
      : {}),
    piedDePage: libelles.piedDePage,
  });

  const libelleBouton = texte.libelleBouton
    ? texte.libelleBouton(contexte)
    : libelles.bouton;

  const ligneBouton = contexte.url
    ? `\n\n${libelleBouton} : ${contexte.url}`
    : '';

  const ligneSecondaire =
    contexte.urlSecondaire && contexte.libelleSecondaire
      ? `\n${contexte.libelleSecondaire} : ${contexte.urlSecondaire}`
      : '';

  return {
    sujet: texte.sujet(contexte),
    texte: `${paragraphes.join('\n\n')}${ligneBouton}${ligneSecondaire}\n\n${libelles.ignorez}\n${libelles.piedDePage}`,
    html,
  };
}

export function estLangueEmail(valeur: unknown): valeur is LangueEmail {
  return (
    typeof valeur === 'string' &&
    (LANGUES_EMAIL as readonly string[]).includes(valeur.toLowerCase())
  );
}

/** Libellé du lien de confirmation d'adresse, dans la langue du message. */
export function libelleConfirmationAdresse(
  langueBrute?: string | null,
): string {
  return LIBELLES[resoudreLangueEmail(langueBrute)].lienAdresse;
}

export function resoudreLangueEmail(
  valeur: string | null | undefined,
): LangueEmail {
  if (!valeur) return LANGUE_EMAIL_PAR_DEFAUT;
  const code = valeur.toLowerCase().split('-')[0];
  return (LANGUES_EMAIL as readonly string[]).includes(code)
    ? (code as LangueEmail)
    : LANGUE_EMAIL_PAR_DEFAUT;
}
