import { MapEntity } from '../types/MapEntity.type';
import { StageDef } from '../data/maps';
import { entityBounds, MINIMAP_WIDTH, SPAWN_X_MAX, SPAWN_X_MIN } from './editorView';

/** Drops undefined optional fields so the exported code stays tidy. */
function cleanEntity(entity: MapEntity): MapEntity {
  const shape = { ...entity.shape };
  Object.keys(shape).forEach((key) => {
    if ((shape as Record<string, unknown>)[key] === undefined) {
      delete (shape as Record<string, unknown>)[key];
    }
  });

  const props: Record<string, number> = {
    density: entity.props.density,
    restitution: entity.props.restitution,
    angularVelocity: entity.props.angularVelocity,
  };
  if (entity.props.life !== undefined && entity.props.life > 0) {
    props.life = entity.props.life;
  }
  if (entity.props.stickDuration && entity.props.stickDuration > 0) {
    props.stickDuration = entity.props.stickDuration;
  }

  return {
    type: entity.type,
    position: {
      x: Number(entity.position.x.toFixed(4)),
      y: Number(entity.position.y.toFixed(4)),
    },
    props: props as MapEntity['props'],
    shape: shape as MapEntity['shape'],
  };
}

/** Produces the block to paste into the `stages` array in maps.ts. */
export function exportStage(stage: StageDef): string {
  const lines = (stage.entities ?? []).map(
    (e) => '      ' + JSON.stringify(cleanEntity(e)),
  );
  return (
    `  {\n` +
    `    title: ${JSON.stringify(stage.title)},\n` +
    `    goalY: ${stage.goalY},\n` +
    `    zoomY: ${stage.zoomY},\n` +
    `    entities: [\n${lines.join(',\n')}\n    ],\n` +
    `  },\n`
  );
}

export type Problem = { level: 'error' | 'warn'; message: string };

/** Marbles are created between roughly y -10 and y 2 (see marble.ts). */
const SPAWN_BAND_TOP = -10;
const SPAWN_BAND_BOTTOM = 3;

/**
 * X coordinates at which an entity actually exists at spawn height.
 * For a polyline this looks at the individual segments rather than the
 * bounding box, so a wall that narrows further down is judged correctly.
 */
function xsInSpawnBand(entity: MapEntity): number[] {
  const overlapsBand = (minY: number, maxY: number) =>
    maxY >= SPAWN_BAND_TOP && minY <= SPAWN_BAND_BOTTOM;

  if (entity.shape.type === 'polyline') {
    const xs: number[] = [];
    const pts = entity.shape.points.map(([px, py]) => ({
      x: entity.position.x + px,
      y: entity.position.y + py,
    }));

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      if (!overlapsBand(minY, maxY)) continue;

      // Clip the segment to the band and take both clipped endpoints.
      const lo = Math.max(SPAWN_BAND_TOP, minY);
      const hi = Math.min(SPAWN_BAND_BOTTOM, maxY);
      if (Math.abs(b.y - a.y) < 1e-9) {
        xs.push(a.x, b.x);
      } else {
        for (const y of [lo, hi]) {
          const t = (y - a.y) / (b.y - a.y);
          if (t >= 0 && t <= 1) xs.push(a.x + t * (b.x - a.x));
        }
      }
    }
    return xs;
  }

  const b = entityBounds(entity);
  if (!overlapsBand(b.minY, b.maxY)) return [];
  return [b.minX, b.maxX];
}

/**
 * Checks the constraints that are easy to break and hard to notice:
 * the hard-coded spawn range and the fixed minimap width.
 */
export function validateStage(stage: StageDef): Problem[] {
  const problems: Problem[] = [];
  const entities = stage.entities ?? [];

  if (entities.length === 0) {
    problems.push({ level: 'error', message: '도형이 하나도 없습니다' });
    return problems;
  }

  if (stage.zoomY >= stage.goalY) {
    problems.push({
      level: 'warn',
      message: '줌 시작 Y는 결승선 Y보다 작아야 자연스럽습니다',
    });
  }

  let outOfMinimap = 0;
  let lowestTop = Infinity;
  const spawnCovered = { left: false, right: false };

  entities.forEach((entity) => {
    const b = entityBounds(entity);
    if (b.minX < 0 || b.maxX > MINIMAP_WIDTH) outOfMinimap++;
    lowestTop = Math.min(lowestTop, b.minY);

    // Only the part of the shape that actually sits at spawn height counts.
    // Using the whole bounding box would misjudge a wall that funnels inward
    // further down.
    xsInSpawnBand(entity).forEach((x) => {
      if (x <= SPAWN_X_MIN) spawnCovered.left = true;
      if (x >= SPAWN_X_MAX) spawnCovered.right = true;
    });
  });

  if (outOfMinimap > 0) {
    problems.push({
      level: 'error',
      message: `미니맵 범위(x 0~${MINIMAP_WIDTH})를 벗어난 도형 ${outOfMinimap}개`,
    });
  }

  if (!spawnCovered.left || !spawnCovered.right) {
    problems.push({
      level: 'error',
      message: `구슬 스폰 구역(x ${SPAWN_X_MIN}~${SPAWN_X_MAX})의 양옆 벽이 없습니다`,
    });
  }

  if (lowestTop > -8) {
    problems.push({
      level: 'warn',
      message: '벽이 위쪽(y -10 부근)까지 올라와야 구슬이 많을 때 새지 않습니다',
    });
  }

  const deepest = Math.max(...entities.map((e) => entityBounds(e).maxY));
  if (deepest < stage.goalY) {
    problems.push({
      level: 'warn',
      message: '결승선보다 아래까지 이어지는 벽이 없습니다',
    });
  }

  return problems;
}
