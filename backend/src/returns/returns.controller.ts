import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';
import { InspectReturnDto, SettleReturnDto } from './dto/return.dto';
import { ReturnsService } from './returns.service';

@ApiTags('Return')
@ApiBearerAuth()
@Controller('return')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Post(':bookingId/inspect')
  @Roles(UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Inspect returned items',
    description: 'Stores return condition/images and returns a suggested fee from RentalPricingService.',
  })
  @ApiBody({ type: InspectReturnDto })
  @ApiOkResponse({
    schema: {
      example: {
        bookingId: 'clu7book0000008l49ra8vg12',
        condition: 'damaged',
        suggestedFee: 150000,
        pricingRule: 'Suggested by RentalPricingService based on return condition and declared damage.',
      },
    },
  })
  async inspect(
    @Param('bookingId') bookingId: string,
    @Body() body: InspectReturnDto,
    @CurrentUser() user: any,
  ) {
    return this.returnsService.inspect(bookingId, {
      ...body,
      inspectedById: user?.id ?? user?.sub,
    });
  }

  @Post(':bookingId/settle')
  @Roles(UserRole.OPERATOR, UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Settle returned booking',
    description:
      'Calculates late fee, damage fee, lost accessory fee, next-booking impact, total fees, and refundable deposit. Marks rental/booking completed.',
  })
  @ApiBody({ type: SettleReturnDto })
  @ApiOkResponse({
    schema: {
      example: {
        bookingId: 'clu7book0000008l49ra8vg12',
        settlement: {
          lateDays: 1,
          lateFee: 283334,
          damageFee: 150000,
          totalFees: 433334,
          refund: 665666,
        },
      },
    },
  })
  async settle(
    @Param('bookingId') bookingId: string,
    @Body() body: SettleReturnDto,
    @CurrentUser() user: any,
  ) {
    return this.returnsService.settle(bookingId, {
      ...body,
      returnedById: user?.id ?? user?.sub,
    });
  }
}
