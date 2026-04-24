import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, AppointmentType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const APPOINTMENT_LIFECYCLE = [
  'pending',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'no_show',
] as const;

type AppointmentLifecycle = (typeof APPOINTMENT_LIFECYCLE)[number];

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

  private validateLifecycle(lifecycleStatus?: string) {
    if (!lifecycleStatus) return 'pending' as AppointmentLifecycle;
    if (!APPOINTMENT_LIFECYCLE.includes(lifecycleStatus as AppointmentLifecycle)) {
      throw new BadRequestException('Invalid appointment lifecycle status');
    }
    return lifecycleStatus as AppointmentLifecycle;
  }

  private resolveTimeRange(input: {
    scheduledAt?: string;
    startTime?: string;
    endTime?: string;
    durationMinutes?: number;
    durationHours?: number;
  }) {
    const start = new Date(input.startTime ?? input.scheduledAt ?? '');
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Invalid start time');
    }

    const resolvedDurationMinutes = input.durationMinutes
      ? Number(input.durationMinutes)
      : input.durationHours
        ? Number(input.durationHours) * 60
        : 60;

    const end = input.endTime
      ? new Date(input.endTime)
      : new Date(start.getTime() + resolvedDurationMinutes * 60 * 1000);

    if (Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid end time');
    }
    if (start.getTime() >= end.getTime()) {
      throw new BadRequestException('Invalid time range: start must be before end');
    }
    if (start.getTime() < Date.now()) {
      throw new BadRequestException('Past booking is not allowed');
    }

    const durationMinutes = Math.ceil((end.getTime() - start.getTime()) / 60000);
    const durationHours = Number((durationMinutes / 60).toFixed(2));

    return { start, end, durationMinutes, durationHours };
  }

  private mapStatusFromLifecycle(lifecycleStatus: AppointmentLifecycle): AppointmentStatus {
    if (lifecycleStatus === 'checked_in') return AppointmentStatus.CHECKED_IN;
    if (lifecycleStatus === 'completed') return AppointmentStatus.COMPLETED;
    if (lifecycleStatus === 'cancelled') return AppointmentStatus.CANCELLED;
    if (lifecycleStatus === 'no_show') return AppointmentStatus.NO_SHOW;
    return AppointmentStatus.SCHEDULED;
  }

  private isOverlapped(startA: Date, endA: Date, startB: Date, endB: Date) {
    return startA < endB && startB < endA;
  }

  private async ensureNoOverlap(params: {
    appointmentId?: string;
    customerId: string;
    start: Date;
    end: Date;
    staffId?: string;
    room?: string;
    resourceItemId?: string;
  }) {
    const where: Prisma.AppointmentWhereInput = {
      archivedAt: null,
      id: params.appointmentId ? { not: params.appointmentId } : undefined,
      OR: [
        { customerId: params.customerId },
        params.staffId ? { staffId: params.staffId } : undefined,
        params.room ? { room: params.room } : undefined,
        params.resourceItemId ? { resourceItemId: params.resourceItemId } : undefined,
      ].filter(Boolean) as Prisma.AppointmentWhereInput[],
    };

    const candidates = await this.prisma.appointment.findMany({
      where,
      select: {
        id: true,
        scheduledAt: true,
        startTime: true,
        endTime: true,
        durationMinutes: true,
        status: true,
        lifecycleStatus: true,
      },
    });

    const blocked = candidates.some((item) => {
      if (item.status === AppointmentStatus.CANCELLED || item.status === AppointmentStatus.NO_SHOW) return false;
      if (['cancelled', 'no_show'].includes(item.lifecycleStatus ?? '')) return false;

      const existingStart = item.startTime ?? item.scheduledAt;
      const existingEnd = item.endTime ?? new Date(existingStart.getTime() + item.durationMinutes * 60 * 1000);
      return this.isOverlapped(params.start, params.end, existingStart, existingEnd);
    });

    if (blocked) {
      throw new BadRequestException('Overlapping booking or unavailable resource');
    }
  }

  async findAll(filters?: {
    status?: AppointmentStatus;
    type?: AppointmentType;
    staffId?: string;
    lifecycleStatus?: string;
    includeArchived?: boolean;
  }) {
    const where: Prisma.AppointmentWhereInput = {
      archivedAt: filters?.includeArchived ? undefined : null,
      status: filters?.status,
      type: filters?.type,
      staffId: filters?.staffId,
      lifecycleStatus: filters?.lifecycleStatus,
    };

    const rows = await this.prisma.appointment.findMany({
      where,
      include: {
        customer: true,
        staff: { select: { id: true, fullName: true, email: true, role: true } },
        resourceItem: { select: { id: true, serialNumber: true, qrCode: true, status: true } },
      },
      orderBy: { startTime: 'asc' },
    });

    return rows.map((row) => {
      const start = row.startTime ?? row.scheduledAt;
      const end = row.endTime ?? new Date(start.getTime() + row.durationMinutes * 60000);
      return {
        ...row,
        startTime: start,
        endTime: end,
        durationHours: row.durationHours ?? Number((row.durationMinutes / 60).toFixed(2)),
      };
    });
  }

  async findById(id: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        customer: true,
        staff: { select: { id: true, fullName: true, email: true, role: true } },
        resourceItem: { select: { id: true, serialNumber: true, qrCode: true, status: true } },
      },
    });

    if (!appointment || appointment.archivedAt) {
      throw new NotFoundException('Appointment not found');
    }

    const start = appointment.startTime ?? appointment.scheduledAt;
    const end = appointment.endTime ?? new Date(start.getTime() + appointment.durationMinutes * 60000);
    return {
      ...appointment,
      startTime: start,
      endTime: end,
      durationHours: appointment.durationHours ?? Number((appointment.durationMinutes / 60).toFixed(2)),
    };
  }

  async create(data: {
    customerId?: string;
    email?: string;
    name?: string;
    phone?: string;
    type: AppointmentType;
    scheduledAt: string;
    startTime?: string;
    endTime?: string;
    durationMinutes?: number;
    durationHours?: number;
    lifecycleStatus?: string;
    resourceItemId?: string;
    room?: string;
    notes?: string;
    staffId?: string;
    leadId?: string;
    bookingId?: string;
  }) {
    const customerId =
      data.customerId ??
      (
        await this.prisma.customer.upsert({
          where: { email: data.email ?? `walkin-${Date.now()}@local.test` },
          update: {
            name: data.name,
            phone: data.phone,
          },
          create: {
            email: data.email ?? `walkin-${Date.now()}@local.test`,
            name: data.name ?? 'Walk-in customer',
            phone: data.phone ?? 'N/A',
          },
        })
      ).id;

    const { start, end, durationMinutes, durationHours } = this.resolveTimeRange({
      scheduledAt: data.scheduledAt,
      startTime: data.startTime,
      endTime: data.endTime,
      durationMinutes: data.durationMinutes,
      durationHours: data.durationHours,
    });
    const lifecycleStatus = this.validateLifecycle(data.lifecycleStatus);
    await this.ensureNoOverlap({
      customerId,
      start,
      end,
      staffId: data.staffId,
      room: data.room,
      resourceItemId: data.resourceItemId,
    });

    return this.prisma.appointment.create({
      data: {
        customerId,
        type: data.type,
        scheduledAt: start,
        startTime: start,
        endTime: end,
        durationMinutes,
        durationHours,
        lifecycleStatus,
        hourlyBlock: true,
        status: this.mapStatusFromLifecycle(lifecycleStatus),
        resourceItemId: data.resourceItemId,
        room: data.room,
        notes: data.notes,
        staffId: data.staffId,
        leadId: data.leadId,
        bookingId: data.bookingId,
      },
      include: { customer: true, staff: true, resourceItem: true },
    });
  }

  async update(id: string, data: any) {
    const current = await this.findById(id);
    const { start, end, durationMinutes, durationHours } = this.resolveTimeRange({
      scheduledAt: data.scheduledAt ?? current.scheduledAt.toISOString(),
      startTime: data.startTime ?? current.startTime?.toISOString(),
      endTime: data.endTime ?? current.endTime?.toISOString(),
      durationMinutes: data.durationMinutes ?? current.durationMinutes,
      durationHours: data.durationHours ?? current.durationHours,
    });
    const lifecycleStatus = this.validateLifecycle(data.lifecycleStatus ?? current.lifecycleStatus);
    await this.ensureNoOverlap({
      appointmentId: id,
      customerId: data.customerId ?? current.customerId,
      start,
      end,
      staffId: data.staffId ?? current.staffId ?? undefined,
      room: data.room ?? current.room ?? undefined,
      resourceItemId: data.resourceItemId ?? current.resourceItemId ?? undefined,
    });

    return this.prisma.appointment.update({
      where: { id },
      data: {
        customerId: data.customerId,
        type: data.type,
        scheduledAt: start,
        startTime: start,
        endTime: end,
        durationMinutes,
        durationHours,
        lifecycleStatus,
        status: this.mapStatusFromLifecycle(lifecycleStatus),
        room: data.room,
        notes: data.notes,
        staffId: data.staffId,
        leadId: data.leadId,
        bookingId: data.bookingId,
        resourceItemId: data.resourceItemId,
      },
      include: { customer: true, staff: true, resourceItem: true },
    });
  }

  async updateStatus(id: string, status: AppointmentStatus) {
    await this.findById(id);
    return this.prisma.appointment.update({
      where: { id },
      data: {
        status,
        lifecycleStatus:
          status === AppointmentStatus.CHECKED_IN
            ? 'checked_in'
            : status === AppointmentStatus.COMPLETED
              ? 'completed'
              : status === AppointmentStatus.CANCELLED
                ? 'cancelled'
                : status === AppointmentStatus.NO_SHOW
                  ? 'no_show'
                : 'confirmed',
      },
      include: { customer: true, staff: true },
    });
  }

  async archive(id: string) {
    await this.findById(id);
    return this.prisma.appointment.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  async getAvailability(params: {
    startTime: string;
    endTime: string;
    staffId?: string;
    room?: string;
    resourceItemId?: string;
  }) {
    const { start, end } = this.resolveTimeRange({
      startTime: params.startTime,
      endTime: params.endTime,
      durationMinutes: 30,
    });

    const candidates = await this.prisma.appointment.findMany({
      where: {
        archivedAt: null,
        OR: [
          params.staffId ? { staffId: params.staffId } : undefined,
          params.room ? { room: params.room } : undefined,
          params.resourceItemId ? { resourceItemId: params.resourceItemId } : undefined,
        ].filter(Boolean) as Prisma.AppointmentWhereInput[],
      },
      select: {
        id: true,
        status: true,
        lifecycleStatus: true,
        scheduledAt: true,
        startTime: true,
        endTime: true,
        durationMinutes: true,
        staffId: true,
        room: true,
        resourceItemId: true,
      },
    });

    const blockedBy = candidates
      .filter((item) => item.status !== AppointmentStatus.CANCELLED && item.status !== AppointmentStatus.NO_SHOW && !['cancelled', 'no_show'].includes(item.lifecycleStatus ?? ''))
      .filter((item) => {
        const itemStart = item.startTime ?? item.scheduledAt;
        const itemEnd = item.endTime ?? new Date(itemStart.getTime() + item.durationMinutes * 60000);
        return this.isOverlapped(start, end, itemStart, itemEnd);
      });

    return {
      available: blockedBy.length === 0,
      blockedBy: blockedBy.map((item) => ({
        id: item.id,
        status: item.status,
        lifecycleStatus: item.lifecycleStatus,
        startTime: item.startTime ?? item.scheduledAt,
        endTime: item.endTime ?? new Date((item.startTime ?? item.scheduledAt).getTime() + item.durationMinutes * 60000),
        staffId: item.staffId,
        room: item.room,
        resourceItemId: item.resourceItemId,
      })),
    };
  }
}
