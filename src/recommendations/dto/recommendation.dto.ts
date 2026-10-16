import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import {
  RecommendationPriority,
  RecommendationType,
} from '../../common/enums/domain.enums';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateRecommendationDto {
  /** Identifiant utilisateur, ou "all" pour une diffusion globale. */
  @IsNotEmpty()
  @IsString()
  userId: string;

  @IsNotEmpty({ message: 'Le titre est obligatoire' })
  @IsString()
  @MaxLength(160)
  title: string;

  @IsNotEmpty({ message: 'Le message est obligatoire' })
  @IsString()
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsEnum(RecommendationType, { message: 'Type de recommandation invalide' })
  type?: RecommendationType;

  @IsOptional()
  @IsEnum(RecommendationPriority, {
    message: 'Priorité de recommandation invalide',
  })
  priority?: RecommendationPriority;

  @IsOptional()
  @IsISO8601(
    {},
    { message: 'La date d’expiration doit être un instant ISO-8601' },
  )
  expiresAt?: string;
}

export class RecommendationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  /** Filtre « Envoyées » de la vue web : recommandations créées par ce compte. */
  @IsOptional()
  @IsString()
  createdById?: string;

  @IsOptional()
  @IsEnum(RecommendationType)
  type?: RecommendationType;

  @IsOptional()
  @IsEnum(RecommendationPriority)
  priority?: RecommendationPriority;

  @IsOptional()
  @IsIn(['true', 'false'])
  unread?: string;

  @IsOptional()
  @Type(() => String)
  @IsIn(['true', 'false'])
  unreadOnly?: string;
}
