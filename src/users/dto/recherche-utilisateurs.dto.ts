import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class RechercheUtilisateursQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/^@/, '') : value,
  )
  @IsString()
  @MinLength(1, {
    message: 'Le terme de recherche doit contenir au moins 1 caractère',
  })
  @MaxLength(80, { message: 'Le terme de recherche est trop long' })
  q?: string;

  constructor() {
    super();
    // Le sélecteur affiche une courte liste : 10 lignes par défaut.
    this.limit = 10;
  }
}
