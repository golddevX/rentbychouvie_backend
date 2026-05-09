import { Controller, Get, Param, Post, Body, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicService } from './public.service';
import { CreatePublicLeadDto } from './dto/create-public-lead.dto';

@ApiTags('Public')
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('products')
  @ApiOperation({ summary: 'List public storefront products' })
  async listProducts(
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.publicService.listProducts({ category, search, status });
  }

  @Get('products/:idOrSlug')
  @ApiOperation({ summary: 'Get public storefront product detail' })
  async getProduct(@Param('idOrSlug') idOrSlug: string) {
    return this.publicService.getProduct(idOrSlug);
  }

  @Get('products/:idOrSlug/availability')
  @ApiOperation({ summary: 'Get public storefront product availability' })
  async getAvailability(
    @Param('idOrSlug') idOrSlug: string,
    @Query('pickupDate') pickupDate?: string,
    @Query('returnDate') returnDate?: string,
  ) {
    return this.publicService.getProductAvailability(idOrSlug, pickupDate, returnDate);
  }

  @Get('client-settings')
  @ApiOperation({ summary: 'Get public client settings for storefront rendering' })
  async getClientSettings() {
    return this.publicService.getClientSettings();
  }

  @Post('leads')
  @ApiOperation({ summary: 'Create lead from public storefront checkout' })
  @ApiBody({ type: CreatePublicLeadDto })
  async createLead(@Body() body: CreatePublicLeadDto) {
    return this.publicService.createLead(body);
  }
}
