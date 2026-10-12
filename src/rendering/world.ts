/**
 * World layout in metres (y up, camera in front looking toward −z). One
 * bench: the enlarger on the left, three trays to the right, a safelight on
 * the wall, and a drying line for the finished print.
 */
export const BENCH = { minX: -1.05, maxX: 1.35, minZ: -0.56, maxZ: 0.46, top: 0 };
export const WALL_Z = -0.56;

export const BASEBOARD = { x: -0.56, z: -0.06, w: 0.52, d: 0.62, h: 0.022 };
export const EASEL = { x: -0.56, z: 0.0, w: 0.34, d: 0.3, h: 0.012 };
/** paper rests on the easel surface */
export const EASEL_TOP = BASEBOARD.h + EASEL.h;
export const LENS = { x: -0.56, y: 0.46, z: 0.0 };
export const COLUMN = { x: -0.56, z: -0.34, r: 0.022, h: 1.02 };

export interface TrayDef {
  id: 'developer' | 'stop' | 'fix';
  label: string;
  x: number;
  z: number;
  color: number;
  liquid: number;
  attenuation: number;
}

/** interior size of an 11×14 inch tray */
export const TRAY = { w: 0.37, d: 0.3, wall: 0.012, h: 0.058, floor: 0.008, liquid: 0.034 };
export const TRAYS: TrayDef[] = [
  { id: 'developer', label: 'DEV', x: 0.06, z: 0.03, color: 0xa8a39a, liquid: 0xfffaf0, attenuation: 0xf3e6c6 },
  { id: 'stop', label: 'STOP', x: 0.52, z: 0.03, color: 0x5c1d18, liquid: 0xfffbea, attenuation: 0xf5ec9a },
  { id: 'fix', label: 'FIX', x: 0.98, z: 0.03, color: 0x4a4d52, liquid: 0xffffff, attenuation: 0xe8eef2 },
];

export function trayById(id: TrayDef['id']): TrayDef {
  return TRAYS.find((t) => t.id === id)!;
}

export const SAFELIGHT = { x: 0.3, y: 0.9, z: WALL_Z + 0.06 };
export const DRYING_LINE = { y: 0.86, z: -0.2, x0: -0.35, x1: 1.4 };
/** where the finished print hangs */
export const HANG = { x: 0.96, y: DRYING_LINE.y, z: DRYING_LINE.z };

/** 8×10 sheet in metres for a layout in inches. */
export const INCH = 0.0254;
