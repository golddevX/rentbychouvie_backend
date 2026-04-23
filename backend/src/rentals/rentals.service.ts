import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { BookingStatus, PaymentMethod, PaymentStatus, PaymentType, Prisma, RentalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RentalPricingService } from '../pricing/rental-pricing.service';

@Injectable()
export class RentalsService {
  constructor(
    private prisma: PrismaService,
    private pricingService: RentalPricingService,
  ) {}

  async findAll(filters?: { status?: RentalStatus }) {
    const where: Prisma.RentalWhereInput | undefined = filters;

    return this.prisma.rental.findMany({
      where,
      include: {
        booking: {
          include: {
            customer: true,
            items: {
              include: { product: true, inventoryItem: true },
            },
          },
        },
        inventoryItems: {
          include: { product: true },
        },
        pickedUpBy: {
          select: { id: true, fullName: true },
        },
        returnedBy: {
          select: { id: true, fullName: true },
        },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const rental = await this.prisma.rental.findUnique({
      where: { id },
      include: {
        booking: {
          include: {
            customer: true,
            items: {
              include: { product: true, inventoryItem: true },
            },
          },
        },
        inventoryItems: {
          include: { product: true },
        },
        pickedUpBy: true,
        returnedBy: true,
        payments: true,
      },
    });

    if (!rental) {
      throw new NotFoundException('Rental not found');
    }

    return rental;
  }

  async createFromBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        items: {
          include: { inventoryItem: true },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Create payment for rental
    const totalPrice = booking.totalPrice;

    const rental = await this.prisma.rental.create({
      data: {
        bookingId,
        status: RentalStatus.PENDING_PAYMENT,
        scheduledPickupDate: booking.startDate,
        scheduledReturnDate: booking.endDate,
        inventoryItems: {
          connect: booking.items.map((item) => ({
            id: item.inventoryItem.id,
          })),
        },
      },
      include: {
        booking: true,
        inventoryItems: true,
      },
    });

    // Create payment record
    await this.prisma.payment.create({
      data: {
        rentalId: rental.id,
        type: PaymentType.RENTAL_PAYMENT,
        amount: totalPrice,
        rentalAmount: totalPrice,
        paymentMethod: PaymentMethod.PENDING,
        status: PaymentStatus.PENDING,
      },
    });

    return rental;
  }

  async processPickup(
    rentalId: string,
    qrCodes: string[],
    pickedUpById: string,
    conditionNotes?: string,
  ) {
    const rental = await this.findById(rentalId);

    if (!['CONFIRMED', 'PICKED_UP'].includes(rental.status)) {
      throw new BadRequestException('Rental must be confirmed before pickup');
    }

    // Verify all items match
    const items = await Promise.all(
      qrCodes.map((code) =>
        this.prisma.inventoryItem.findUnique({ where: { qrCode: code } }),
      ),
    );

    if (items.some((item) => !item)) {
      throw new BadRequestException('One or more items not found');
    }
    const expectedItemIds = new Set(rental.inventoryItems.map((item) => item.id));
    const scannedItemIds = new Set(items.map((item) => item!.id));
    if (
      expectedItemIds.size !== scannedItemIds.size ||
      [...expectedItemIds].some((id) => !scannedItemIds.has(id))
    ) {
      throw new BadRequestException('Scanned QR does not match the expected booking items');
    }

    const updated = await this.prisma.rental.update({
      where: { id: rentalId },
      data: {
        status: RentalStatus.PICKED_UP,
        actualPickupDate: new Date(),
        pickedUpById,
        pickupConditionNotes: conditionNotes,
      },
    });

    await this.prisma.booking.update({
      where: { id: rental.bookingId },
      data: { status: BookingStatus.PICKED_UP },
    }).catch(() => undefined);
    await this.prisma.inventoryItem.updateMany({
      where: { id: { in: [...expectedItemIds] } },
      data: { status: 'RENTED' },
    });

    return updated;
  }

  async calculateReturnSettlement(
    rentalId: string,
    input: {
      condition?: 'clean' | 'dirty' | 'damaged' | 'incomplete';
      actualReturnDate?: string;
      accessoryLostValues?: number[];
      affectsNextBooking?: boolean;
    },
  ) {
    const rental = await this.findById(rentalId);
    const actualReturnDate = input.actualReturnDate ? new Date(input.actualReturnDate) : new Date();
    const booking = rental.booking;
    const accessoryLostFee = (input.accessoryLostValues ?? []).reduce((sum, value) => sum + Math.max(Number(value || 0), 0), 0);

    let nextBookingImpactFee = 0;
    if (input.affectsNextBooking) {
      const nextBooking = await this.prisma.bookingItem.findFirst({
        where: {
          inventoryItemId: { in: rental.inventoryItems.map((item) => item.id) },
          bookingId: { not: booking.id },
          booking: {
            archivedAt: null,
            startDate: { gte: rental.scheduledReturnDate },
            status: { in: [BookingStatus.CONFIRMED, BookingStatus.SCHEDULED_PICKUP] },
          },
        },
        include: { booking: true },
        orderBy: { booking: { startDate: 'asc' } },
      });
      nextBookingImpactFee = Number(nextBooking?.booking.totalPrice ?? 0);
    }

    const settlement = this.pricingService.calculateSettlement({
      scheduledReturnDate: rental.scheduledReturnDate,
      actualReturnDate,
      totalPrice: Number(booking.totalPrice || 0),
      rentalDays: Number(booking.rentalDays || 1),
      securityDepositHeld: Number(booking.securityDepositHeld || 0),
      condition: input.condition ?? 'clean',
      accessoryLostFee,
      nextBookingImpactFee,
    });

    return {
      lateDays: settlement.lateDays,
      lateFee: settlement.lateFee,
      dirtyHold: settlement.cleaningHold,
      dirtyHoldReleaseHours: settlement.cleaningHold > 0 ? 24 : 0,
      accessoryLostFee,
      nextBookingImpactFee,
      totalFees: settlement.totalFees,
      refundableSecurityDeposit: settlement.refund,
      notes: settlement.cleaningHold > 0 ? 'Hold 500k for 24h and refund if cleanable' : 'No cleaning hold required',
    };
  }

  async processReturn(
    rentalId: string,
    qrCodes: string[],
    returnedById: string,
    conditionNotes?: string,
    damageAmount?: number,
  ) {
    const rental = await this.findById(rentalId);

    if (!['PICKED_UP', 'IN_RENTAL'].includes(rental.status)) {
      throw new BadRequestException('Rental must be picked up before return');
    }

    // Verify items match
    const items = await Promise.all(
      qrCodes.map((code) =>
        this.prisma.inventoryItem.findUnique({ where: { qrCode: code } }),
      ),
    );

    if (items.some((item) => !item)) {
      throw new BadRequestException('One or more items not found');
    }
    const expectedItemIds = new Set(rental.inventoryItems.map((item) => item.id));
    const scannedItemIds = new Set(items.map((item) => item!.id));
    if ([...expectedItemIds].some((id) => !scannedItemIds.has(id))) {
      throw new BadRequestException('Returned QR does not match the expected booking items');
    }

    // Update rental
    const updatedRental = await this.prisma.rental.update({
      where: { id: rentalId },
      data: {
        status: RentalStatus.RETURNED,
        actualReturnDate: new Date(),
        returnedById,
        returnConditionNotes: conditionNotes,
        damageCost: damageAmount || 0,
      },
    });

    await this.prisma.booking.update({
      where: { id: rental.bookingId },
      data: { status: BookingStatus.RETURNED },
    }).catch(() => undefined);
    await this.prisma.inventoryItem.updateMany({
      where: { id: { in: [...expectedItemIds] } },
      data: { status: damageAmount && damageAmount > 0 ? 'DAMAGED' : 'AVAILABLE' },
    });

    // Update payment if there's damage
    if (damageAmount && damageAmount > 0) {
      const payment = rental.payments[0];
      if (payment) {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            damageAmount,
            amount: payment.rentalAmount + damageAmount,
          },
        });
      }
    }

    return updatedRental;
  }

  async confirmPayment(rentalId: string) {
    return this.prisma.rental.update({
      where: { id: rentalId },
      data: { status: RentalStatus.CONFIRMED },
    });
  }

  async completeRental(rentalId: string) {
    return this.prisma.rental.update({
      where: { id: rentalId },
      data: { status: RentalStatus.COMPLETED },
    });
  }

  async markAsInRental(rentalId: string) {
    return this.prisma.rental.update({
      where: { id: rentalId },
      data: { status: RentalStatus.IN_RENTAL },
    });
  }
}
