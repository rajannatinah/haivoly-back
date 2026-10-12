import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class VerifyEmailDto {
  @IsNotEmpty({ message: 'Le jeton de vérification est obligatoire' })
  @IsString()
  @Length(64, 64, { message: 'Le jeton de vérification est invalide' })
  @Matches(/^[a-f0-9]{64}$/i, { message: 'Le jeton de vérification est invalide' })
  token: string;
}
