import { Injectable } from '@nestjs/common';

export type ReturnCondition = 'clean' | 'dirty' | 'damaged' | 'incomplete';
export type DepositRate = 30 | 50 | 100;
export type DepositType = 'percent' | 'custom_amount';

export interface DepositPolicy {
  allowPartialDeposit: boolean;
  allowedDepositRates: DepositRate[];
  defaultDepositRate: DepositRate;
  allowCustomDepositAmount: boolean;
}

export interface RentalPaymentPolicy {
  requireRentalPaymentBeforePickup: boolean;
}

export interface LateFeePolicy {
  firstPeriodDays: number;
  firstPeriodFeePerDay: number;
  afterPeriodFeePerDay: number;
}

export interface DepositProgress {
  productValue: number;
  selectedDepositRate: DepositRate;
  securityDepositRequired: number;
  securityDepositPaid: number;
  remainingForSelectedRate: number;
  remainingForFull: number;
  progressPercent: number;
}

export interface AmountDueBeforePickup {
  rentalRemaining: number;
  depositRequiredForPickup: number;
  depositOutstandingForPickup: number;
  amountDueNow: number;
  canPickup: boolean;
  pickupBlockedReasons: string[];
}

export interface ReturnSettlementCalculation {
  lateDays: number;
  lateFee: number;
  damageFee: number;
  accessoryFee: number;
  dirtyHoldAmount: number;
  totalDeductions: number;
  refundNow: number;
  refundPending: number;
  amountDueFromCustomer: number;
  finalStatus: 'completed' | 'settlement_pending';
  recommendedCompensation: number;
  requiresManagerApproval: boolean;
}

export interface DepositCalculation {
  bookingDeposit: number;
  securityDeposit: number;
  securityDepositOption: string;
  note: string;
}

export interface SettlementCalculation {
  lateDays: number;
  lateFee: number;
  damageFee: number;
  cleaningHold: number;
  accessoryLostFee: number;
  nextBookingImpactFee: number;
  totalFees: number;
  refund: number;
  holdAmount: number;
  amountDueFromCustomer: number;
}

@Injectable()
export class RentalPricingService {
  getDepositPolicy(overrides?: Partial<DepositPolicy>): DepositPolicy {
    return {
      allowPartialDeposit: true,
      allowedDepositRates: [30, 50, 100],
      defaultDepositRate: 50,
      allowCustomDepositAmount: true,
      ...overrides,
    };
  }

  getRentalPaymentPolicy(overrides?: Partial<RentalPaymentPolicy>): RentalPaymentPolicy {
    return {
      requireRentalPaymentBeforePickup: false,
      ...overrides,
    };
  }

  getLateFeePolicy(overrides?: Partial<LateFeePolicy>): LateFeePolicy {
    return {
      firstPeriodDays: 3,
      firstPeriodFeePerDay: 20000,
      afterPeriodFeePerDay: 10000,
      ...overrides,
    };
  }

  normalizeDepositRate(rate?: number | null, policy?: DepositPolicy): DepositRate {
    const resolvedPolicy = policy ?? this.getDepositPolicy();
    const numeric = Number(rate || 0);
    if (resolvedPolicy.allowedDepositRates.includes(numeric as DepositRate)) {
      return numeric as DepositRate;
    }
    return resolvedPolicy.defaultDepositRate;
  }

  calculateBasePrice(basePrices: number[]) {
    return basePrices.reduce((sum, price) => sum + Math.max(Number(price || 0), 0), 0);
  }

  calculateDurationDiscount(baseThreeDayPrice: number, durationDays: number) {
    const base = Math.max(Number(baseThreeDayPrice || 0), 0);
    if (durationDays === 1) return Math.min(40000, base);
    if (durationDays === 2) return Math.min(20000, base);
    return 0;
  }

  calculateRentalPriceForDuration(baseThreeDayPrice: number, durationDays: number) {
    return Math.max(
      Number(baseThreeDayPrice || 0) - this.calculateDurationDiscount(baseThreeDayPrice, durationDays),
      0,
    );
  }

  calculateEarlyPickupFee(durationDays: number, calendarDays: number) {
    const earlyDays = Math.max(0, Number(calendarDays || 0) - Number(durationDays || 0));
    if (earlyDays === 0) return 0;
    const feePerDay = durationDays === 3 ? 10000 : 20000;
    return earlyDays * feePerDay;
  }

  calculateRentalTotal(input: {
    dailyRentalPrice: number;
    rentalDays: number;
    pickupDate?: Date;
    returnDate?: Date;
    earlyPickupDays?: number;
    discountRules?: {
      oneDayDiscount?: number;
      twoDayDiscount?: number;
      threeDayDiscount?: number;
    };
  }) {
    const rentalDays = Math.max(Number(input.rentalDays || 1), 1);
    const baseTotal = Math.max(Number(input.dailyRentalPrice || 0), 0) * rentalDays;
    const discountRules = input.discountRules ?? {
      oneDayDiscount: 40000,
      twoDayDiscount: 20000,
      threeDayDiscount: 0,
    };
    const discount =
      rentalDays === 1
        ? Number(discountRules.oneDayDiscount || 0)
        : rentalDays === 2
          ? Number(discountRules.twoDayDiscount || 0)
          : Number(discountRules.threeDayDiscount || 0);
    const earlyPickupDays = Math.max(Number(input.earlyPickupDays || 0), 0);
    const earlyPickupFee = earlyPickupDays > 0 ? earlyPickupDays * (rentalDays === 3 ? 10000 : 20000) : 0;
    return {
      baseTotal,
      discount: Math.min(discount, baseTotal),
      earlyPickupFee,
      rentalTotal: Math.max(baseTotal - discount + earlyPickupFee, 0),
      rentalDays,
    };
  }

  calculateSecurityDepositRequired(input: {
    productValue: number;
    depositRate: number;
  }) {
    return Math.round(Math.max(Number(input.productValue || 0), 0) * (Number(input.depositRate || 0) / 100));
  }

  calculateRequestedDeposit(input: {
    productValue: number;
    depositType?: DepositType;
    depositRate?: number | null;
    customAmount?: number | null;
    policy?: Partial<DepositPolicy>;
  }) {
    const policy = this.getDepositPolicy(input.policy);
    const depositType: DepositType =
      input.depositType === 'custom_amount' && policy.allowCustomDepositAmount
        ? 'custom_amount'
        : 'percent';
    const selectedDepositRate = this.normalizeDepositRate(input.depositRate, policy);
    const customAmount = Math.max(Number(input.customAmount || 0), 0);
    const requiredAmount =
      depositType === 'custom_amount'
        ? customAmount
        : this.calculateSecurityDepositRequired({
            productValue: input.productValue,
            depositRate: selectedDepositRate,
          });
    return {
      depositType,
      selectedDepositRate,
      customAmount: depositType === 'custom_amount' ? customAmount : null,
      requiredAmount: Math.max(requiredAmount, 0),
    };
  }

  calculateDepositProgress(input: {
    productValue: number;
    selectedDepositRate: number;
    securityDepositPaid: number;
  }): DepositProgress {
    const productValue = Math.max(Number(input.productValue || 0), 0);
    const selectedDepositRate = this.normalizeDepositRate(input.selectedDepositRate);
    const securityDepositPaid = Math.max(Number(input.securityDepositPaid || 0), 0);
    const securityDepositRequired = this.calculateSecurityDepositRequired({
      productValue,
      depositRate: selectedDepositRate,
    });
    return {
      productValue,
      selectedDepositRate,
      securityDepositRequired,
      securityDepositPaid,
      remainingForSelectedRate: Math.max(securityDepositRequired - securityDepositPaid, 0),
      remainingForFull: Math.max(productValue - securityDepositPaid, 0),
      progressPercent:
        securityDepositRequired > 0
          ? Math.min(Math.round((securityDepositPaid / securityDepositRequired) * 100), 100)
          : 0,
    };
  }

  calculateAmountDueBeforePickup(input: {
    rentalTotal: number;
    rentalPaid: number;
    depositRequired: number;
    securityDepositPaid: number;
    rentalPaymentPolicy?: Partial<RentalPaymentPolicy>;
  }): AmountDueBeforePickup {
    const rentalPaymentPolicy = this.getRentalPaymentPolicy(input.rentalPaymentPolicy);
    const rentalTotal = Math.max(Number(input.rentalTotal || 0), 0);
    const rentalPaid = Math.max(Number(input.rentalPaid || 0), 0);
    const securityDepositPaid = Math.max(Number(input.securityDepositPaid || 0), 0);
    const rentalRemaining = Math.max(rentalTotal - rentalPaid, 0);
    const depositRequiredForPickup = Math.max(Number(input.depositRequired || 0), 0);
    const depositOutstandingForPickup = Math.max(
      depositRequiredForPickup - securityDepositPaid,
      0,
    );
    const pickupBlockedReasons: string[] = [];
    if (rentalPaymentPolicy.requireRentalPaymentBeforePickup && rentalRemaining > 0) {
      pickupBlockedReasons.push('rental_unpaid');
    }
    if (depositOutstandingForPickup > 0) pickupBlockedReasons.push('deposit_missing');
    return {
      rentalRemaining,
      depositRequiredForPickup,
      depositOutstandingForPickup,
      amountDueNow:
        (rentalPaymentPolicy.requireRentalPaymentBeforePickup ? rentalRemaining : 0)
        + depositOutstandingForPickup,
      canPickup: pickupBlockedReasons.length === 0,
      pickupBlockedReasons,
    };
  }

  calculateLateFee(input: {
    expectedReturnDate: Date;
    actualReturnDate: Date;
    configuredRules?: Partial<LateFeePolicy>;
  }) {
    const lateMs = input.actualReturnDate.getTime() - input.expectedReturnDate.getTime();
    const lateDays = Math.max(0, Math.ceil(lateMs / (1000 * 60 * 60 * 24)));
    const policy = this.getLateFeePolicy(input.configuredRules);
    if (lateDays <= 0) {
      return { lateDays: 0, lateFee: 0, policy };
    }
    const firstPeriodDays = Math.min(lateDays, policy.firstPeriodDays);
    const afterPeriodDays = Math.max(lateDays - policy.firstPeriodDays, 0);
    const lateFee =
      firstPeriodDays * policy.firstPeriodFeePerDay +
      afterPeriodDays * policy.afterPeriodFeePerDay;
    return { lateDays, lateFee, policy };
  }

  suggestDamageFee(_condition: ReturnCondition, declaredDamageFee = 0) {
    const declared = Math.max(Number(declaredDamageFee || 0), 0);
    return declared;
  }

  calculateReturnSettlement(input: {
    securityDepositPaid: number;
    lateFee: number;
    damageFee?: number;
    accessoryFee?: number;
    dirtyHold?: number;
    existingRefunds?: number;
    nextBookingRentalAmount?: number;
  }): ReturnSettlementCalculation {
    const securityDepositPaid = Math.max(Number(input.securityDepositPaid || 0), 0);
    const lateFee = Math.max(Number(input.lateFee || 0), 0);
    const damageFee = Math.max(Number(input.damageFee || 0), 0);
    const accessoryFee = Math.max(Number(input.accessoryFee || 0), 0);
    const dirtyHoldAmount = Math.max(Number(input.dirtyHold || 0), 0);
    const existingRefunds = Math.max(Number(input.existingRefunds || 0), 0);
    const totalDeductions = lateFee + damageFee + accessoryFee;
    const remainingAfterDeductions = securityDepositPaid - totalDeductions - existingRefunds;
    const refundNow = Math.max(remainingAfterDeductions - dirtyHoldAmount, 0);
    const refundPending = Math.min(Math.max(remainingAfterDeductions, 0), dirtyHoldAmount);
    const amountDueFromCustomer = Math.max(-(remainingAfterDeductions - dirtyHoldAmount), 0);
    const recommendedCompensation = Math.max(Number(input.nextBookingRentalAmount || 0), 0);
    const requiresManagerApproval =
      amountDueFromCustomer > 0 ||
      damageFee >= 1000000 ||
      recommendedCompensation > 0;

    return {
      lateDays: 0,
      lateFee,
      damageFee,
      accessoryFee,
      dirtyHoldAmount,
      totalDeductions,
      refundNow,
      refundPending,
      amountDueFromCustomer,
      finalStatus: refundPending > 0 || amountDueFromCustomer > 0 ? 'settlement_pending' : 'completed',
      recommendedCompensation,
      requiresManagerApproval,
    };
  }

  calculateDeposit(totalPrice: number, totalProductValue: number): DepositCalculation {
    const securityDeposit = Math.max(Number(totalProductValue || 0), 0);
    return {
      bookingDeposit: this.calculateSecurityDepositRequired({
        productValue: securityDeposit,
        depositRate: this.getDepositPolicy().defaultDepositRate,
      }),
      securityDeposit,
      securityDepositOption: 'cash',
      note: 'Legacy helper mapped to security_deposit policy.',
    };
  }

  calculateSettlement(input: {
    scheduledReturnDate: Date;
    actualReturnDate: Date;
    totalPrice: number;
    rentalDays: number;
    securityDepositHeld: number;
    condition: ReturnCondition;
    damageFee?: number;
    accessoryLostFee?: number;
    nextBookingImpactFee?: number;
  }): SettlementCalculation {
    const late = this.calculateLateFee({
      expectedReturnDate: input.scheduledReturnDate,
      actualReturnDate: input.actualReturnDate,
    });
    const damageFee = this.suggestDamageFee(input.condition, input.damageFee);
    const cleaningHold = input.condition === 'dirty' ? 500000 : 0;
    const accessoryLostFee = Math.max(Number(input.accessoryLostFee || 0), 0);
    const nextBookingImpactFee = Math.max(Number(input.nextBookingImpactFee || 0), 0);
    const settlement = this.calculateReturnSettlement({
      securityDepositPaid: input.securityDepositHeld,
      lateFee: late.lateFee,
      damageFee,
      accessoryFee: accessoryLostFee + nextBookingImpactFee,
      dirtyHold: cleaningHold,
      nextBookingRentalAmount: nextBookingImpactFee,
    });

    return {
      lateDays: late.lateDays,
      lateFee: late.lateFee,
      damageFee,
      cleaningHold,
      accessoryLostFee,
      nextBookingImpactFee,
      totalFees: settlement.totalDeductions + settlement.dirtyHoldAmount,
      refund: settlement.refundNow,
      holdAmount: settlement.refundPending,
      amountDueFromCustomer: settlement.amountDueFromCustomer,
    };
  }
}
