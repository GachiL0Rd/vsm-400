import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { NotificationKind } from '../generated/prisma/client';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export class NotificationListQueryDto extends createZodDto(listQuery) {}

export class NoticeDto {
  @ApiProperty({ type: String })
  id = '';

  @ApiProperty({ enum: NotificationKind })
  kind: NotificationKind = NotificationKind.advice;

  @ApiProperty({ type: String })
  title = '';

  @ApiProperty({ type: String })
  text = '';

  @ApiProperty({ type: String, description: 'ISO-время' })
  at = '';

  @ApiProperty({ type: Boolean })
  unread = false;

  @ApiPropertyOptional({ type: String })
  link?: string;
}

export class NoticePageDto {
  @ApiProperty({ type: Number })
  unreadCount = 0;

  @ApiProperty({ type: () => NoticeDto, isArray: true })
  items: NoticeDto[] = [];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor: string | null = null;
}

export class UnreadCountDto {
  @ApiProperty({ type: Number, example: 0 })
  unreadCount = 0;
}
