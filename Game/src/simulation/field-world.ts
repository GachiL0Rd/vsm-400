import type { GridWorld } from './grid-world';

/** JSON-compatible material and local sources for one cell. */
export interface CellFieldMaterial {
  readonly cellId: string;
  readonly flammability: number;
  readonly growth: number;
  readonly decay: number;
  readonly permeability: number;
  readonly leak: number;
  readonly fireSource?: number;
  readonly pressureSource?: number;
  readonly initialFire?: number;
  readonly initialPressure?: number;
  readonly fireThreshold?: number;
  readonly pressureThreshold?: number;
  /** Finite combustible reserve. Omit for the legacy/unbounded fire model. */
  readonly initialFuel?: number;
  readonly burnRate?: number;
  readonly spreadFuelScale?: number;
  readonly spreadGateThreshold?: number;
  readonly spreadGain?: number;
}

export interface FieldWorldDefinition {
  readonly cells: readonly CellFieldMaterial[];
}

export interface EdgeTransferScale {
  readonly fire?: number;
  readonly pressure?: number;
}

export interface CellFieldState {
  readonly cellId: string;
  readonly fire: number;
  readonly pressure: number;
  readonly fireSource: number;
  readonly pressureSource: number;
  readonly fuel: number | null;
}

export interface FieldThresholdEvent {
  readonly field: 'fire' | 'pressure';
  readonly cellId: string;
  readonly direction: 'reached' | 'cleared';
  readonly value: number;
  readonly step: number;
}

export interface FieldWorld {
  readonly stepCount: number;
  snapshot(): readonly CellFieldState[];
  /** One synchronous stencil step. Neighbor values come from the previous step. */
  step(dtSeconds?: number): readonly FieldThresholdEvent[];
  addFire(cellId: string, amount: number): readonly FieldThresholdEvent[];
  setFireSource(cellId: string, amount: number): void;
  setPressureSource(cellId: string, amount: number): void;
  setPressure(cellId: string, amount: number): readonly FieldThresholdEvent[];
  /** Extinguisher-style discrete reduction. May emit a cleared threshold immediately. */
  reduceFire(cellId: string, amount: number): readonly FieldThresholdEvent[];
  /** Door or object permeability. Omitted fields keep their current scale. */
  setEdgeTransferScale(edgeId: string, scale: EdgeTransferScale): void;
}

interface RuntimeCell {
  readonly cellId: string;
  readonly flammability: number;
  readonly growth: number;
  readonly decay: number;
  readonly permeability: number;
  readonly leak: number;
  fireSource: number;
  pressureSource: number;
  fire: number;
  pressure: number;
  readonly fireThreshold: number | null;
  readonly pressureThreshold: number | null;
  readonly burnRate: number;
  readonly spreadFuelScale: number;
  readonly spreadGateThreshold: number;
  readonly spreadGain: number;
  fuel: number | null;
}

interface RuntimeEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly fireWeight: number;
  readonly pressureWeight: number;
  fireScale: number;
  pressureScale: number;
}

export function createFieldWorld(grid: GridWorld, definition: FieldWorldDefinition): FieldWorld {
  if (!Array.isArray(definition.cells)) {
    throw new RangeError('Field definition requires a cell array');
  }
  const gridCells = new Set(grid.cells.map((cell) => cell.id));
  const materials = new Map<string, CellFieldMaterial>();
  for (const material of definition.cells) {
    const cellId = validateMaterial(material, gridCells, materials);
    materials.set(cellId, material);
  }
  for (const cellId of gridCells) {
    if (!materials.has(cellId)) throw new RangeError(`Missing field material for cell ${cellId}`);
  }

  const edges = grid.edges.map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    fireWeight: edge.fireTransferWeight,
    pressureWeight: edge.pressureTransferWeight,
    fireScale: 1,
    pressureScale: 1,
  }));
  edges.sort((left, right) => compareIds(left.id, right.id));
  const incoming = new Map<string, RuntimeEdge[]>();
  for (const cellId of gridCells) incoming.set(cellId, []);
  for (const edge of edges) incoming.get(edge.to)?.push(edge);

  const cells: RuntimeCell[] = [...materials.values()]
    .sort((left, right) => compareIds(left.cellId, right.cellId))
    .map((material) => ({
      cellId: material.cellId,
      flammability: material.flammability,
      growth: material.growth,
      decay: material.decay,
      permeability: material.permeability,
      leak: material.leak,
      fireSource: material.fireSource ?? 0,
      pressureSource: material.pressureSource ?? 0,
      fire: material.initialFire ?? 0,
      pressure: material.initialPressure ?? 0,
      fireThreshold: material.fireThreshold ?? null,
      pressureThreshold: material.pressureThreshold ?? null,
      burnRate: material.burnRate ?? 0,
      spreadFuelScale: material.spreadFuelScale ?? 0,
      spreadGateThreshold: material.spreadGateThreshold ?? 1,
      spreadGain: material.spreadGain ?? 1,
      fuel: material.initialFuel ?? null,
    }));

  return new FieldRuntime(cells, new Map(edges.map((edge) => [edge.id, edge])), incoming);
}

class FieldRuntime implements FieldWorld {
  private completedSteps = 0;

  constructor(
    private readonly cells: readonly RuntimeCell[],
    private readonly edges: ReadonlyMap<string, RuntimeEdge>,
    private readonly incoming: ReadonlyMap<string, readonly RuntimeEdge[]>,
  ) {}

  get stepCount(): number {
    return this.completedSteps;
  }

  snapshot(): readonly CellFieldState[] {
    return this.cells.map((cell) => ({
      cellId: cell.cellId,
      fire: cell.fire,
      pressure: cell.pressure,
      fireSource: cell.fireSource,
      pressureSource: cell.pressureSource,
      fuel: cell.fuel,
    }));
  }

  step(dtSeconds = 1): readonly FieldThresholdEvent[] {
    const dt = assertPositiveFinite(dtSeconds, 'Field step dt');
    const previousFire = new Map(this.cells.map((cell) => [cell.cellId, cell.fire]));
    const previousPressure = new Map(this.cells.map((cell) => [cell.cellId, cell.pressure]));
    const next = this.cells.map((cell) => {
      const result = cellFire(cell, this.incoming.get(cell.cellId) ?? [], previousFire, dt);
      const fire = assertNonnegative(result.fire, 'Next fire value');
      const pressure = assertNonnegative(
        cellPressure(cell, this.incoming.get(cell.cellId) ?? [], previousPressure, dt),
        'Next pressure value',
      );
      return { fire, pressure, fuel: result.fuel };
    });
    this.completedSteps += 1;
    const events: FieldThresholdEvent[] = [];
    for (let index = 0; index < this.cells.length; index += 1) {
      const cell = this.cells[index];
      const updated = next[index];
      if (cell === undefined || updated === undefined) continue;
      events.push(
        ...crossings(
          cell.cellId,
          'fire',
          cell.fire,
          updated.fire,
          cell.fireThreshold,
          this.completedSteps,
        ),
        ...crossings(
          cell.cellId,
          'pressure',
          cell.pressure,
          updated.pressure,
          cell.pressureThreshold,
          this.completedSteps,
        ),
      );
      cell.fire = updated.fire;
      cell.pressure = updated.pressure;
      cell.fuel = updated.fuel;
    }
    return events;
  }

  addFire(cellId: string, amount: number): readonly FieldThresholdEvent[] {
    const cell = this.requireCell(cellId);
    const addition = assertNonnegative(amount, 'Fire addition');
    const before = cell.fire;
    cell.fire = assertNonnegative(before + addition, 'Fire value');
    return crossings(
      cell.cellId,
      'fire',
      before,
      cell.fire,
      cell.fireThreshold,
      this.completedSteps,
    );
  }

  setFireSource(cellId: string, amount: number): void {
    this.requireCell(cellId).fireSource = assertNonnegative(amount, 'Fire source');
  }

  setPressureSource(cellId: string, amount: number): void {
    this.requireCell(cellId).pressureSource = assertNonnegative(amount, 'Pressure source');
  }

  setPressure(cellId: string, amount: number): readonly FieldThresholdEvent[] {
    const cell = this.requireCell(cellId);
    const before = cell.pressure;
    cell.pressure = assertNonnegative(amount, 'Pressure value');
    return crossings(
      cell.cellId,
      'pressure',
      before,
      cell.pressure,
      cell.pressureThreshold,
      this.completedSteps,
    );
  }

  reduceFire(cellId: string, amount: number): readonly FieldThresholdEvent[] {
    const cell = this.requireCell(cellId);
    const reduction = assertNonnegative(amount, 'Fire reduction');
    const before = cell.fire;
    cell.fire = Math.max(0, before - reduction);
    return crossings(
      cell.cellId,
      'fire',
      before,
      cell.fire,
      cell.fireThreshold,
      this.completedSteps,
    );
  }

  setEdgeTransferScale(edgeId: string, scale: EdgeTransferScale): void {
    const edge = this.edges.get(edgeId);
    if (edge === undefined) throw new RangeError(`Unknown edge ${edgeId}`);
    if (scale.fire === undefined && scale.pressure === undefined) {
      throw new RangeError('Edge transfer scale requires fire or pressure');
    }
    const fire =
      scale.fire === undefined
        ? edge.fireScale
        : assertNonnegative(scale.fire, 'Fire transfer scale');
    const pressure =
      scale.pressure === undefined
        ? edge.pressureScale
        : assertNonnegative(scale.pressure, 'Pressure transfer scale');
    edge.fireScale = fire;
    edge.pressureScale = pressure;
  }

  private requireCell(cellId: string): RuntimeCell {
    const cell = this.cells.find((item) => item.cellId === cellId);
    if (cell === undefined) throw new RangeError(`Unknown field cell ${cellId}`);
    return cell;
  }
}

function cellFire(
  cell: RuntimeCell,
  incoming: readonly RuntimeEdge[],
  previous: ReadonlyMap<string, number>,
  dt: number,
): { fire: number; fuel: number | null } {
  const fuel = cell.fuel === null ? null : Math.max(0, cell.fuel - cell.burnRate * dt * cell.fire);
  const combustible = fuel === null || fuel > 0;
  const gate =
    fuel === null ? 1 : Math.max(0, cell.spreadGateThreshold - cell.spreadFuelScale * fuel);
  let transferred = 0;
  for (const edge of incoming) {
    transferred +=
      (previous.get(edge.from) ?? 0) *
      edge.fireWeight *
      edge.fireScale *
      cell.spreadGain *
      gate *
      dt;
  }
  const grown = combustible ? cell.fire * cell.flammability * cell.growth * dt : 0;
  const source = combustible ? cell.fireSource * dt : 0;
  return {
    fire: Math.max(0, cell.fire + grown + transferred + source - cell.decay * dt),
    fuel,
  };
}

function cellPressure(
  cell: RuntimeCell,
  incoming: readonly RuntimeEdge[],
  previous: ReadonlyMap<string, number>,
  dt: number,
): number {
  let transferred = 0;
  for (const edge of incoming) {
    const weight = edge.pressureWeight * edge.pressureScale * cell.permeability;
    transferred += (previous.get(edge.from) ?? 0) * weight * dt;
  }
  return Math.max(0, cell.pressure + transferred + cell.pressureSource * dt - cell.leak * dt);
}

function crossings(
  cellId: string,
  field: 'fire' | 'pressure',
  before: number,
  after: number,
  threshold: number | null,
  step: number,
): FieldThresholdEvent[] {
  if (threshold === null) return [];
  if (before < threshold && after >= threshold) {
    return [{ field, cellId, direction: 'reached', value: after, step }];
  }
  if (before >= threshold && after < threshold) {
    return [{ field, cellId, direction: 'cleared', value: after, step }];
  }
  return [];
}

function validateMaterial(
  material: CellFieldMaterial,
  gridCells: ReadonlySet<string>,
  seen: ReadonlyMap<string, CellFieldMaterial>,
): string {
  const cellId = assertId(material.cellId, 'Cell id');
  if (!gridCells.has(cellId)) throw new RangeError(`Unknown field cell ${cellId}`);
  if (seen.has(cellId)) throw new RangeError(`Duplicate field material for cell ${cellId}`);
  assertNonnegative(material.flammability, 'Flammability');
  assertNonnegative(material.growth, 'Fire growth');
  assertNonnegative(material.decay, 'Fire decay');
  assertNonnegative(material.permeability, 'Pressure permeability');
  assertNonnegative(material.leak, 'Pressure leak');
  if (material.fireSource !== undefined) assertNonnegative(material.fireSource, 'Fire source');
  if (material.pressureSource !== undefined) {
    assertNonnegative(material.pressureSource, 'Pressure source');
  }
  if (material.initialFire !== undefined) assertNonnegative(material.initialFire, 'Initial fire');
  if (material.initialPressure !== undefined) {
    assertNonnegative(material.initialPressure, 'Initial pressure');
  }
  if (material.fireThreshold !== undefined)
    assertNonnegative(material.fireThreshold, 'Fire threshold');
  if (material.pressureThreshold !== undefined) {
    assertNonnegative(material.pressureThreshold, 'Pressure threshold');
  }
  if (material.initialFuel !== undefined) assertNonnegative(material.initialFuel, 'Initial fuel');
  if (material.burnRate !== undefined) assertNonnegative(material.burnRate, 'Burn rate');
  if (material.spreadFuelScale !== undefined)
    assertNonnegative(material.spreadFuelScale, 'Spread fuel scale');
  if (material.spreadGateThreshold !== undefined)
    assertNonnegative(material.spreadGateThreshold, 'Spread gate threshold');
  if (material.spreadGain !== undefined) assertNonnegative(material.spreadGain, 'Spread gain');
  return cellId;
}

function assertPositiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function assertId(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RangeError(`${label} must be a non-empty string`);
  }
  return value;
}

function assertNonnegative(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative finite number`);
  }
  return value;
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
