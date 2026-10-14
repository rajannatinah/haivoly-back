import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { Role } from '../../common/enums/domain.enums';

export class RegisterDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty()
  @IsString()
  @MinLength(2, { message: 'Le nom doit contenir au moins 2 caractères' })
  @MaxLength(80)
  nom: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(80)
  prenom?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(30)
  telephone?: string;

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

  /** Langue souhaitée pour les messages du compte (français par défaut). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsIn(['fr', 'en', 'mg'], { message: 'La langue doit être fr, en ou mg' })
  langue?: 'fr' | 'en' | 'mg';

  /** Rôle choisi à l'inscription ; propriétaire par défaut. */
  @IsOptional()
  @IsIn(['AGRICULTEUR', 'PROPRIETAIRE'], {
    message: 'Le rôle doit être AGRICULTEUR ou PROPRIETAIRE',
  })
  role?: Role;

  @IsNotEmpty()
  @IsString()
  @MinLength(8, {
    message: 'Le mot de passe doit contenir au moins 8 caractères',
  })
  @MaxLength(72, {
    message: 'Le mot de passe ne peut pas dépasser 72 caractères',
  })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message:
      'Le mot de passe doit contenir une majuscule, une minuscule et un chiffre',
  })
  password: string;
}
