import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AppointmentStatus, AppointmentType, UserRole } from '@prisma/client';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';
import { AppointmentsService } from './appointments.service';

@Controller('appointments')
@UseGuards(AuthGuard('jwt'))
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  async findAll(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('staffId') staffId?: string,
    @Query('lifecycleStatus') lifecycleStatus?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    if (status && !Object.values(AppointmentStatus).includes(status as AppointmentStatus)) {
      throw new BadRequestException('Invalid appointment status');
    }
    if (type && !Object.values(AppointmentType).includes(type as AppointmentType)) {
      throw new BadRequestException('Invalid appointment type');
    }

    return this.appointmentsService.findAll({
      status: status as AppointmentStatus | undefined,
      type: type as AppointmentType | undefined,
      staffId,
      lifecycleStatus,
      includeArchived: includeArchived === 'true',
    });
  }

  @Get('availability/query')
  async getAvailability(
    @Query('startTime') startTime: string,
    @Query('endTime') endTime: string,
    @Query('staffId') staffId?: string,
    @Query('room') room?: string,
    @Query('resourceItemId') resourceItemId?: string,
  ) {
    if (!startTime || !endTime) {
      throw new BadRequestException('startTime and endTime are required');
    }
    return this.appointmentsService.getAvailability({
      startTime,
      endTime,
      staffId,
      room,
      resourceItemId,
    });
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.appointmentsService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SALES, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async create(@Body() body: any) {
    return this.appointmentsService.create(body);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SALES, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async update(@Param('id') id: string, @Body() body: any) {
    return this.appointmentsService.update(id, body);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SALES, UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    if (!Object.values(AppointmentStatus).includes(body.status as AppointmentStatus)) {
      throw new BadRequestException('Invalid appointment status');
    }

    return this.appointmentsService.updateStatus(id, body.status as AppointmentStatus);
  }

  @Patch(':id/archive')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async archive(@Param('id') id: string) {
    return this.appointmentsService.archive(id);
  }
}
