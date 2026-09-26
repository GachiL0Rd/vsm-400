import {
  Controller,
  Get,
  HttpCode,
  Inject,
  type MessageEvent,
  Param,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Observable } from 'rxjs';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import type { Notice, NoticePage } from './notice';
import {
  NoticeDto,
  NoticePageDto,
  NotificationListQueryDto,
  UnreadCountDto,
} from './notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('уведомления')
@ApiCookieAuth('vsm_access')
@ApiBearerAuth('bearer')
@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Лента уведомлений' })
  @ApiOkResponse({ type: NoticePageDto })
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(NotificationListQueryDto)) query: NotificationListQueryDto,
  ): Promise<NoticePage> {
    return this.notifications.list(user.id, query.limit, query.cursor);
  }

  @Sse('stream')
  @ApiOperation({ summary: 'Поток уведомлений: событие new-notification, heartbeat 25 с' })
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return this.notifications.stream(user.id);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Отметить все уведомления прочитанными' })
  @ApiOkResponse({ type: UnreadCountDto })
  readAll(@CurrentUser() user: AuthUser): Promise<{ unreadCount: number }> {
    return this.notifications.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Отметить уведомление прочитанным' })
  @ApiOkResponse({ type: NoticeDto })
  read(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Notice> {
    return this.notifications.markRead(user.id, id);
  }
}
