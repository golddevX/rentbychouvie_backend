import { Module } from '@nestjs/common';
import { RentalPricingService } from './rental-pricing.service';

@Module({
  providers: [RentalPricingService],
  exports: [RentalPricingService],
})
export class PricingModule {}
