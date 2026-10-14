const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function estDateSeuleValide(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_ONLY_REGEX.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function parseDate(
  value: string | Date | null | undefined,
): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  // Date seule : on l'ancre à minuit UTC pour éviter tout décalage de fuseau
  // (le poste client peut être en UTC+3, le serveur en UTC).
  const parsed = DATE_ONLY_REGEX.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Parse ou lève une exception métier — préférable dans les services. */
export function requireDate(
  value: string | Date | null | undefined,
  field: string,
): Date {
  const parsed = parseDate(value);
  if (!parsed) {
    throw new DateParseError(field, value);
  }
  return parsed;
}

export function requireDateOnly(value: unknown, field: string): string {
  if (!estDateSeuleValide(value)) {
    throw new DateParseError(field, value);
  }

  return value;
}

/** Sérialise une date métier sans heure en "YYYY-MM-DD". */
export function toDateOnly(
  value: string | Date | null | undefined,
): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : parseDate(value);
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/** Sérialise en ISO-8601 UTC complet. */
export function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : parseDate(value);
  return d ? d.toISOString() : null;
}

export class DateParseError extends Error {
  constructor(
    readonly field: string,
    readonly value: unknown,
  ) {
    super(`Date invalide pour le champ « ${field} »`);
    this.name = 'DateParseError';
  }
}
