import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ReportsService } from './reports.service';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';
import { UserRole } from '@prisma/client';

@Controller('reports')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('revenue')
  async getDailyRevenue(@Query('date') date: string) {
    return this.reportsService.getDailyRevenue(date || new Date().toISOString().split('T')[0]);
  }

  @Get('inventory-status')
  async getInventoryStatus() {
    return this.reportsService.getInventoryStatus();
  }

  @Get('rental-analytics')
  async getRentalAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getRentalAnalytics(startDate, endDate);
  }

  @Get('lead-conversion')
  async getLeadConversionReport(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getLeadConversionReport(startDate, endDate);
  }

  @Get('staff-performance')
  async getStaffPerformance() {
    return this.reportsService.getStaffPerformance();
  }
}
