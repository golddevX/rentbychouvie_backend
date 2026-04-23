import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PreviewRequestsController } from './preview-requests.controller';
import { PreviewRequestsService } from './preview-requests.service';

@Module({
  imports: [PrismaModule],
  controllers: [PreviewRequestsController],
  providers: [PreviewRequestsService],
  exports: [PreviewRequestsService],
})
export class PreviewRequestsModule {}
