import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';
import { ConfirmPickupDto, PickupScanDto } from './dto/pickup.dto';
import { PickupService } from './pickup.service';

@ApiTags('Pickup')
@ApiBearerAuth()
@Controller('pickup')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PickupController {
  constructor(private readonly pickupService: PickupService) {}

  @Post(':bookingId/scan')
  @Roles(UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Scan pickup item for booking',
    description: 'Validates one scanned QR code against the physical items expected by the booking.',
  })
  @ApiBody({ type: PickupScanDto })
  @ApiOkResponse({
    schema: {
      example: {
        bookingId: 'clu7book0000008l49ra8vg12',
        matched: true,
        message: 'QR matches an expected pickup item',
        scannedItem: { qrCode: 'QR-DRS-RED-M-0001', productName: 'Red Dress' },
      },
    },
  })
  async scan(@Param('bookingId') bookingId: string, @Body() body: PickupScanDto) {
    return this.pickupService.scan(bookingId, body.qrCode);
  }

  @Post(':bookingId/confirm')
  @Roles(UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Confirm customer pickup',
    description: 'Requires all expected QR codes. Marks booking PICKED_UP, rental PICKED_UP, and inventory RENTED.',
  })
  @ApiBody({ type: ConfirmPickupDto })
  async confirm(
    @Param('bookingId') bookingId: string,
    @Body() body: ConfirmPickupDto,
    @CurrentUser() user: any,
  ) {
    return this.pickupService.confirm(
      bookingId,
      body.qrCodes,
      user?.id ?? user?.sub,
      body.conditionNotes,
    );
  }
}
