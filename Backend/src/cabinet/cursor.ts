import { UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';

const CursorSchema = z.object({
  finishedAt: z.iso.datetime(),
  id: z.uuid(),
});

export function encodeCursor(finishedAt: Date, id: string): string {
  const payload = JSON.stringify({ finishedAt: finishedAt.toISOString(), id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): { finishedAt: Date; id: string } {
  const parsed = CursorSchema.safeParse(readJson(raw));
  if (!parsed.success) {
    throw new UnprocessableEntityException({
      message: 'Курсор не читается',
      code: 'CURSOR_INVALID',
    });
  }
  return { finishedAt: new Date(parsed.data.finishedAt), id: parsed.data.id };
}

function readJson(raw: string): unknown {
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
