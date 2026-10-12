import { IsEmail, IsNotEmpty } from 'class-validator';

export class ResendVerificationDto {
  @IsNotEmpty({ message: "L'adresse e-mail est obligatoire" })
  @IsEmail({}, { message: "L'adresse e-mail est invalide" })
  email: string;
}
