import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, LoginResponseDto, RefreshTokenDto } from './dto/auth.dto';
import { CurrentUser } from '../shared/decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  async me(@CurrentUser() user: any) {
    return {
      data: await this.authService.getProfile(user?.id ?? user?.sub),
    };
  }

  @Post('login')
  @ApiOperation({
    summary: 'Login and receive JWT tokens',
    description: 'Start here in Swagger. Use the accessToken as Bearer auth for all protected operations.',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    type: LoginResponseDto,
    description: 'JWT tokens and role-aware user profile.',
  })
  async login(@Body() body: LoginDto) {
    return {
      data: await this.authService.login(body.email, body.password),
    };
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiOkResponse({
    schema: {
      example: {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    },
  })
  async refresh(@Body() body: RefreshTokenDto) {
    return {
      data: await this.authService.refreshToken(body.refreshToken),
    };
  }

  @Post('logout')
  @ApiOperation({ summary: 'Logout current user' })
  @ApiOkResponse({ schema: { example: { message: 'Logged out successfully' } } })
  async logout() {
    return { message: 'Logged out successfully' };
  }
}
