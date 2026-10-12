import { IsOptional, IsString } from 'class-validator';

export class DefinirRattachementDto {
  /** Identifiant du PROPRIETAIRE de rattachement, ou null pour détacher. */
  @IsOptional()
  @IsString()
  proprietaireId?: string | null;
}
