import { randomUUID } from 'node:crypto';

type Row = Record<string, unknown>;

type Args = {
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
  select?: Record<string, boolean>;
  include?: unknown;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  take?: number;
};

export type MemoryUser = {
  id: string;
  login: string;
  passwordHash: string;
  role: string;
  callsign: string;
  extHash: string | null;
  position: string;
  grade: string;
  brigadeId: string | null;
  mustChangePassword: boolean;
  disabledAt: Date | null;
  createdAt: Date;
  lastRunAt: Date | null;
  streakDays: number;
};

type MemoryClient = {
  id: string;
  name: string;
  keyHash: string;
  scopes: string[];
  createdAt: Date;
  revokedAt: Date | null;
};

type MemoryDepot = { id: string; code: string; name: string; city: string };
type MemoryBrigade = { id: string; code: string; name: string; depotId: string };

export type MemorySubscription = {
  id: string;
  apiClientId: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
};

export type MemoryDelivery = {
  id: string;
  subscriptionId: string;
  event: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  createdAt: Date;
};

function pick<T extends Row>(row: T, select?: Record<string, boolean>): T {
  if (!select) {
    return row;
  }
  const out: Row = {};
  for (const [key, enabled] of Object.entries(select)) {
    if (enabled) {
      out[key] = row[key];
    }
  }
  return out as T;
}

function connectId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('connect' in value)) {
    return undefined;
  }
  const connect = value.connect;
  if (typeof connect !== 'object' || connect === null || !('id' in connect)) {
    return undefined;
  }
  return typeof connect.id === 'string' ? connect.id : undefined;
}

function atPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Row)[key];
  }
  return current;
}

function payloadEquals(payload: unknown, filter: unknown): boolean {
  if (typeof filter !== 'object' || filter === null) {
    return false;
  }
  const path = 'path' in filter && Array.isArray(filter.path) ? filter.path : undefined;
  if (!path) {
    return true;
  }
  const keys = path.filter((item): item is string => typeof item === 'string');
  return atPath(payload, keys) === ('equals' in filter ? filter.equals : undefined);
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return new Date(value);
  }
  return null;
}

function sameString(expected: unknown, actual: string): boolean {
  return typeof expected !== 'string' || expected === actual;
}

function notAfter(row: MemoryDelivery, where: Record<string, unknown>): boolean {
  const next = where.nextAttemptAt;
  if (typeof next !== 'object' || next === null || !('lte' in next)) {
    return true;
  }
  const lte = asDate(next.lte);
  return lte === null || row.nextAttemptAt.getTime() <= lte.getTime();
}

/** Минимальный Prisma для e2e интеграции: без живой базы `npm test` остаётся зелёным. */
export class MemoryPrisma {
  readonly users: MemoryUser[] = [];
  readonly clients: MemoryClient[] = [];
  readonly depots: MemoryDepot[] = [];
  readonly brigades: MemoryBrigade[] = [];
  readonly subscriptions: MemorySubscription[] = [];
  readonly deliveries: MemoryDelivery[] = [];

  seedOrg(): void {
    const depot: MemoryDepot = {
      id: randomUUID(),
      code: 'MSK',
      name: 'Depot MSK',
      city: 'Москва',
    };
    this.depots.push(depot);
    this.brigades.push({
      id: randomUUID(),
      code: '12',
      name: 'Бригада 12',
      depotId: depot.id,
    });
  }

  dump(): unknown {
    return {
      users: this.users,
      clients: this.clients,
      subscriptions: this.subscriptions,
      deliveries: this.deliveries,
    };
  }

  readonly $transaction = async <T>(fn: (tx: MemoryPrisma) => Promise<T>): Promise<T> => fn(this);

  readonly user = {
    findUnique: (args: Args) => this.findUser(args),
    create: (args: Args) => this.createUser(args),
    update: (args: Args) => this.updateUser(args),
  };

  readonly depot = {
    findUnique: (args: Args) => {
      const code = args.where?.code;
      return this.depots.find((depot) => depot.code === code) ?? null;
    },
    findMany: () =>
      this.depots
        .slice()
        .sort((left, right) => left.code.localeCompare(right.code))
        .map((depot) => ({
          ...depot,
          brigades: this.brigades
            .filter((brigade) => brigade.depotId === depot.id)
            .sort((left, right) => left.code.localeCompare(right.code))
            .map((brigade) => ({
              ...brigade,
              _count: {
                users: this.users.filter(
                  (user) => user.brigadeId === brigade.id && user.disabledAt === null,
                ).length,
              },
            })),
        })),
  };

  readonly brigade = {
    findUnique: (args: Args) => {
      const key = args.where?.depotId_code;
      if (typeof key !== 'object' || key === null) {
        return null;
      }
      const depotId = 'depotId' in key ? key.depotId : undefined;
      const code = 'code' in key ? key.code : undefined;
      return (
        this.brigades.find((brigade) => brigade.depotId === depotId && brigade.code === code) ??
        null
      );
    },
  };

  readonly apiClient = {
    create: (args: Args) => this.createClient(args),
    findMany: (args: Args) => this.listClients(args),
    findUnique: (args: Args) => this.findClient(args),
    update: (args: Args) => this.updateClient(args),
  };

  readonly webhookSubscription = {
    create: (args: Args) => this.createSubscription(args),
    findMany: (args: Args) => this.listSubscriptions(args),
    findFirst: (args: Args) => this.findSubscription(args),
    delete: (args: Args) => {
      const index = this.subscriptions.findIndex((row) => row.id === args.where?.id);
      if (index < 0) {
        throw new Error('subscription missing');
      }
      const [removed] = this.subscriptions.splice(index, 1);
      return removed;
    },
  };

  readonly webhookDelivery = {
    create: (args: Args) => this.createDelivery(args),
    findMany: (args: Args) => this.listDeliveries(args),
    findFirst: (args: Args) => this.findDelivery(args),
    findUnique: (args: Args) => this.findDeliveryById(args),
    updateMany: (args: Args) => this.claimDeliveries(args),
    update: (args: Args) => this.updateDelivery(args),
    deleteMany: (args: Args) => {
      const subscriptionId = args.where?.subscriptionId;
      let count = 0;
      for (let index = this.deliveries.length - 1; index >= 0; index -= 1) {
        if (this.deliveries[index]?.subscriptionId === subscriptionId) {
          this.deliveries.splice(index, 1);
          count += 1;
        }
      }
      return { count };
    },
  };

  readonly pointLedger = {
    aggregate: async () => ({ _sum: { amount: null as number | null } }),
  };

  readonly run = {
    groupBy: async () => [] as { outcome: string; _count: { _all: number } }[],
  };

  readonly competencyScore = {
    findMany: async () => [] as { competency: string; value: number }[],
  };

  readonly userAchievement = {
    findMany: async () => [] as { code: string; earnedAt: Date | null }[],
  };

  readonly promotionRecommendation = {
    findFirst: async () => null,
  };

  private findUser(args: Args): MemoryUser | null {
    const where = args.where ?? {};
    const user = this.users.find((row) => {
      if (typeof where.id === 'string') {
        return row.id === where.id;
      }
      if (typeof where.extHash === 'string') {
        return row.extHash === where.extHash;
      }
      if (typeof where.callsign === 'string') {
        return row.callsign === where.callsign;
      }
      if (typeof where.login === 'string') {
        return row.login === where.login;
      }
      return false;
    });
    return user ? pick(user, args.select) : null;
  }

  private createUser(args: Args): MemoryUser {
    const data = args.data ?? {};
    const user: MemoryUser = {
      id: randomUUID(),
      login: String(data.login),
      passwordHash: String(data.passwordHash),
      role: String(data.role),
      callsign: String(data.callsign),
      extHash: typeof data.extHash === 'string' ? data.extHash : null,
      position: String(data.position),
      grade: String(data.grade),
      brigadeId: connectId(data.brigade) ?? null,
      mustChangePassword: data.mustChangePassword === true,
      disabledAt: null,
      createdAt: new Date(),
      lastRunAt: null,
      streakDays: 0,
    };
    this.users.push(user);
    return pick(user, args.select);
  }

  private updateUser(args: Args): MemoryUser {
    const user = this.users.find((row) => row.id === args.where?.id);
    if (!user) {
      throw new Error('user missing');
    }
    const data = args.data ?? {};
    if (typeof data.role === 'string') {
      user.role = data.role;
    }
    if (typeof data.position === 'string') {
      user.position = data.position;
    }
    if (typeof data.grade === 'string') {
      user.grade = data.grade;
    }
    const brigadeId = connectId(data.brigade);
    if (brigadeId) {
      user.brigadeId = brigadeId;
    }
    return pick(user, args.select);
  }

  private createClient(args: Args): MemoryClient {
    const data = args.data ?? {};
    const client: MemoryClient = {
      id: randomUUID(),
      name: String(data.name),
      keyHash: String(data.keyHash),
      scopes: Array.isArray(data.scopes) ? data.scopes.map(String) : [],
      createdAt: new Date(),
      revokedAt: null,
    };
    this.clients.push(client);
    return pick(client, args.select);
  }

  private listClients(args: Args): MemoryClient[] {
    const rows = this.clients
      .slice()
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    return rows.map((row) => pick(row, args.select));
  }

  private findClient(args: Args): MemoryClient | null {
    const where = args.where ?? {};
    const client = this.clients.find((row) => {
      if (typeof where.id === 'string') {
        return row.id === where.id;
      }
      if (typeof where.keyHash === 'string') {
        return row.keyHash === where.keyHash;
      }
      return false;
    });
    return client ? pick(client, args.select) : null;
  }

  private updateClient(args: Args): MemoryClient {
    const client = this.clients.find((row) => row.id === args.where?.id);
    if (!client) {
      throw new Error('client missing');
    }
    const revokedAt = asDate(args.data?.revokedAt);
    if (revokedAt) {
      client.revokedAt = revokedAt;
    }
    return pick(client, args.select);
  }

  private createSubscription(args: Args): MemorySubscription {
    const data = args.data ?? {};
    const events = Array.isArray(data.events) ? data.events.map(String) : [];
    const row: MemorySubscription = {
      id: randomUUID(),
      apiClientId: connectId(data.apiClient) ?? '',
      url: String(data.url),
      events,
      secret: String(data.secret),
      active: data.active !== false,
    };
    this.subscriptions.push(row);
    return pick(row, args.select);
  }

  private listSubscriptions(args: Args): MemorySubscription[] {
    const where = args.where ?? {};
    let rows = this.subscriptions.slice();
    if (typeof where.apiClientId === 'string') {
      rows = rows.filter((row) => row.apiClientId === where.apiClientId);
    }
    if (where.active === true) {
      rows = rows.filter((row) => row.active);
    }
    const events = where.events;
    if (typeof events === 'object' && events !== null && 'has' in events) {
      const event = events.has;
      rows = rows.filter((row) => typeof event === 'string' && row.events.includes(event));
    }
    const apiClient = where.apiClient;
    if (
      typeof apiClient === 'object' &&
      apiClient !== null &&
      'revokedAt' in apiClient &&
      apiClient.revokedAt === null
    ) {
      rows = rows.filter((row) => {
        const client = this.clients.find((item) => item.id === row.apiClientId);
        return client?.revokedAt === null;
      });
    }
    const order = args.orderBy;
    if (
      typeof order === 'object' &&
      order !== null &&
      !Array.isArray(order) &&
      order.id === 'asc'
    ) {
      rows.sort((left, right) => left.id.localeCompare(right.id));
    }
    return rows.map((row) => pick(row, args.select));
  }

  private findSubscription(args: Args): MemorySubscription | null {
    const where = args.where ?? {};
    const row = this.subscriptions.find((item) => {
      if (typeof where.id === 'string' && item.id !== where.id) {
        return false;
      }
      if (typeof where.apiClientId === 'string' && item.apiClientId !== where.apiClientId) {
        return false;
      }
      return typeof where.id === 'string' || typeof where.apiClientId === 'string';
    });
    return row ? pick(row, args.select) : null;
  }

  private createDelivery(args: Args): MemoryDelivery {
    const data = args.data ?? {};
    const payload =
      typeof data.payload === 'object' && data.payload !== null
        ? (data.payload as Record<string, unknown>)
        : {};
    const row: MemoryDelivery = {
      id: typeof data.id === 'string' ? data.id : randomUUID(),
      subscriptionId: connectId(data.subscription) ?? '',
      event: String(data.event),
      payload,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: asDate(data.nextAttemptAt) ?? new Date(),
      lastError: null,
      createdAt: new Date(),
    };
    this.deliveries.push(row);
    return row;
  }

  private deliveryMatches(row: MemoryDelivery, where: Record<string, unknown>): boolean {
    if (!sameString(where.subscriptionId, row.subscriptionId)) {
      return false;
    }
    if (!sameString(where.event, row.event)) {
      return false;
    }
    if (where.payload && !payloadEquals(row.payload, where.payload)) {
      return false;
    }
    return this.andMatches(row, where.AND);
  }

  private andMatches(row: MemoryDelivery, parts: unknown): boolean {
    if (!Array.isArray(parts)) {
      return true;
    }
    for (const part of parts) {
      if (typeof part !== 'object' || part === null) {
        return false;
      }
      if (!this.deliveryMatches(row, part as Record<string, unknown>)) {
        return false;
      }
    }
    return true;
  }

  private findDelivery(args: Args): MemoryDelivery | null {
    const where = args.where ?? {};
    const row = this.deliveries.find((item) => this.deliveryMatches(item, where));
    return row ? pick(row, args.select) : null;
  }

  private listDeliveries(args: Args): MemoryDelivery[] {
    const where = args.where ?? {};
    let rows = this.deliveries.filter(
      (row) => sameString(where.status, row.status) && notAfter(row, where),
    );
    const order = args.orderBy;
    if (
      typeof order === 'object' &&
      order !== null &&
      !Array.isArray(order) &&
      order.nextAttemptAt === 'asc'
    ) {
      rows = rows
        .slice()
        .sort((left, right) => left.nextAttemptAt.getTime() - right.nextAttemptAt.getTime());
    }
    if (typeof args.take === 'number') {
      rows = rows.slice(0, args.take);
    }
    return rows.map((row) => pick(row, args.select));
  }

  private claimDeliveries(args: Args): { count: number } {
    const where = args.where ?? {};
    const nextAttemptAt = asDate(args.data?.nextAttemptAt);
    let count = 0;
    for (const row of this.deliveries) {
      if (!this.claimable(row, where)) {
        continue;
      }
      if (nextAttemptAt) {
        row.nextAttemptAt = nextAttemptAt;
      }
      count += 1;
    }
    return { count };
  }

  private claimable(row: MemoryDelivery, where: Record<string, unknown>): boolean {
    return (
      sameString(where.id, row.id) && sameString(where.status, row.status) && notAfter(row, where)
    );
  }

  private findDeliveryById(
    args: Args,
  ): MemoryDelivery | (MemoryDelivery & { subscription: Row }) | null {
    const row = this.deliveries.find((item) => item.id === args.where?.id);
    if (!row || !args.include) {
      return row ? pick(row, args.select) : null;
    }
    const subscription = this.subscriptions.find((item) => item.id === row.subscriptionId);
    const client = this.clients.find((item) => item.id === subscription?.apiClientId);
    return {
      ...row,
      subscription: {
        url: subscription?.url ?? '',
        secret: subscription?.secret ?? '',
        active: subscription?.active ?? false,
        apiClient: { revokedAt: client?.revokedAt ?? null },
      },
    };
  }

  private updateDelivery(args: Args): MemoryDelivery {
    const row = this.deliveries.find((item) => item.id === args.where?.id);
    if (!row) {
      throw new Error('delivery missing');
    }
    const data = args.data ?? {};
    if (typeof data.status === 'string') {
      row.status = data.status as MemoryDelivery['status'];
    }
    if (typeof data.attempts === 'number') {
      row.attempts = data.attempts;
    }
    const nextAttemptAt = asDate(data.nextAttemptAt);
    if (nextAttemptAt) {
      row.nextAttemptAt = nextAttemptAt;
    }
    if ('lastError' in data) {
      row.lastError = typeof data.lastError === 'string' ? data.lastError : null;
    }
    return row;
  }
}
