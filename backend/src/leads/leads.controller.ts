import { BadRequestException, Controller, Get, Post, Body, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LeadsService } from './leads.service';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';
import { LeadStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import {
  AssignLeadDto,
  ContactLeadDto,
  ConvertLeadToBookingDto,
  CreateLeadDto,
  ReceiveLeadDepositDto,
  RequestLeadDepositDto,
  SelectLeadProductDto,
  UpdateLeadDto,
  UpdateLeadStatusDto,
} from './dto/lead.dto';
import { LeadWorkflowService } from './lead-workflow.service';

@ApiTags('Lead')
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly leadWorkflowService: LeadWorkflowService,
  ) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List leads',
    description: 'Sales/admin lead pipeline. Lead is the first step in Lead -> Booking -> Payment -> Pickup -> Return.',
  })
  async findAll() {
    await this.leadWorkflowService.expirePendingDeposits();
    return this.leadsService.findAll();
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get lead by id' })
  async findById(@Param('id') id: string) {
    await this.leadWorkflowService.expirePendingDeposits();
    return this.leadsService.findById(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create lead',
    description: 'Public-friendly endpoint to capture a customer lead before a booking exists.',
  })
  @ApiBody({ type: CreateLeadDto })
  @ApiOkResponse({
    schema: {
      example: {
        id: 'clu7lead0000008l4c1jlav50',
        status: 'NEW',
        customer: {
          id: 'clu7cus0000008l4z2bqkhk9',
          name: 'Linh Nguyen',
          phone: '+84901234567',
        },
      },
    },
  })
  async create(@Body() body: CreateLeadDto) {
    return this.leadsService.create(body);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.SALES, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update lead details' })
  @ApiBody({ type: UpdateLeadDto })
  async update(@Param('id') id: string, @Body() body: UpdateLeadDto) {
    return this.leadsService.update(id, body);
  }

  @Patch(':id/status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.SALES, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Move lead to explicit status' })
  @ApiBody({ type: UpdateLeadStatusDto })
  async updateStatus(@Param('id') id: string, @Body() body: UpdateLeadStatusDto, @CurrentUser() user: any) {
    if (!Object.values(LeadStatus).includes(body.status as LeadStatus)) {
      throw new BadRequestException('Invalid lead status');
    }

    return this.leadWorkflowService.updateManualStatus(id, body.status as LeadStatus, user?.id ?? user?.sub);
  }

  @Post(':id/contact')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.SALES, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Record lead contact',
    description: 'Business operation endpoint. Marks the lead CONTACTED and stores contact notes.',
  })
  @ApiBody({ type: ContactLeadDto })
  async markContacted(@Param('id') id: string, @Body() body: ContactLeadDto, @CurrentUser() user: any) {
    return this.leadWorkflowService.markContacted(id, body.notes, user?.id ?? user?.sub);
  }

  @Post(':id/contacted')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.SALES, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Legacy alias for recording lead contact' })
  @ApiBody({ type: ContactLeadDto })
  async markContactedAlias(@Param('id') id: string, @Body() body: ContactLeadDto, @CurrentUser() user: any) {
    return this.leadWorkflowService.markContacted(id, body.notes, user?.id ?? user?.sub);
  }

  @Post(':id/request-deposit')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.SALES, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Request deposit from lead',
    description: 'Sets a deposit deadline. Inventory is not locked until a booking deposit is paid.',
  })
  @ApiBody({ type: RequestLeadDepositDto })
  async requestDeposit(
    @Param('id') id: string,
    @Body() body: RequestLeadDepositDto,
    @CurrentUser() user: any,
  ) {
    return this.leadWorkflowService.requestDeposit(id, body, user?.id ?? user?.sub);
  }

  @Post(':id/select-product')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.SALES, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Select a product for lead workflow',
    description: 'Stores product, variant, optional inventory item, rental dates, and appointment intent on the lead.',
  })
  @ApiBody({ type: SelectLeadProductDto })
  async selectProduct(
    @Param('id') id: string,
    @Body() body: SelectLeadProductDto,
    @CurrentUser() user: any,
  ) {
    return this.leadWorkflowService.selectProductForLead(id, body, user?.id ?? user?.sub);
  }

  @Post(':id/receive-deposit')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Receive lead deposit and auto-create appointment',
    description: 'Creates a booking_deposit payment, reserves inventory, and creates the next appointment from lead intent.',
  })
  @ApiBody({ type: ReceiveLeadDepositDto })
  async receiveDeposit(
    @Param('id') id: string,
    @Body() body: ReceiveLeadDepositDto,
    @CurrentUser() user: any,
  ) {
    return this.leadWorkflowService.receiveDeposit(id, body, user?.id ?? user?.sub);
  }

  @Post(':id/create-appointment')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.SALES, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create or recreate lead appointment from received deposit',
    description: 'Recovery endpoint for leads that already received deposit but need the appointment to be created again.',
  })
  async createAppointmentFromLead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.leadWorkflowService.createAppointmentFromLead(id, user?.id ?? user?.sub);
  }

  @Patch(':id/archive')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Archive lead' })
  async archive(@Param('id') id: string) {
    return this.leadsService.archive(id);
  }

  @Patch(':id/assign')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assign lead to staff' })
  @ApiBody({ type: AssignLeadDto })
  async assignTo(@Param('id') id: string, @Body() body: AssignLeadDto) {
    return this.leadsService.assignTo(id, body.userId);
  }

  @Post(':id/convert-to-booking')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.SALES, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Convert lead to booking',
    description: 'Creates or links a booking from an appointment-completed lead without bypassing workflow validation.',
  })
  @ApiBody({ type: ConvertLeadToBookingDto })
  async convertToBooking(
    @Param('id') id: string,
    @Body() body: ConvertLeadToBookingDto,
    @CurrentUser() user: any,
  ) {
    if (!body.bookingId) {
      return this.leadWorkflowService.createBookingFromLead(id, user?.id ?? user?.sub);
    }
    return this.leadWorkflowService.linkExistingBookingToLead(id, body.bookingId, user?.id ?? user?.sub);
  }
}
