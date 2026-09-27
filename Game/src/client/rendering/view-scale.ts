import type { WorldFrame } from './tile-layout';

/** Train2 map rows that hold wall seats, the aisle and floor seats. */
export const INTERIOR_ROW_START = 5;
export const INTERIOR_ROW_END = 12;

const NARROW_CSS_WIDTH = 760;
const PHONE_LANDSCAPE_CSS_HEIGHT = 500;
const NARROW_TOP_CSS = 166;
const NARROW_BOTTOM_CSS = 82;
const MARKER_TARGET_CSS_PX = 14;

export interface HiDpiGameSize {
  readonly backingWidth: number;
  readonly backingHeight: number;
  readonly scaleZoom: number;
}

export interface ReservedBands {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}

export interface PixelCameraLayout {
  readonly zoom: number;
  readonly viewportX: number;
  readonly viewportY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly worldLeft: number;
  readonly worldTop: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly bandY: number;
  readonly bandHeight: number;
}

/** Backing-store pixels and the Scale Manager zoom that maps them onto CSS pixels. */
export function hiDpiGameSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): HiDpiGameSize {
  const dpr = positive(devicePixelRatio, 1);
  const cssW = Math.max(1, Math.round(finite(cssWidth)));
  const cssH = Math.max(1, Math.round(finite(cssHeight)));
  return {
    backingWidth: Math.max(1, Math.round(cssW * dpr)),
    backingHeight: Math.max(1, Math.round(cssH * dpr)),
    scaleZoom: 1 / dpr,
  };
}

/** Largest integer device-pixels-per-art-pixel at which `bandWorldPx` still fits. */
export function integerArtScale(viewportDevicePx: number, bandWorldPx: number): number {
  if (viewportDevicePx <= 0 || bandWorldPx <= 0) return 1;
  if (!Number.isFinite(viewportDevicePx) || !Number.isFinite(bandWorldPx)) return 1;
  return Math.max(1, Math.floor(viewportDevicePx / bandWorldPx));
}

/**
 * Viewport length in device pixels whose world size (`length / zoom`) is a positive even integer.
 * An even world size keeps a centered camera on whole art pixels.
 */
export function crispViewport(devicePx: number, zoom: number): number {
  const size = finite(devicePx);
  const step = Math.floor(finite(zoom));
  if (size <= 1 || step < 1) return Math.max(1, Math.floor(size));
  const world = Math.floor(size / step);
  const evenWorld = world - (world % 2);
  if (evenWorld < 2) return Math.max(1, Math.floor(size));
  return evenWorld * step;
}

export function interiorBand(tileSize: number): { y: number; height: number } {
  const rows = INTERIOR_ROW_END - INTERIOR_ROW_START + 1;
  return { y: INTERIOR_ROW_START * tileSize, height: rows * tileSize };
}

/** Use the interior band when the frame contains it; otherwise frame the whole level. */
export function cameraBand(
  frame: Pick<WorldFrame, 'y' | 'height'>,
  tileSize: number,
): { y: number; height: number } {
  const band = interiorBand(tileSize);
  const covers = frame.y <= band.y && frame.y + frame.height >= band.y + band.height;
  return covers ? band : { y: frame.y, height: Math.max(tileSize, frame.height) };
}

export function reservedBands(cssWidth: number, cssHeight: number, dpr: number): ReservedBands {
  const ratio = positive(dpr, 1);
  const phoneLandscape = cssHeight <= PHONE_LANDSCAPE_CSS_HEIGHT && cssWidth > cssHeight;
  const narrow = cssWidth <= NARROW_CSS_WIDTH && !phoneLandscape;
  if (!narrow) return { left: 0, top: 0, bottom: 0 };
  return {
    left: 0,
    top: Math.round(NARROW_TOP_CSS * ratio),
    bottom: Math.round(NARROW_BOTTOM_CSS * ratio),
  };
}

export function pixelCameraLayout(input: {
  readonly backingWidth: number;
  readonly backingHeight: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly frame: WorldFrame;
  readonly followX: number;
  readonly tileSize: number;
}): PixelCameraLayout {
  const cssWidth = Math.max(1, finite(input.cssWidth));
  const dpr = input.backingWidth / cssWidth;
  const bands = reservedBands(input.cssWidth, input.cssHeight, dpr);
  const band = cameraBand(input.frame, input.tileSize);
  const availableW = Math.max(1, input.backingWidth - bands.left);
  const availableH = Math.max(1, input.backingHeight - bands.top - bands.bottom);
  const zoom = integerArtScale(availableH, band.height);
  const viewportWidth = Math.min(availableW, crispViewport(availableW, zoom));
  const viewportHeight = Math.min(availableH, crispViewport(availableH, zoom));
  const viewportX = bands.left + Math.floor((availableW - viewportWidth) / 2);
  const viewportY = bands.top + Math.floor((availableH - viewportHeight) / 2);
  const worldWidth = viewportWidth / zoom;
  const worldHeight = viewportHeight / zoom;
  return {
    zoom,
    viewportX,
    viewportY,
    viewportWidth,
    viewportHeight,
    worldWidth,
    worldHeight,
    worldLeft: Math.round(input.followX) - worldWidth / 2,
    worldTop: worldViewTop(worldHeight, band.y, band.height),
    bandY: band.y,
    bandHeight: band.height,
  };
}

/** Top of the world view after the vertical band clamp. Taller views pin to the band top. */
export function worldViewTop(worldHeight: number, bandY: number, bandHeight: number): number {
  if (worldHeight >= bandHeight) return bandY;
  return bandY + Math.floor((bandHeight - worldHeight) / 2);
}

/** CSS offset inside the canvas → game pixel. Mirrors ScaleManager displayScale. */
export function cssPointToGame(cssOffset: number, backing: number, cssSize: number): number {
  if (
    !Number.isFinite(cssOffset) ||
    !Number.isFinite(backing) ||
    !Number.isFinite(cssSize) ||
    cssSize === 0
  ) {
    return 0;
  }
  return (cssOffset * backing) / cssSize;
}

/** Axis-aligned camera with integer zoom. `pointer` is in game pixels. */
export function worldFromCssPoint(
  cssX: number,
  cssY: number,
  cssWidth: number,
  cssHeight: number,
  backingWidth: number,
  backingHeight: number,
  camera: PixelCameraLayout,
): { x: number; y: number } {
  const gameX = cssPointToGame(cssX, backingWidth, cssWidth);
  const gameY = cssPointToGame(cssY, backingHeight, cssHeight);
  return {
    x: camera.worldLeft + (gameX - camera.viewportX) / camera.zoom,
    y: camera.worldTop + (gameY - camera.viewportY) / camera.zoom,
  };
}

/** World-pixel font size that lands near `MARKER_TARGET_CSS_PX` after camera zoom and DPR. */
export function markerFontPx(cameraZoom: number, devicePixelRatio: number): number {
  const zoom = positive(cameraZoom, 1);
  const dpr = positive(devicePixelRatio, 1);
  return Math.max(8, Math.round((MARKER_TARGET_CSS_PX * dpr) / zoom));
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
