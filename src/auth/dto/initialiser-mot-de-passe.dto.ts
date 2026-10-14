import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class InitialiserMotDePasseDto {
  @IsNotEmpty({ message: 'Le jeton du lien est obligatoire' })
  @IsString()
  @MaxLength(128)
  token: string;

  @IsNotEmpty({ message: 'Le nouveau mot de passe est obligatoire' })
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
  newPassword: string;

  @IsNotEmpty({ message: 'La confirmation du mot de passe est obligatoire' })
  @IsString()
  @MaxLength(72)
  confirmPassword: string;
}
