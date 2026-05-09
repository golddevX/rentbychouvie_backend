import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, BookingStatus, InventoryItemStatus, ProductStatus, RentalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RentalPricingService, ReturnCondition } from '../pricing/rental-pricing.service';
import { AuditDisputesService } from '../audit-disputes/audit-disputes.service';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class ReturnsService {
  constructor(
    private prisma: PrismaService,
    private pricingService: RentalPricingService,
    private auditDisputesService: AuditDisputesService,
    private paymentsService: PaymentsService,
  ) {}

  private async findRentalByBooking(bookingId: string) {
    const rental = await this.prisma.rental.findUnique({
      where: { bookingId },
      include: {
        booking: {
          include: {
            customer: true,
            handoverRecord: true,
            lead: {
              include: {
                product: true,
                inventoryItem: {
                  include: {
                    product: true,
                    variant: true,
                  },
                },
                items: {
                  include: {
                    product: true,
                    inventoryItem: {
                      include: {
                        product: true,
                        variant: true,
                      },
                    },
                  },
                },
              },
            },
            items: {
              include: {
                product: true,
                variant: true,
                inventoryItem: {
                  include: {
                    product: true,
                    variant: true,
                  },
                },
              },
            },
          },
        },
        inventoryItems: true,
        payments: true,
        returnInspections: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!rental) throw new NotFoundException('Rental not found for booking');
    return rental;
  }

  private mapConditionFromSummary(
    condition: ReturnCondition,
  ): 'good' | 'dirty' | 'damaged' | 'missing_accessory' | 'missing_item' {
    if (condition === 'dirty') return 'dirty';
    if (condition === 'damaged') return 'damaged';
    if (condition === 'incomplete') return 'missing_accessory';
    return 'good';
  }

  private buildSettlementPreview(input: {
    securityDepositPaid: number;
    existingRefunds?: number;
    rentalOutstanding?: number;
    applyRentalToDeposit?: boolean;
    lateFee: number;
    dirtyFee: number;
    damageFee: number;
    accessoryFee: number;
    otherFee: number;
  }) {
    const totalCharges =
      Math.max(Number(input.lateFee || 0), 0)
      + Math.max(Number(input.dirtyFee || 0), 0)
      + Math.max(Number(input.damageFee || 0), 0)
      + Math.max(Number(input.accessoryFee || 0), 0)
      + Math.max(Number(input.otherFee || 0), 0);
    const depositRemaining =
      Math.max(Number(input.securityDepositPaid || 0), 0)
      - Math.max(Number(input.existingRefunds || 0), 0);
    const rentalOutstanding = Math.max(Number(input.rentalOutstanding || 0), 0);
    const applyRentalToDeposit = input.applyRentalToDeposit !== false;
    const depositAfterFees = Math.max(depositRemaining - totalCharges, 0);
    return {
      totalCharges,
      applyRentalToDeposit,
      refundNow: applyRentalToDeposit
        ? Math.max(depositAfterFees - rentalOutstanding, 0)
        : depositAfterFees,
      amountDueFromCustomer: applyRentalToDeposit
        ? Math.max(totalCharges + rentalOutstanding - depositRemaining, 0)
        : Math.max(totalCharges - depositRemaining, 0),
    };
  }

  private bookingProducts(rental: Awaited<ReturnType<ReturnsService['findRentalByBooking']>>) {
    if (rental.booking.items.length > 0) {
      return rental.booking.items.map((item) => ({
        id: item.inventoryItemId ?? item.productId,
        inventoryItemId: item.inventoryItemId ?? item.inventoryItem?.id ?? null,
        productId: item.productId,
        name: item.product?.name ?? item.inventoryItem?.product?.name ?? '-',
        qrCode: item.inventoryItem?.qrCode ?? (item.product as any)?.qrCode ?? item.productId,
        status: item.inventoryItem?.status ?? 'AVAILABLE',
      }));
    }
    const leadItems = (rental.booking.lead?.items ?? []).filter((item) => String(item.status ?? '').toUpperCase() !== 'REMOVED');
    if (leadItems.length > 0) {
      return leadItems.map((item) => ({
        id: item.inventoryItemId ?? item.productId,
        inventoryItemId: item.inventoryItemId ?? item.inventoryItem?.id ?? null,
        productId: item.productId,
        name: item.product?.name ?? item.inventoryItem?.product?.name ?? '-',
        qrCode: item.inventoryItem?.qrCode ?? (item.product as any)?.qrCode ?? item.productId,
        status: item.inventoryItem?.status ?? 'AVAILABLE',
      }));
    }
    return rental.booking.lead?.inventoryItem
      ? [{
          id: rental.booking.lead.inventoryItem.id,
          inventoryItemId: rental.booking.lead.inventoryItem.id,
          productId: rental.booking.lead.productId ?? rental.booking.lead.inventoryItem.productId,
          name: rental.booking.lead.product?.name ?? rental.booking.lead.inventoryItem.product.name,
          qrCode: rental.booking.lead.inventoryItem.qrCode,
          status: rental.booking.lead.inventoryItem.status,
        }]
      : [];
  }

  private expectedProducts(rental: Awaited<ReturnType<ReturnsService['findRentalByBooking']>>) {
    return this.bookingProducts(rental).map((product) => ({
      id: product.id,
      inventoryItemId: product.inventoryItemId,
      productId: product.productId,
      qrCode: product.qrCode || product.id,
      name: product.name,
    }));
  }

  private resolveReturnedItems(
    expectedProducts: Array<{
      id: string;
      inventoryItemId: string | null;
      productId: string;
      qrCode: string;
      name: string;
    }>,
    items: Array<{
      inventoryItemId: string;
      condition: 'good' | 'dirty' | 'damaged' | 'missing_accessory' | 'missing_item';
      images?: string[];
      damageFee?: number;
      accessoryFee?: number;
    }>,
  ) {
    const expectedByAnyKey = new Map<string, (typeof expectedProducts)[number]>();
    for (const product of expectedProducts) {
      expectedByAnyKey.set(product.id, product);
      if (product.inventoryItemId) {
        expectedByAnyKey.set(product.inventoryItemId, product);
      }
    }

    return items.map((item) => {
      const matched = expectedByAnyKey.get(item.inventoryItemId);
      if (!matched) {
        throw new BadRequestException(`Returned item ${item.inventoryItemId} does not belong to this booking`);
      }
      return {
        ...item,
        expectedId: matched.id,
        resolvedInventoryItemId: matched.inventoryItemId,
        productId: matched.productId,
        productName: matched.name,
      };
    });
  }

  async inspect(
    bookingId: string,
    input: {
      condition: ReturnCondition;
      images: string[];
      notes?: string;
      declaredDamageFee?: number;
      inspectedById?: string;
      items?: Array<{
        inventoryItemId: string;
        condition: 'good' | 'dirty' | 'damaged' | 'missing_accessory' | 'missing_item';
        images?: string[];
        damageFee?: number;
        accessoryFee?: number;
      }>;
    },
  ) {
    const rental = await this.findRentalByBooking(bookingId);
    const expectedProducts = this.expectedProducts(rental);
    const itemInspectionsInput = input.items?.length
      ? input.items
      : expectedProducts.map((product) => ({
          inventoryItemId: product.id,
          condition: this.mapConditionFromSummary(input.condition),
          images: input.images,
          damageFee: input.declaredDamageFee,
          accessoryFee: 0,
        }));
    const itemInspections = this.resolveReturnedItems(expectedProducts, itemInspectionsInput);
    const suggestedFee = itemInspections.reduce((sum, item) => {
      const baseCondition =
        item.condition === 'dirty'
          ? 'dirty'
          : item.condition === 'damaged'
            ? 'damaged'
            : item.condition === 'missing_accessory' || item.condition === 'missing_item'
              ? 'incomplete'
              : 'clean';
      return sum + this.pricingService.suggestDamageFee(baseCondition as ReturnCondition, item.damageFee);
    }, 0);

    const inspection = await this.prisma.returnInspection.create({
      data: {
        rentalId: rental.id,
        condition: input.condition,
        imageUrls: JSON.stringify(input.images),
        notes: input.notes,
        suggestedFee,
        inspectedById: input.inspectedById,
      },
    });

    for (const item of itemInspections) {
      await this.prisma.bookingItem.updateMany({
        where: {
          bookingId: rental.bookingId,
          ...(item.resolvedInventoryItemId
            ? { inventoryItemId: item.resolvedInventoryItemId }
            : { inventoryItemId: null, productId: item.productId }),
        },
        data: {
          returnImages: JSON.stringify(item.images ?? []),
          condition:
            item.condition === 'dirty'
              ? 'DIRTY'
              : item.condition === 'damaged'
                ? 'DAMAGED'
                : item.condition === 'missing_accessory'
                  ? 'MISSING_ACCESSORY'
                  : item.condition === 'missing_item'
                    ? 'MISSING_ITEM'
                    : 'GOOD',
        } as any,
      });
    }

    await this.auditDisputesService.log({
      action: AuditAction.RETURN_INSPECTED,
      entity: 'ReturnInspection',
      entityId: inspection.id,
      bookingId,
      rentalId: rental.id,
      returnInspectionId: inspection.id,
      actorId: input.inspectedById,
      summary: `Inspected return as ${input.condition}`,
      before: rental.returnInspections[0] ?? null,
      after: inspection,
      metadata: {
        suggestedFee,
        imageCount: input.images.length,
        itemCount: itemInspections.length,
      },
    });

    return {
      bookingId,
      rentalId: rental.id,
      condition: input.condition,
      suggestedFee,
      inspection,
      pricingRule: 'Uses manually entered damage fees only. No automatic condition-based damage fee is applied.',
    };
  }

  async settle(
    bookingId: string,
    input: {
      condition: ReturnCondition;
      actualReturnDate?: string;
      lateFee?: number;
      dirtyFee?: number;
      otherFee?: number;
      notes?: string;
      returnedById?: string;
      applyRentalToDeposit?: boolean;
      items: Array<{
        inventoryItemId: string;
        condition: 'good' | 'dirty' | 'damaged' | 'missing_accessory' | 'missing_item';
        images?: string[];
        damageFee?: number;
        accessoryFee?: number;
      }>;
    },
  ) {
    const rental = await this.findRentalByBooking(bookingId);
    const returnReadyStatuses: RentalStatus[] = [RentalStatus.PICKED_UP, RentalStatus.IN_RENTAL, RentalStatus.RETURNED];
    const bookingReadyStatuses: BookingStatus[] = [BookingStatus.PICKED_UP, BookingStatus.RETURN_PENDING, BookingStatus.RETURNED];
    if (!returnReadyStatuses.includes(rental.status) || !bookingReadyStatuses.includes(rental.booking.status)) {
      throw new BadRequestException('Rental must be picked up before settlement');
    }

    const expectedProducts = this.expectedProducts(rental);
    if (!expectedProducts.length) {
      throw new BadRequestException('Booking does not have products ready for return settlement');
    }
    const resolvedItems = this.resolveReturnedItems(expectedProducts, input.items);
    const returnedExpectedIds = new Set(resolvedItems.map((item) => item.expectedId));
    const missingProducts = expectedProducts.filter((product) => !returnedExpectedIds.has(product.id));
    if (missingProducts.length > 0) {
      throw new BadRequestException(`Returned products are missing: ${missingProducts.map((product) => product.name).join(', ')}`);
    }

    const accessoryLostFee = input.items.reduce(
      (sum, item) => sum + Math.max(Number(item.accessoryFee || 0), 0),
      0,
    );
    const actualReturnDate = input.actualReturnDate ? new Date(input.actualReturnDate) : new Date();
    const bookingSummary = await this.paymentsService.getPaymentSummaryForBooking(bookingId);
    const late = this.pricingService.calculateLateFee({
      expectedReturnDate: rental.scheduledReturnDate,
      actualReturnDate,
    });
    const lateFee = Math.max(Number(input.lateFee ?? late.lateFee), 0);
    const damageFee = resolvedItems.reduce((sum, item) => {
      const mappedCondition =
        item.condition === 'dirty'
          ? 'dirty'
          : item.condition === 'damaged'
            ? 'damaged'
            : item.condition === 'missing_accessory' || item.condition === 'missing_item'
              ? 'incomplete'
              : 'clean';
      return sum + this.pricingService.suggestDamageFee(mappedCondition as ReturnCondition, item.damageFee);
    }, 0);
    const dirtyFee = Math.max(Number(input.dirtyFee || 0), 0);
    const otherFee = Math.max(Number(input.otherFee || 0), 0);
    const settlement = this.buildSettlementPreview({
      securityDepositPaid: Number(bookingSummary.securityDepositPaid || 0),
      existingRefunds: Number(bookingSummary.refundsTotal || 0),
      rentalOutstanding: Number(bookingSummary.rentalOutstandingAtReturn || bookingSummary.rentalRemaining || 0),
      applyRentalToDeposit: input.applyRentalToDeposit,
      lateFee,
      dirtyFee,
      damageFee,
      accessoryFee: accessoryLostFee,
      otherFee,
    });
    const settlementDraft = {
      version: 1 as const,
      status:
        settlement.totalCharges > 0
        || Number(bookingSummary.securityDepositPaid || 0) > Number(bookingSummary.refundsTotal || 0)
        || Number(bookingSummary.rentalOutstandingAtReturn || bookingSummary.rentalRemaining || 0) > 0
          ? 'pending_payment' as const
          : 'settled' as const,
      condition: input.condition,
      applyRentalToDeposit: input.applyRentalToDeposit !== false,
      actualReturnDate: actualReturnDate.toISOString(),
      notes: input.notes,
      lateDays: late.lateDays,
      fees: {
        lateFee,
        dirtyFee,
        damageFee,
        accessoryFee: accessoryLostFee,
        otherFee,
      },
      updatedAt: new Date().toISOString(),
    };

    return this.prisma.$transaction(async (tx) => {
      const nextBookingStatus = settlementDraft.status === 'pending_payment'
        ? BookingStatus.SETTLEMENT_PENDING
        : BookingStatus.COMPLETED;

      const updatedRental = await tx.rental.update({
        where: { id: rental.id },
        data: {
          status: nextBookingStatus === BookingStatus.COMPLETED ? RentalStatus.COMPLETED : RentalStatus.RETURNED,
          actualReturnDate,
          returnedById: input.returnedById,
          returnConditionNotes: JSON.stringify(settlementDraft),
          damageCost: damageFee,
        },
      });

      await tx.booking.update({
        where: { id: rental.bookingId },
        data: { status: nextBookingStatus },
      });
      const productStatusMap = new Map<string, ProductStatus>();
      for (const item of resolvedItems) {
        const status =
          item.condition === 'missing_item' || item.condition === 'damaged'
            ? InventoryItemStatus.DAMAGED
            : item.condition === 'dirty' || item.condition === 'missing_accessory'
              ? InventoryItemStatus.MAINTENANCE
              : InventoryItemStatus.AVAILABLE;
        if (item.resolvedInventoryItemId) {
          const updatedInventory = await tx.inventoryItem.updateMany({
            where: { id: item.resolvedInventoryItemId },
            data: { status },
          });
          if (updatedInventory.count === 0) {
            throw new BadRequestException(`Inventory item ${item.resolvedInventoryItemId} was not found for return settlement`);
          }
        }
        productStatusMap.set(
          item.productId,
          status === InventoryItemStatus.DAMAGED
            ? ProductStatus.DAMAGED
            : status === InventoryItemStatus.MAINTENANCE
              ? ProductStatus.MAINTENANCE
              : ProductStatus.AVAILABLE,
        );
        await tx.bookingItem.updateMany({
          where: {
            bookingId: rental.bookingId,
            ...(item.resolvedInventoryItemId
              ? { inventoryItemId: item.resolvedInventoryItemId }
              : { inventoryItemId: null, productId: item.productId }),
          },
          data: {
            returnStatus:
              item.condition === 'missing_item'
                ? 'MISSING'
                : status === InventoryItemStatus.DAMAGED
                  ? 'DAMAGED'
                  : status === InventoryItemStatus.MAINTENANCE
                    ? 'MAINTENANCE'
                    : 'RETURNED',
            condition:
              item.condition === 'dirty'
                ? 'DIRTY'
                : item.condition === 'damaged'
                  ? 'DAMAGED'
                  : item.condition === 'missing_accessory'
                    ? 'MISSING_ACCESSORY'
                    : item.condition === 'missing_item'
                      ? 'MISSING_ITEM'
                      : 'GOOD',
            returnImages: JSON.stringify(item.images ?? []),
            fees: {
              damageFee: Number(item.damageFee || 0),
              accessoryFee: Number(item.accessoryFee || 0),
            } as any,
          } as any,
        });
      }
      for (const [productId, productStatus] of productStatusMap.entries()) {
        await tx.product.update({
          where: { id: productId },
          data: { status: productStatus },
        });
      }

      await this.auditDisputesService.log({
        action: AuditAction.RETURN_SETTLED,
        entity: 'Rental',
        entityId: rental.id,
        bookingId,
        rentalId: rental.id,
        actorId: input.returnedById,
        summary: `Settled return for booking ${bookingId}`,
        before: rental,
        after: updatedRental,
        metadata: {
          settlement: {
            ...settlementDraft.fees,
            ...settlement,
            lateDays: late.lateDays,
            rentalOutstanding: Number(bookingSummary.rentalOutstandingAtReturn || bookingSummary.rentalRemaining || 0),
          },
          inventoryItemIds: expectedProducts.map((product) => product.inventoryItemId ?? product.id),
          conditions: resolvedItems,
          condition: input.condition,
          bookingStatus: nextBookingStatus,
        },
      }, tx);

      return {
        bookingId,
        rental: updatedRental,
        settlement: {
          ...settlementDraft.fees,
          ...settlement,
          lateDays: late.lateDays,
          rentalOutstanding: Number(bookingSummary.rentalOutstandingAtReturn || bookingSummary.rentalRemaining || 0),
        },
      };
    });
  }
}
