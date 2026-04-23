import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';
import { UserRole } from '@prisma/client';

export class LoginDto {
  @ApiProperty({
    example: 'cashier@rental.local',
    description: 'Staff email used to sign in to the operations console.',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'ChangeMe123!',
    description: 'Plain-text password. The backend compares it with the stored bcrypt hash.',
  })
  @IsString()
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Refresh token returned by POST /auth/login.',
  })
  @IsString()
  refreshToken!: string;
}

export class AuthUserDto {
  @ApiProperty({ example: 'clu7u4p9d000008l4b75g9zx1' })
  id!: string;

  @ApiProperty({ example: 'cashier@rental.local' })
  email!: string;

  @ApiProperty({ example: 'Front Desk Cashier' })
  fullName!: string;

  @ApiProperty({
    enum: UserRole,
    example: UserRole.CASHIER,
    description: 'Operational role. SUPER_ADMIN/MANAGER map to admin, SALES/OPERATOR to staff, CASHIER to cashier.',
  })
  role!: UserRole;
}

export class LoginResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  refreshToken!: string;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}
