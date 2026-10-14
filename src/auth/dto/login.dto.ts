import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class LoginDto {
  @IsOptional()
  @ValidateIf((dto: LoginDto) => !dto.identifier)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty({ message: 'Adresse e-mail ou nom d’utilisateur requis' })
  @IsString()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(254)
  identifier?: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(72, {
    message: 'Le mot de passe ne peut pas dépasser 72 caractères',
  })
  password: string;
}
