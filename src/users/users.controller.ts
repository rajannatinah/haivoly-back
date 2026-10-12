import { Body, Controller, Get, Param, Patch } from '@nestjs/common';

import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { DefinirRattachementDto } from './dto/rattachement.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findById(user.id);
  }

  /** Destinataires possibles d'une recommandation : réservé au propriétaire. */
  @Get()
  @Roles(Role.PROPRIETAIRE)
  findAll() {
    return this.usersService.listDestinataires();
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

  @Patch('me')
  update(
    @Body() dto: UpdateProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.updateProfile(user.id, dto);
  }
}
