import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyEmailDto {
  @IsNotEmpty({ message: 'Le jeton de vérification est obligatoire' })
  @IsString()
  token: string;
}
