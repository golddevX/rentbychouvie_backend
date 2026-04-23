import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';
import { InventoryItemStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import {
  CalendarBlockDto,
  CreateInventoryItemDto,
  UpdateInventoryStatusDto,
} from './dto/inventory.dto';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory')
@UseGuards(AuthGuard('jwt'))
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('items')
  @ApiOperation({
    summary: 'List physical inventory items',
    description: 'Inventory is physical QR-coded stock. Availability for dates is handled by /bookings/availability.',
  })
  @ApiQuery({ name: 'productId', required: false })
  @ApiQuery({ name: 'status', enum: InventoryItemStatus, required: false })
  async findAllItems(
    @Query('productId') productId?: string,
    @Query('status') status?: string,
  ) {
    if (
      status &&
      !Object.values(InventoryItemStatus).includes(status as InventoryItemStatus)
    ) {
      throw new BadRequestException('Invalid inventory item status');
    }

    return this.inventoryService.findAllItems({
      productId,
      status: status as InventoryItemStatus | undefined,
    });
  }

  @Get('items/:id')
  @ApiOperation({ summary: 'Get inventory item by id' })
  async findItemById(@Param('id') id: string) {
    return this.inventoryService.findItemById(id);
  }

  @Get('qr/:code')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Find inventory item by active QR code' })
  async findByQRCode(@Param('code') code: string) {
    return this.inventoryService.findByQRCode(code);
  }

  @Get('qr/:code/resolve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Resolve QR code with booking context',
    description: 'Returns item, current booking, and upcoming schedule for staff scanners.',
  })
  async resolveQRCode(@Param('code') code: string) {
    return this.inventoryService.resolveQRCode(code);
  }

  @Get('items/:id/status')
  @ApiOperation({ summary: 'Get current item status and rental state' })
  async getItemStatus(@Param('id') id: string) {
    return this.inventoryService.getItemStatus(id);
  }

  @Get('items/:id/qr-image')
  @ApiOperation({ summary: 'Generate QR image data URL' })
  async getQRImage(@Param('id') id: string) {
    return this.inventoryService.generateQRCode(id);
  }

  @Get('items/:id/schedule')
  @ApiOperation({ summary: 'Get item schedule' })
  async getItemSchedule(@Param('id') id: string) {
    return this.inventoryService.getItemSchedule(id);
  }

  @Post('items')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create physical inventory item and QR code' })
  @ApiBody({ type: CreateInventoryItemDto })
  async createItem(@Body() body: CreateInventoryItemDto, @CurrentUser() user: any) {
    return this.inventoryService.createItem({
      ...body,
      actorId: user?.id ?? user?.sub,
    });
  }

  @Patch('items/:id/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update physical inventory status' })
  @ApiBody({ type: UpdateInventoryStatusDto })
  async updateItemStatus(
    @Param('id') id: string,
    @Body() body: UpdateInventoryStatusDto,
    @CurrentUser() user: any,
  ) {
    if (!Object.values(InventoryItemStatus).includes(body.status as InventoryItemStatus)) {
      throw new BadRequestException('Invalid inventory item status');
    }

    return this.inventoryService.updateItemStatus(
      id,
      body.status as InventoryItemStatus,
      body.notes,
      user?.id ?? user?.sub,
    );
  }

  @Patch('items/:id/regenerate-qr')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Rotate item QR code',
    description: 'Old QR codes are preserved as inactive previous codes so scans can explain that the QR was rotated.',
  })
  async regenerateQRCode(@Param('id') id: string, @CurrentUser() user: any) {
    return this.inventoryService.regenerateQRCode(id, user?.id ?? user?.sub);
  }

  @Patch('items/:id/archive')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Archive inventory item' })
  async archiveItem(@Param('id') id: string, @CurrentUser() user: any) {
    return this.inventoryService.archiveItem(id, user?.id ?? user?.sub);
  }

  @Post('calendar-block')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Block item dates',
    description: 'Use for maintenance or manual unavailability that should remove an item from scheduling.',
  })
  @ApiBody({ type: CalendarBlockDto })
  async blockDates(@Body() body: CalendarBlockDto) {
    return this.inventoryService.blockDates(
      body.inventoryItemId,
      body.startDate,
      body.endDate,
      body.reason,
    );
  }
}
