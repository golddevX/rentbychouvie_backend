import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PreviewRequestStatus, UserRole } from '@prisma/client';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';
import { PreviewRequestsService } from './preview-requests.service';

@Controller('preview-requests')
@UseGuards(AuthGuard('jwt'))
export class PreviewRequestsController {
  constructor(private readonly previewRequestsService: PreviewRequestsService) {}

  @Get()
  async findAll(
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    if (status && !Object.values(PreviewRequestStatus).includes(status as PreviewRequestStatus)) {
      throw new BadRequestException('Invalid preview request status');
    }

    return this.previewRequestsService.findAll({
      status: status as PreviewRequestStatus | undefined,
      assignedToId,
      includeArchived: includeArchived === 'true',
    });
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.previewRequestsService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SALES, UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async create(@Body() body: any) {
    return this.previewRequestsService.create(body);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SALES, UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async update(@Param('id') id: string, @Body() body: any) {
    return this.previewRequestsService.update(id, body);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SALES, UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    if (!Object.values(PreviewRequestStatus).includes(body.status as PreviewRequestStatus)) {
      throw new BadRequestException('Invalid preview request status');
    }

    return this.previewRequestsService.updateStatus(id, body.status as PreviewRequestStatus);
  }

  @Patch(':id/archive')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async archive(@Param('id') id: string) {
    return this.previewRequestsService.archive(id);
  }
}
