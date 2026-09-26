import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import { LoginDto, LoginResponseDto, PasswordDto, SessionResponseDto } from './auth.dto';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth-user';
import { AuthCookies, type CookieReply } from './cookies';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { clientIp, readRefreshCookie, userAgent } from './request';

type AuthHttp = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthCookies) private readonly cookies: AuthCookies,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Вход по логину и паролю' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: LoginResponseDto })
  async login(
    @Body(new ZodValidationPipe(LoginDto)) body: LoginDto,
    @Req() request: AuthHttp,
    @Res({ passthrough: true }) reply: CookieReply,
  ) {
    const issued = await this.auth.login(body.login, body.password, metaOf(request));
    this.cookies.write(reply, issued.access, issued.refresh);
    return { user: issued.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Обновить access и повернуть refresh' })
  @ApiOkResponse({ type: LoginResponseDto })
  async refresh(@Req() request: AuthHttp, @Res({ passthrough: true }) reply: CookieReply) {
    const issued = await this.auth.refresh(readRefreshCookie(request.cookies), metaOf(request));
    this.cookies.write(reply, issued.access, issued.refresh);
    return { user: issued.user };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Выйти и отозвать refresh' })
  async logout(
    @Req() request: AuthHttp,
    @Res({ passthrough: true }) reply: CookieReply,
  ): Promise<{ ok: true }> {
    await this.auth.logout(readRefreshCookie(request.cookies), metaOf(request));
    this.cookies.clear(reply);
    return { ok: true };
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @ApiCookieAuth('vsm_access')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Сменить пароль' })
  @ApiBody({ type: PasswordDto })
  @ApiOkResponse({ type: LoginResponseDto })
  async password(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(PasswordDto)) body: PasswordDto,
    @Req() request: AuthHttp,
    @Res({ passthrough: true }) reply: CookieReply,
  ) {
    const issued = await this.auth.changePassword(
      user.id,
      body.current,
      body.next,
      metaOf(request),
    );
    this.cookies.write(reply, issued.access, issued.refresh);
    return { user: issued.user };
  }

  @Get('session')
  @ApiCookieAuth('vsm_access')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Текущий пользователь' })
  @ApiOkResponse({ type: SessionResponseDto })
  session(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}

function metaOf(request: AuthHttp) {
  return { ip: clientIp(request), userAgent: userAgent(request.headers) };
}
