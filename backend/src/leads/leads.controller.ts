import { BadRequestException, Controller, Get, Post, Body, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LeadsService } from './leads.service';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';
import { LeadStatus, UserRole } from '@prisma/client';
import {
  AssignLeadDto,
  ContactLeadDto,
  ConvertLeadToBookingDto,
  CreateLeadDto,
  RequestLeadDepositDto,
  UpdateLeadDto,
  UpdateLeadStatusDto,
} from './dto/lead.dto';

@ApiTags('Lead')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List leads',
    description: 'Sales/admin lead pipeline. Lead is the first step in Lead -> Booking -> Payment -> Pickup -> Return.',
  })
  async findAll() {
    return this.leadsService.findAll();
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get lead by id' })
  async findById(@Param('id') id: string) {
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
  async updateStatus(@Param('id') id: string, @Body() body: UpdateLeadStatusDto) {
    if (!Object.values(LeadStatus).includes(body.status as LeadStatus)) {
      throw new BadRequestException('Invalid lead status');
    }

    return this.leadsService.updateStatus(id, body.status as LeadStatus);
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
  async markContacted(@Param('id') id: string, @Body() body: ContactLeadDto) {
    return this.leadsService.markContacted(id, body.notes);
  }

  @Post(':id/contacted')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.SALES, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Legacy alias for recording lead contact' })
  @ApiBody({ type: ContactLeadDto })
  async markContactedAlias(@Param('id') id: string, @Body() body: ContactLeadDto) {
    return this.leadsService.markContacted(id, body.notes);
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
  async requestDeposit(@Param('id') id: string, @Body() body: RequestLeadDepositDto) {
    return this.leadsService.requestDeposit(id, body);
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
    description: 'Links the lead to an already-created booking and marks the lead BOOKING_CREATED.',
  })
  @ApiBody({ type: ConvertLeadToBookingDto })
  async convertToBooking(
    @Param('id') id: string,
    @Body() body: ConvertLeadToBookingDto,
  ) {
    return this.leadsService.convertToBooking(id, body.bookingId);
  }
}
