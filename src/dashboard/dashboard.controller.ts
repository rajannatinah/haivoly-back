import { Controller, Get } from '@nestjs/common';

import { DashboardService } from './dashboard.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    // Correction : l'identifiant provient de la stratégie JWT (`user.id`),
    // et non de `user.sub` qui n'existe pas → les compteurs étaient faux.
    return this.dashboardService.getDashboard(user.id);
  }
}
