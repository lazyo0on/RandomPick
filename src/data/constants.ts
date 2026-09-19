export const initialZoom = 30;
export const canvasWidth = 1600;
export const canvasHeight = 900;
export const zoomThreshold = 5;
export const STUCK_DELAY = 5000;

/**
 * Marble weight when every entered name has the same weight, i.e. nobody
 * used the `name/3` syntax. Controls skill cooldown and skill chance.
 */
export const NEUTRAL_WEIGHT = 0.5;

export enum Skills {
  None,
  Impact,
  Teleport,
}

export const DefaultEntityColor = {
  box: 'cyan',
  circle: 'yellow',
  polyline: 'white',
} as const;

export const DefaultBloomColor = {
  box: 'cyan',
  circle: 'yellow',
  polyline: 'cyan',
}
