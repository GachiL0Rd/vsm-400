import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { parseApiKey, secretMatches } from './api-key';
import { API_SCOPES_KEY, type ApiScope } from './api-scopes';
import { httpError } from './http-error';

export type ApiClientContext = {
  id: string;
  name: string;
  scopes: string[];
};

type HeaderMap = Record<string, string | string[] | undefined>;

export type ApiRequest = {
  headers: HeaderMap;
  apiClient?: ApiClientContext;
};

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const required = this.requiredScopes(context);
    const header = readHeader(request.headers);
    if (header === undefined) {
      throw httpError(401, 'Нет ключа API', 'API_KEY_MISSING');
    }
    const parsed = header === null ? null : parseApiKey(header);
    if (!parsed) {
      throw httpError(401, 'Неверный ключ API', 'API_KEY_INVALID');
    }
    const client = await this.prisma.apiClient.findUnique({ where: { id: parsed.id } });
    if (!client || !secretMatches(client.keyHash, parsed.secret)) {
      throw httpError(401, 'Неверный ключ API', 'API_KEY_INVALID');
    }
    if (client.revokedAt) {
      throw httpError(401, 'Ключ отозван', 'API_KEY_REVOKED');
    }
    assertScopes(client.scopes, required);
    request.apiClient = { id: client.id, name: client.name, scopes: [...client.scopes] };
    return true;
  }

  private requiredScopes(context: ExecutionContext): readonly ApiScope[] {
    const scopes = this.reflector.getAllAndOverride<readonly ApiScope[] | undefined>(
      API_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!scopes || scopes.length === 0) {
      throw httpError(403, 'У ручки нет scope', 'API_KEY_SCOPE');
    }
    return scopes;
  }
}

function readHeader(headers: HeaderMap): string | null | undefined {
  const value = headers['x-api-key'];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return value;
}

function assertScopes(granted: readonly string[], required: readonly ApiScope[]): void {
  const missing = required.filter((scope) => !granted.includes(scope));
  if (missing.length > 0) {
    throw httpError(403, `Ключу не хватает прав: ${missing.join(', ')}`, 'API_KEY_SCOPE');
  }
}
