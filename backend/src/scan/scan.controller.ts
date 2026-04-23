import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';

@ApiTags('Scan')
@ApiBearerAuth()
@Controller('scan')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ScanController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get(':qrCode')
  @Roles(UserRole.OPERATOR, UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Resolve scanned QR',
    description: 'Returns item info, current booking, and schedule. This is the generic scanner lookup used before pickup/return actions.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        item: {
          id: 'clu7inv0000008l4xj3g6fdj',
          qrCode: 'QR-DRS-RED-M-0001',
          productName: 'Red Dress',
          status: 'RENTED',
        },
        currentBooking: {
          id: 'clu7book0000008l49ra8vg12',
          status: 'PICKED_UP',
          customer: { name: 'Linh Nguyen', phone: '+84901234567' },
        },
        upcomingBookings: [],
      },
    },
  })
  async resolve(@Param('qrCode') qrCode: string) {
    return this.inventoryService.resolveQRCode(qrCode);
  }
}
