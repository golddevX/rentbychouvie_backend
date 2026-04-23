import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LeadsModule } from './leads/leads.module';
import { ProductsModule } from './products/products.module';
import { BookingsModule } from './bookings/bookings.module';
import { InventoryModule } from './inventory/inventory.module';
import { PaymentsModule } from './payments/payments.module';
import { RentalsModule } from './rentals/rentals.module';
import { ReportsModule } from './reports/reports.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { PreviewRequestsModule } from './preview-requests/preview-requests.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { SiteSettingsModule } from './site-settings/site-settings.module';
import { RentalOrdersModule } from './rental-orders/rental-orders.module';
import { HealthController } from './health.controller';
import { PricingModule } from './pricing/pricing.module';
import { PickupModule } from './pickup/pickup.module';
import { ReturnsModule } from './returns/returns.module';
import { ScanModule } from './scan/scan.module';
import { AuditDisputesModule } from './audit-disputes/audit-disputes.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    LeadsModule,
    ProductsModule,
    BookingsModule,
    InventoryModule,
    PaymentsModule,
    RentalsModule,
    ReportsModule,
    AppointmentsModule,
    PreviewRequestsModule,
    ReceiptsModule,
    SiteSettingsModule,
    RentalOrdersModule,
    PricingModule,
    PickupModule,
    ReturnsModule,
    ScanModule,
    AuditDisputesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
