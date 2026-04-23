import { Controller, Get, Post, Body, Param, Patch, Delete, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';
import { UserRole } from '@prisma/client';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'List users',
    description: 'Admin view of users who can perform lead, booking, pickup, return, and cashier operations.',
  })
  async findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get user by id' })
  async findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Create operational user',
    description: 'Roles map to the business buckets admin, staff, and cashier.',
  })
  @ApiBody({ type: CreateUserDto })
  @ApiOkResponse({
    schema: {
      example: {
        id: 'clu7u4p9d000008l4b75g9zx1',
        email: 'staff@rental.local',
        fullName: 'Pickup Staff',
        role: 'OPERATOR',
        isActive: true,
      },
    },
  })
  async create(@Body() body: CreateUserDto) {
    return this.usersService.create(body);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update operational user' })
  @ApiBody({ type: UpdateUserDto })
  async update(@Param('id') id: string, @Body() body: UpdateUserDto) {
    return this.usersService.update(id, body);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete user permanently' })
  async delete(@Param('id') id: string) {
    return this.usersService.delete(id);
  }

  @Patch(':id/archive')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Archive user and disable login' })
  async archive(@Param('id') id: string) {
    return this.usersService.archive(id);
  }
}
