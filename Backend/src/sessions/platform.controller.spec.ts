import { RequestMethod, VERSION_NEUTRAL } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  VERSION_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { PlatformServiceGuard } from '../auth/platform-service.guard';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { PlatformController } from './platform.controller';

describe('PlatformController', () => {
  const reflector = new Reflector();

  it('сидит на /api/game/sessions без версии и с Bearer, не с X-Service-Token', () => {
    expect(reflector.get(PATH_METADATA, PlatformController)).toBe('game/sessions');
    expect(reflector.get(VERSION_METADATA, PlatformController)).toBe(VERSION_NEUTRAL);
    expect(reflector.get(IS_PUBLIC_KEY, PlatformController)).toBe(true);
    expect(reflector.get(GUARDS_METADATA, PlatformController)).toEqual([PlatformServiceGuard]);
  });

  it('resolve и finish отвечают 200', () => {
    expect(reflector.get(PATH_METADATA, PlatformController.prototype.resolve)).toBe('resolve');
    expect(reflector.get(METHOD_METADATA, PlatformController.prototype.resolve)).toBe(
      RequestMethod.POST,
    );
    expect(reflector.get(HTTP_CODE_METADATA, PlatformController.prototype.resolve)).toBe(200);
    expect(reflector.get(PATH_METADATA, PlatformController.prototype.finish)).toBe(
      ':attemptId/finish',
    );
    expect(reflector.get(HTTP_CODE_METADATA, PlatformController.prototype.finish)).toBe(200);
  });
});
