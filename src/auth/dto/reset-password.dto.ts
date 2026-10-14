import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Longueur minimale commune aux deux façons de nommer le champ. */
const LONGUEUR_MIN = 8;

export class ResetPasswordDto {
  @IsNotEmpty({ message: 'Le token est obligatoire' })
  @IsString()
  token: string;

  @ValidateIf((dto: ResetPasswordDto) => !dto.password)
  @IsNotEmpty({ message: 'Le nouveau mot de passe est obligatoire' })
  @IsString()
  @MinLength(LONGUEUR_MIN, {
    message: `Le mot de passe doit contenir au moins ${LONGUEUR_MIN} caractères`,
  })
  newPassword?: string;

  /** Alias accepté par tolérance, jamais à réutiliser dans un nouveau client. */
  @IsOptional()
  @IsString()
  @MinLength(LONGUEUR_MIN, {
    message: `Le mot de passe doit contenir au moins ${LONGUEUR_MIN} caractères`,
  })
  password?: string;

  @IsNotEmpty({ message: 'La confirmation du mot de passe est obligatoire' })
  @IsString()
  confirmPassword: string;

  /** Le mot de passe demandé, quel que soit le champ qui l'a transporté. */
  get motDePasse(): string {
    return this.newPassword ?? this.password ?? '';
  }
}
