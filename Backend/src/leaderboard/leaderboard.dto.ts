import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const seasonQuery = z.object({
  season: z.uuid().optional(),
});

export class SeasonQueryDto extends createZodDto(seasonQuery) {}

export class LeaderRowDto {
  @ApiProperty({ type: Number, example: 1 })
  rank = 0;

  @ApiProperty({ type: String, example: 'A7F3' })
  callsign = '';

  @ApiProperty({ type: Number, example: 1240 })
  points = 0;

  @ApiProperty({
    type: Number,
    description: 'Сдвиг места за сутки: плюс — поднялся',
    example: 2,
  })
  move = 0;

  @ApiPropertyOptional({ type: Boolean })
  me?: boolean;
}

export class LeaderboardDto {
  @ApiProperty({ type: String, example: 'Сезон 39' })
  season = '';

  @ApiProperty({ type: String, example: '2026-09-27T20:59:59.999Z' })
  endsAt = '';

  @ApiProperty({ type: Number, example: 9 })
  total = 0;

  @ApiProperty({ type: () => LeaderRowDto, isArray: true })
  rows: LeaderRowDto[] = [];
}

export class BrigadePlaceDto {
  @ApiProperty({ type: Number, example: 2 })
  rank = 0;

  @ApiProperty({ type: Number, example: 14 })
  total = 0;
}
