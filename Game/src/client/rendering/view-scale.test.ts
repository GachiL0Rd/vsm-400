import { describe, expect, it } from 'vitest';
import { TILE_SIZE, TileLayout } from './tile-layout';
import {
  cameraBand,
  hiDpiGameSize,
  integerArtScale,
  interiorBand,
  markerFontPx,
  pixelCameraLayout,
  worldFromCssPoint,
} from './view-scale';

const TRAIN_FRAME = { x: 0, y: 0, width: 96 * TILE_SIZE, height: 16 * TILE_SIZE };

describe('pixel camera', () => {
  it.each([
    [1600, 900, 2, 3],
    [1920, 1080, 2, 4],
    [2560, 1440, 2, 5],
    [844, 390, 3, 2],
    [667, 375, 3, 2],
  ])(
    'css %sx%s at dpr %s uses art scale %s and fits the interior band',
    (cssW, cssH, dpr, zoom) => {
      const size = hiDpiGameSize(cssW, cssH, dpr);
      const layout = pixelCameraLayout({
        backingWidth: size.backingWidth,
        backingHeight: size.backingHeight,
        cssWidth: cssW,
        cssHeight: cssH,
        frame: TRAIN_FRAME,
        followX: 40 * TILE_SIZE,
        tileSize: TILE_SIZE,
      });
      const band = interiorBand(TILE_SIZE);
      expect(layout.zoom).toBe(zoom);
      expect(Number.isInteger(layout.zoom)).toBe(true);
      expect(layout.worldHeight).toBeGreaterThanOrEqual(band.height);
      expect(layout.worldWidth % 2).toBe(0);
      expect(layout.worldHeight % 2).toBe(0);
      expect(layout.worldTop).toBe(band.y);
      expect(size.scaleZoom).toBe(1 / dpr);
      expect(size.backingWidth).toBe(cssW * dpr);
      expect(size.backingHeight).toBe(cssH * dpr);
    },
  );

  it('falls back to scale 1 when the viewport is shorter than one band', () => {
    expect(integerArtScale(400, interiorBand(TILE_SIZE).height)).toBe(1);
    expect(cameraBand({ y: 10, height: 128 }, TILE_SIZE)).toEqual({ y: 10, height: 128 });
  });

  it('maps a css click on a cell center back onto that cell', () => {
    const cssWidth = 1600;
    const cssHeight = 900;
    const size = hiDpiGameSize(cssWidth, cssHeight, 2);
    const grid = new TileLayout({ x: -16, y: 0 });
    const center = grid.centerFor({ x: 40, y: 8 });
    const layout = pixelCameraLayout({
      backingWidth: size.backingWidth,
      backingHeight: size.backingHeight,
      cssWidth,
      cssHeight,
      frame: TRAIN_FRAME,
      followX: center.x,
      tileSize: TILE_SIZE,
    });
    const cssX =
      ((center.x - layout.worldLeft) * layout.zoom + layout.viewportX) *
      (cssWidth / size.backingWidth);
    const cssY =
      ((center.y - layout.worldTop) * layout.zoom + layout.viewportY) *
      (cssHeight / size.backingHeight);
    const world = worldFromCssPoint(
      cssX,
      cssY,
      cssWidth,
      cssHeight,
      size.backingWidth,
      size.backingHeight,
      layout,
    );
    expect(world.x).toBeCloseTo(center.x, 5);
    expect(world.y).toBeCloseTo(center.y, 5);
    expect(
      grid.cellAt([{ id: 'carriage.x40y8', x: 40, y: 8, regionId: 'carriage' }], world.x, world.y, [
        'carriage',
      ])?.id,
    ).toBe('carriage.x40y8');
  });

  it('keeps marker text near a readable css size', () => {
    expect(markerFontPx(3, 2)).toBeGreaterThanOrEqual(8);
    expect(markerFontPx(2, 3)).toBe(21);
  });
});
