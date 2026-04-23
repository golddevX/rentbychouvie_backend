import { Injectable } from '@nestjs/common';
import { Product } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type ProductInventoryStatus = {
  product: Product;
  total: number;
  available: number;
  reserved: number;
  rented: number;
  damaged: number;
  retired: number;
};

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getDailyRevenue(date: string) {
    const startDate = new Date(date);
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + 1);

    const payments = await this.prisma.payment.aggregate({
      where: {
        status: 'COMPLETED',
        paidAt: {
          gte: startDate,
          lt: endDate,
        },
      },
      _sum: {
        amount: true,
        amountPaid: true,
        amountRefunded: true,
      },
      _count: true,
    });

    const bookings = await this.prisma.booking.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lt: endDate,
        },
      },
    });

    const rentals = await this.prisma.rental.findMany({
      where: {
        actualPickupDate: {
          gte: startDate,
          lt: endDate,
        },
      },
    });

    return {
      date,
      totalRevenue: payments._sum.amount || 0,
      amountPaid: payments._sum.amountPaid || 0,
      amountRefunded: payments._sum.amountRefunded || 0,
      transactionsCount: payments._count,
      newBookings: bookings.length,
      pickupsCount: rentals.length,
    };
  }

  async getInventoryStatus() {
    const items = await this.prisma.inventoryItem.groupBy({
      by: ['status'],
      _count: true,
    });

    const byProduct = await this.prisma.inventoryItem.findMany({
      include: {
        product: true,
        rentals: {
          where: { status: 'IN_RENTAL' },
        },
      },
    });

    const productStatus: Record<string, ProductInventoryStatus> = {};
    byProduct.forEach((item) => {
      if (!productStatus[item.product.id]) {
        productStatus[item.product.id] = {
          product: item.product,
          total: 0,
          available: 0,
          reserved: 0,
          rented: 0,
          damaged: 0,
          retired: 0,
        };
      }

      productStatus[item.product.id].total += 1;

      if (item.status === 'AVAILABLE') {
        productStatus[item.product.id].available += 1;
      } else if (item.status === 'RESERVED') {
        productStatus[item.product.id].reserved += 1;
      } else if (item.status === 'RENTED') {
        productStatus[item.product.id].rented += 1;
      } else if (item.status === 'DAMAGED') {
        productStatus[item.product.id].damaged += 1;
      } else if (item.status === 'RETIRED') {
        productStatus[item.product.id].retired += 1;
      }
    });

    return {
      summary: items,
      byProduct: Object.values(productStatus),
    };
  }

  async getRentalAnalytics(startDate?: string, endDate?: string) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const rentals = await this.prisma.rental.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      include: {
        booking: {
          include: { customer: true },
        },
      },
    });

    const completed = rentals.filter((r) => r.status === 'COMPLETED').length;
    const cancelled = rentals.filter((r) => r.status === 'CANCELLED').length;
    const inProgress = rentals.filter(
      (r) => r.status === 'IN_RENTAL' || r.status === 'PICKED_UP',
    ).length;

    const totalRevenue = rentals.reduce((sum, r) => {
      // Will need to include payment data
      return sum;
    }, 0);

    const avgRentalDays = rentals.reduce(
      (sum, r) =>
        sum +
        Math.ceil(
          (r.scheduledReturnDate.getTime() - r.scheduledPickupDate.getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      0,
    ) / rentals.length;

    return {
      period: { startDate: start, endDate: end },
      totalRentals: rentals.length,
      completed,
      cancelled,
      inProgress,
      avgRentalDays: avgRentalDays || 0,
      damageIncidents: rentals.filter((r) => r.damageCost > 0).length,
      totalDamageCost: rentals.reduce((sum, r) => sum + r.damageCost, 0),
    };
  }

  async getLeadConversionReport(startDate?: string, endDate?: string) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const leads = await this.prisma.lead.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
      },
    });

    const won = leads.filter((l) => l.status === 'BOOKING_CREATED').length;
    const rejected = leads.filter((l) => l.status === 'LOST').length;
    const contacted = leads.filter((l) => l.status === 'CONTACTED').length;

    return {
      period: { startDate: start, endDate: end },
      totalLeads: leads.length,
      newLeads: leads.filter((l) => l.status === 'NEW').length,
      contacted,
      depositRequested: leads.filter((l) => l.status === 'DEPOSIT_REQUESTED').length,
      depositReceived: leads.filter((l) => l.status === 'DEPOSIT_RECEIVED').length,
      won,
      lost: rejected,
      conversionRate:
        leads.length > 0 ? ((won / leads.length) * 100).toFixed(2) : 0,
    };
  }

  async getStaffPerformance() {
    const staff = await this.prisma.user.findMany({
      include: {
        leads: true,
        bookings: true,
        pickupRentals: true,
        returnRentals: true,
        payments: true,
      },
    });

    return staff.map((user) => ({
      id: user.id,
      name: user.fullName,
      role: user.role,
      leadsCreated: user.leads.length,
      bookingsCreated: user.bookings.length,
      pickupsProcessed: user.pickupRentals.length,
      returnsProcessed: user.returnRentals.length,
      paymentsProcessed: user.payments.length,
    }));
  }
}
