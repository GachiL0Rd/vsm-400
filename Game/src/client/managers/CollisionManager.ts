import { findRoute, isWalkable, neighbours, sameTile, type Tile } from '../map';

/** Client-only occupancy and routes. The server still validates zone transitions and actions. */
export class CollisionManager {
  constructor(
    private readonly playerTile: () => Tile,
    private readonly npcTiles: () => ReadonlyMap<string, Tile>,
  ) {}

  occupiedNpcTiles(exceptId?: string): Tile[] {
    return [...this.npcTiles()].filter(([id]) => id !== exceptId).map(([, tile]) => tile);
  }

  isOccupiedForNpc(tile: Tile, id: string): boolean {
    return (
      sameTile(tile, this.playerTile()) ||
      this.occupiedNpcTiles(id).some((occupied) => sameTile(occupied, tile))
    );
  }

  planPlayerRoute(from: Tile, target: Tile): { route: Tile[]; destination: Tile } | null {
    const occupied = this.occupiedNpcTiles();
    const targetIsOccupied = occupied.some((tile) => sameTile(tile, target));
    const candidates = targetIsOccupied || !isWalkable(target) ? neighbours(target) : [target];
    const routes = candidates
      .filter((tile) => isWalkable(tile) && !occupied.some((npcTile) => sameTile(npcTile, tile)))
      .map((destination) => ({ destination, route: findRoute(from, destination, occupied) }))
      .filter((plan) => plan.route.length > 0 || sameTile(from, plan.destination))
      .sort((a, b) => a.route.length - b.route.length);
    return routes[0] ?? null;
  }

  planNpcRoute(from: Tile, target: Tile, id: string): Tile[] {
    if (sameTile(from, target)) return [];
    const blocked = [this.playerTile(), ...this.occupiedNpcTiles(id)];
    const available = (tile: Tile): boolean =>
      isWalkable(tile) && !blocked.some((occupied) => sameTile(occupied, tile));
    const starts = isWalkable(from) ? [from] : neighbours(from).filter(available);
    const ends = isWalkable(target) ? [target] : neighbours(target).filter(available);
    const routes: Tile[][] = [];
    for (const start of starts) {
      for (const end of ends) {
        const route = this.npcRouteBetween(start, end, from, target, blocked);
        if (route !== null) routes.push(route);
      }
    }
    return routes.sort((a, b) => a.length - b.length)[0] ?? [];
  }

  private npcRouteBetween(
    start: Tile,
    end: Tile,
    from: Tile,
    target: Tile,
    blocked: readonly Tile[],
  ): Tile[] | null {
    const middle = findRoute(start, end, blocked);
    if (middle.length === 0 && !sameTile(start, end)) return null;
    return [
      ...(sameTile(start, from) ? [] : [start]),
      ...middle,
      ...(sameTile(end, target) ? [] : [target]),
    ];
  }
}
