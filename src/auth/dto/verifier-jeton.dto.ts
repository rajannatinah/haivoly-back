import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerifierJetonDto {
  @IsNotEmpty({ message: 'Le jeton est obligatoire' })
  @IsString()
  @MaxLength(128)
  token: string;
}
