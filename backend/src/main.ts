import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const allowedOrigins = [
    process.env.CLIENT_URL,
    process.env.ADMIN_URL,
    'http://localhost:3000',
    'http://localhost:3002',
  ].filter((origin): origin is string => Boolean(origin));

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.setGlobalPrefix('api');

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Rental System API')
    .setDescription(
      [
        'Production rental operations API for the full flow: Lead -> Booking -> Payment -> Pickup -> Return -> Settlement.',
        'Use operation endpoints instead of generic CRUD when moving business state.',
        'Inventory is locked only after a booking deposit is completed; availability is date and variant aware.',
      ].join('\n\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addTag('Auth', 'JWT login, refresh, and logout.')
    .addTag('Users', 'Admin/staff/cashier user management.')
    .addTag('Lead', 'Lead capture, contact, deposit request, and conversion.')
    .addTag('Booking', 'Booking creation, confirmation, deposit locking, and availability.')
    .addTag('Payment', 'Payment records, gateway initialization, refunds, and receipts.')
    .addTag('Inventory', 'Physical inventory, QR codes, status, and calendar blocks.')
    .addTag('Pickup', 'Pickup scan validation and handover confirmation.')
    .addTag('Return', 'Return inspection, fee suggestion, and settlement.')
    .addTag('Audit & Disputes', 'Before/after audit trail and dispute case management.')
    .addTag('Scan', 'QR lookup for current booking and schedule.')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'method',
    },
    customSiteTitle: 'Rental System API Docs',
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Swagger docs running on http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
