import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ProductsService } from '../products/products.service';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';

@ApiTags('Scan')
@ApiBearerAuth()
@Controller('scan')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ScanController {
  constructor(private readonly productsService: ProductsService) {}

  @Get(':qrCode')
  @Roles(UserRole.OPERATOR, UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Resolve scanned QR',
    description: 'Returns product profile and booked slots. This scanner is used for walk-in product lookup and quick lead creation.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        product: {
          id: 'clu7inv0000008l4xj3g6fdj',
          code: 'DRS-RED-001',
          qrCode: 'QR-DRS-RED-001',
          name: 'Red Dress',
          status: 'RESERVED',
        },
        availability: {
          todayAvailable: false,
          reservedSlots: [],
        },
      },
    },
  })
  async resolve(@Param('qrCode') qrCode: string) {
    return this.productsService.resolveScanProfile(qrCode);
  }
}
