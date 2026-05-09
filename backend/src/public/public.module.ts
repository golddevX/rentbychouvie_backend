import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { SiteSettingsModule } from '../site-settings/site-settings.module';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  imports: [PrismaModule, ProductsModule, LeadsModule, SiteSettingsModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
