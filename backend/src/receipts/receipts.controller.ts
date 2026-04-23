import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ReceiptType, UserRole } from '@prisma/client';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';
import { ReceiptsService } from './receipts.service';

@Controller('receipts')
@UseGuards(AuthGuard('jwt'))
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get()
  async findAll(@Query('includeArchived') includeArchived?: string) {
    return this.receiptsService.findAll(includeArchived === 'true');
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.receiptsService.findById(id);
  }

  @Get(':id/pdf')
  async getPdf(@Param('id') id: string) {
    return this.receiptsService.getPdf(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async update(@Param('id') id: string, @Body() body: { type?: ReceiptType; pdfUrl?: string }) {
    return this.receiptsService.update(id, body);
  }

  @Post(':id/print')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async print(@Param('id') id: string) {
    return this.receiptsService.print(id);
  }

  @Patch(':id/archive')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async archive(@Param('id') id: string) {
    return this.receiptsService.archive(id);
  }
}
