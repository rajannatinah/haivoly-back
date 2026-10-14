export function echapperMotifLike(terme: string): string {
  return terme.replace(/[\\%_]/g, (caractere) => `\\${caractere}`);
}

/** Motif `LIKE` « contient » prêt à l'emploi, avec échappement. */
export function motifLike(terme: string): string {
  return `%${echapperMotifLike(terme.trim())}%`;
}
