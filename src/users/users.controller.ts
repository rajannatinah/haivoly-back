import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { DefinirRattachementDto } from './dto/rattachement.dto';
import { RechercheUtilisateursQueryDto } from './dto/recherche-utilisateurs.dto';
import { CreerCompteDto } from '../auth/dto/creer-compte.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auth: AuthService,
  ) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findById(user.id);
  }

  @Patch('me')
  update(
    @Body() dto: UpdateProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Get('search')
  @Roles(Role.PROPRIETAIRE)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  rechercher(
    @Query() query: RechercheUtilisateursQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.rechercherDestinataires(query, user.id);
  }

  @Get()
  @Roles(Role.PROPRIETAIRE)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    // Vue d'administration : tous les comptes du périmètre, y compris ceux
    // en attente d'activation.
    return this.usersService.listerUtilisateurs(user.id);
  }

  @Post('creer-compte')
  @Roles(Role.PROPRIETAIRE)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  creerCompte(
    @Body() dto: CreerCompteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auth.creerCompteParResponsable(dto, user);
  }

  /** Renvoie le message d'activation d'un compte jamais initialisé. */
  @Post(':id/relancer-activation')
  @Roles(Role.PROPRIETAIRE)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async relancerActivation(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Le relanceur ne peut agir que dans son propre périmètre.
    const portee = await this.usersService.porteeDeConsultation(user.id);
    if (!portee.includes(id)) {
      return { envoye: false, autorise: false };
    }

    const resultat = await this.auth.relancerActivation(id);
    return { ...resultat, autorise: true };
  }

  /** Rattache un agriculteur au propriétaire appelant (ou le détache). */
  @Patch(':id/rattachement')
  @Roles(Role.PROPRIETAIRE)
  definirRattachement(
    @Param('id') id: string,
    @Body() dto: DefinirRattachementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Le propriétaire ne peut rattacher qu'à lui-même : on ignore toute valeur
    // reçue pour empêcher de transférer un agriculteur à un tiers.
    const cible =
      dto.proprietaireId === null || dto.proprietaireId === undefined
        ? null
        : user.id;
    return this.usersService.definirRattachement(id, cible);
  }
}
