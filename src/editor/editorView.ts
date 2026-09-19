import { MapEntity } from '../types/MapEntity.type';
import { VectorLike } from '../types/VectorLike';

/** Marbles spawn here (see marble.ts) - the map must funnel this range. */
export const SPAWN_X_MIN = 10.25;
export const SPAWN_X_MAX = 15.65;

/** The minimap draws a box this wide (see minimap.ts), so maps must fit it. */
export const MINIMAP_WIDTH = 26;

/** Marble radius in world units (physics-box2d.ts createMarble). */
export const MARBLE_RADIUS = 0.25;

export class EditorView {
  /** World coordinate shown at the canvas top-left. */
  offset: VectorLike = { x: -2, y: -12 };
  /** Pixels per world unit. */
  scale = 8;

  toScreen(p: VectorLike): VectorLike {
    return {
      x: (p.x - this.offset.x) * this.scale,
      y: (p.y - this.offset.y) * this.scale,
    };
  }

  toWorld(p: VectorLike): VectorLike {
    return {
      x: p.x / this.scale + this.offset.x,
      y: p.y / this.scale + this.offset.y,
    };
  }

  /** Zooms around a fixed screen point, so the cursor stays put. */
  zoomAt(screen: VectorLike, factor: number) {
    const before = this.toWorld(screen);
    this.scale = Math.min(60, Math.max(2, this.scale * factor));
    const after = this.toWorld(screen);
    this.offset.x += before.x - after.x;
    this.offset.y += before.y - after.y;
  }

  panBy(dxPx: number, dyPx: number) {
    this.offset.x -= dxPx / this.scale;
    this.offset.y -= dyPx / this.scale;
  }

  /** Frames the whole course inside the canvas. */
  fit(canvas: HTMLCanvasElement, goalY: number) {
    const marginX = 2;
    const top = -14;
    const bottom = goalY + 6;
    const worldW = MINIMAP_WIDTH + marginX * 2;
    const worldH = bottom - top;
    this.scale = Math.min(
      canvas.width / worldW,
      canvas.height / worldH,
    );
    this.offset.x = -marginX - (canvas.width / this.scale - worldW) / 2;
    this.offset.y = top - (canvas.height / this.scale - worldH) / 2;
  }
}

/** Absolute world points of a polyline entity. */
export function polylinePoints(entity: MapEntity): VectorLike[] {
  if (entity.shape.type !== 'polyline') return [];
  return entity.shape.points.map(([px, py]) => ({
    x: entity.position.x + px,
    y: entity.position.y + py,
  }));
}

function distanceToSegment(p: VectorLike, a: VectorLike, b: VectorLike) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const dx = p.x - (a.x + t * vx);
  const dy = p.y - (a.y + t * vy);
  return Math.hypot(dx, dy);
}

/** Returns true when a world-space point is close enough to grab the entity. */
export function hitTest(
  entity: MapEntity,
  world: VectorLike,
  tolerance: number,
): boolean {
  const shape = entity.shape;

  if (shape.type === 'circle') {
    const d = Math.hypot(
      world.x - entity.position.x,
      world.y - entity.position.y,
    );
    return d <= shape.radius + tolerance;
  }

  if (shape.type === 'box') {
    // Un-rotate the point, then test against the axis-aligned half extents.
    const dx = world.x - entity.position.x;
    const dy = world.y - entity.position.y;
    const c = Math.cos(-shape.rotation);
    const s = Math.sin(-shape.rotation);
    const lx = dx * c - dy * s;
    const ly = dx * s + dy * c;
    return (
      Math.abs(lx) <= shape.width + tolerance &&
      Math.abs(ly) <= shape.height + tolerance
    );
  }

  const pts = polylinePoints(entity);
  for (let i = 0; i < pts.length - 1; i++) {
    if (distanceToSegment(world, pts[i], pts[i + 1]) <= tolerance) return true;
  }
  return false;
}

export function entityBounds(entity: MapEntity) {
  const shape = entity.shape;
  if (shape.type === 'circle') {
    return {
      minX: entity.position.x - shape.radius,
      maxX: entity.position.x + shape.radius,
      minY: entity.position.y - shape.radius,
      maxY: entity.position.y + shape.radius,
    };
  }
  if (shape.type === 'box') {
    const r = Math.hypot(shape.width, shape.height);
    return {
      minX: entity.position.x - r,
      maxX: entity.position.x + r,
      minY: entity.position.y - r,
      maxY: entity.position.y + r,
    };
  }
  const pts = polylinePoints(entity);
  if (pts.length === 0) {
    return {
      minX: entity.position.x,
      maxX: entity.position.x,
      minY: entity.position.y,
      maxY: entity.position.y,
    };
  }
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}
