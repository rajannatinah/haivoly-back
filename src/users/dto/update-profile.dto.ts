import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value === null ? '' : value,
  )
  @IsString()
  @MinLength(2, { message: 'Le nom doit contenir au moins 2 caractères' })
  @MaxLength(80)
  nom?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsString()
  @MaxLength(80)
  prenom?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsString()
  @MaxLength(30)
  telephone?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.trim().toLowerCase().replace(/^@/, '')
      : value,
  )
  @IsString()
  @Matches(/^[a-z][a-z0-9._-]{1,28}[a-z0-9]$/, {
    message:
      "Le nom d'utilisateur doit compter de 3 à 30 caractères : lettres minuscules, chiffres, points, tirets bas ou tirets.",
  })
  username?: string;

  /** Langue des messages reçus par le compte. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsIn(['fr', 'en', 'mg'], { message: 'La langue doit être fr, en ou mg' })
  langue?: 'fr' | 'en' | 'mg';
}
