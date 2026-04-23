import { Injectable } from '@nestjs/common';

export type ReturnCondition = 'clean' | 'dirty' | 'damaged' | 'incomplete';

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
}

@Injectable()
export class RentalPricingService {
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
      Number(baseThreeDayPrice || 0) -
        this.calculateDurationDiscount(baseThreeDayPrice, durationDays),
      0,
    );
  }

  calculateEarlyPickupFee(durationDays: number, calendarDays: number) {
    const earlyDays = Math.max(0, Number(calendarDays || 0) - Number(durationDays || 0));
    if (earlyDays === 0) return 0;
    const feePerDay = durationDays === 3 ? 10000 : 20000;
    return earlyDays * feePerDay;
  }

  calculateLateFee(input: {
    scheduledReturnDate: Date;
    actualReturnDate: Date;
    totalPrice: number;
    rentalDays: number;
  }) {
    const lateMs = input.actualReturnDate.getTime() - input.scheduledReturnDate.getTime();
    const lateDays = Math.max(0, Math.ceil(lateMs / (1000 * 60 * 60 * 24)));
    const dailyLateFee = Math.ceil(
      Number(input.totalPrice || 0) / Math.max(Number(input.rentalDays || 1), 1),
    );

    return {
      lateDays,
      lateFee: lateDays * dailyLateFee,
      dailyLateFee,
    };
  }

  calculateDeposit(totalPrice: number, highestItemBasePrice: number): DepositCalculation {
    const base = Math.max(Number(highestItemBasePrice || 0), 0);
    let securityDeposit = 0;
    let securityDepositOption = 'NONE';
    let note = 'No security deposit required';

    if (base > 300000 && base <= 1000000) {
      securityDeposit = 500000;
      securityDepositOption = '500K_OR_ID';
      note = 'Hold 500k or customer ID';
    }

    if (base > 1000000) {
      securityDeposit = 1000000;
      securityDepositOption = '1M_OR_500K_PLUS_ID';
      note = 'Hold 1M or 500k plus customer ID';
    }

    return {
      bookingDeposit: Math.ceil(Math.max(Number(totalPrice || 0), 0) * 0.5),
      securityDeposit,
      securityDepositOption,
      note,
    };
  }

  suggestDamageFee(condition: ReturnCondition, declaredDamageFee = 0) {
    const declared = Math.max(Number(declaredDamageFee || 0), 0);
    if (declared > 0) return declared;
    if (condition === 'dirty') return 500000;
    if (condition === 'damaged') return 1000000;
    if (condition === 'incomplete') return 750000;
    return 0;
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
      scheduledReturnDate: input.scheduledReturnDate,
      actualReturnDate: input.actualReturnDate,
      totalPrice: input.totalPrice,
      rentalDays: input.rentalDays,
    });
    const damageFee = this.suggestDamageFee(input.condition, input.damageFee);
    const cleaningHold = input.condition === 'dirty' ? 500000 : 0;
    const accessoryLostFee = Math.max(Number(input.accessoryLostFee || 0), 0);
    const nextBookingImpactFee = Math.max(Number(input.nextBookingImpactFee || 0), 0);
    const totalFees =
      late.lateFee + damageFee + cleaningHold + accessoryLostFee + nextBookingImpactFee;

    return {
      lateDays: late.lateDays,
      lateFee: late.lateFee,
      damageFee,
      cleaningHold,
      accessoryLostFee,
      nextBookingImpactFee,
      totalFees,
      refund: Math.max(Number(input.securityDepositHeld || 0) - totalFees, 0),
    };
  }
}
