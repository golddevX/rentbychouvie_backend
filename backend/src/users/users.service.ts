import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { buildPaginatedResult, resolvePagination } from '../shared/pagination';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters?: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    role?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const { page, limit, skip, take } = resolvePagination(filters);
    const sortBy = ['createdAt', 'fullName', 'email'].includes(String(filters?.sortBy))
      ? String(filters?.sortBy)
      : 'createdAt';
    const sortOrder = filters?.sortOrder === 'asc' ? 'asc' : 'desc';
    const normalizedSearch = String(filters?.search ?? '').trim();
    const normalizedStatus = String(filters?.status ?? '').toLowerCase();
    const normalizedRole = String(filters?.role ?? '').toUpperCase();
    const where: Prisma.UserWhereInput = {
      archivedAt: null,
      ...(normalizedRole ? { role: normalizedRole as UserRole } : {}),
      ...(normalizedStatus === 'active' ? { isActive: true } : {}),
      ...(normalizedStatus === 'disabled' ? { isActive: false } : {}),
      ...(normalizedSearch
        ? {
            OR: [
              { fullName: { contains: normalizedSearch, mode: 'insensitive' } },
              { email: { contains: normalizedSearch, mode: 'insensitive' } },
              { phone: { contains: normalizedSearch, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const select = {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      archivedAt: true,
    } satisfies Prisma.UserSelect;

    const [total, data] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take,
      }),
    ]);

    return buildPaginatedResult(data, { page, limit, total });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  async create(data: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
    role?: UserRole;
  }) {
    const hashedPassword = await bcrypt.hash(data.password, 10);

    const createData: Prisma.UserCreateInput = {
      email: data.email,
      password: hashedPassword,
      fullName: data.fullName,
      phone: data.phone,
      role: data.role,
    };

    return this.prisma.user.create({
      data: createData,
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  async delete(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }

  async archive(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { archivedAt: new Date(), isActive: false },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
  }
}
