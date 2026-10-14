import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmailOutbox } from './mail-outbox.entity';
import { MailOutboxService } from './mail-outbox.service';
import { MailTransportService } from './mail-transport.service';
import { NotificationsMailService } from './notifications-mail.service';

@Module({
  imports: [TypeOrmModule.forFeature([EmailOutbox])],
  providers: [
    MailTransportService,
    MailOutboxService,
    NotificationsMailService,
  ],
  exports: [MailTransportService, MailOutboxService, NotificationsMailService],
})
export class MailModule {}
