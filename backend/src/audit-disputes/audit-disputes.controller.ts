import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DisputePriority, DisputeStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';
import {
  AddEvidenceDto,
  CreateDisputeDto,
  ResolveDisputeDto,
  UpdateDisputeDto,
} from './dto/audit-dispute.dto';
import { AuditDisputesService } from './audit-disputes.service';

@ApiTags('Audit & Disputes')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AuditDisputesController {
  constructor(private readonly auditDisputesService: AuditDisputesService) {}

  @Get('audit-logs')
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'List audit logs',
    description: 'Append-only operational audit trail with before/after payloads and links to booking, payment, inventory, return, and dispute work.',
  })
  @ApiQuery({ name: 'entity', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'bookingId', required: false })
  @ApiQuery({ name: 'paymentId', required: false })
  @ApiQuery({ name: 'inventoryItemId', required: false })
  async findAuditLogs(
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('bookingId') bookingId?: string,
    @Query('paymentId') paymentId?: string,
    @Query('inventoryItemId') inventoryItemId?: string,
  ) {
    return this.auditDisputesService.findAuditLogs({
      entity,
      entityId,
      bookingId,
      paymentId,
      inventoryItemId,
    });
  }

  @Get('disputes')
  @Roles(UserRole.OPERATOR, UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'List disputes',
    description: 'Case-management queue for rental, return, payment, refund, and inventory disputes.',
  })
  @ApiQuery({ name: 'status', enum: DisputeStatus, required: false })
  @ApiQuery({ name: 'priority', enum: DisputePriority, required: false })
  @ApiQuery({ name: 'bookingId', required: false })
  async findDisputes(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('bookingId') bookingId?: string,
  ) {
    if (status && !Object.values(DisputeStatus).includes(status as DisputeStatus)) {
      throw new BadRequestException('Invalid dispute status');
    }
    if (priority && !Object.values(DisputePriority).includes(priority as DisputePriority)) {
      throw new BadRequestException('Invalid dispute priority');
    }

    return this.auditDisputesService.findDisputes({ status, priority, bookingId });
  }

  @Get('disputes/:id')
  @Roles(UserRole.OPERATOR, UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Get dispute workspace',
    description: 'Returns dispute details, evidence, linked operational context, and related audit trail.',
  })
  async findDisputeById(@Param('id') id: string) {
    return this.auditDisputesService.findDisputeById(id);
  }

  @Post('disputes')
  @Roles(UserRole.OPERATOR, UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Open dispute case' })
  @ApiBody({ type: CreateDisputeDto })
  async createDispute(@Body() body: CreateDisputeDto, @CurrentUser() user: any) {
    return this.auditDisputesService.createDispute({
      ...body,
      createdById: user?.id ?? user?.sub,
    });
  }

  @Patch('disputes/:id')
  @Roles(UserRole.OPERATOR, UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update dispute triage fields' })
  @ApiBody({ type: UpdateDisputeDto })
  async updateDispute(
    @Param('id') id: string,
    @Body() body: UpdateDisputeDto,
    @CurrentUser() user: any,
  ) {
    return this.auditDisputesService.updateDispute(id, {
      ...body,
      actorId: user?.id ?? user?.sub,
    });
  }

  @Post('disputes/:id/evidence')
  @Roles(UserRole.OPERATOR, UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Attach dispute evidence',
    description: 'Stores evidence metadata and immutable file URL references. Object storage can provide the actual file URL.',
  })
  @ApiBody({ type: AddEvidenceDto })
  async addEvidence(
    @Param('id') id: string,
    @Body() body: AddEvidenceDto,
    @CurrentUser() user: any,
  ) {
    return this.auditDisputesService.addEvidence(id, {
      ...body,
      uploadedById: user?.id ?? user?.sub,
    });
  }

  @Post('disputes/:id/resolve')
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Resolve dispute',
    description: 'Manager-only resolution step that records outcome, approved adjustment, final rationale, and audit before/after.',
  })
  @ApiBody({ type: ResolveDisputeDto })
  async resolveDispute(
    @Param('id') id: string,
    @Body() body: ResolveDisputeDto,
    @CurrentUser() user: any,
  ) {
    return this.auditDisputesService.resolveDispute(id, {
      ...body,
      resolvedById: user?.id ?? user?.sub,
    });
  }
}
