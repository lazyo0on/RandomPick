import { GameObject } from './gameObject';
import { VectorLike } from './types/VectorLike';

const lifetime = 450;

/**
 * Marks both ends of a teleport: a collapsing ring at the point the marble
 * left, and an expanding one where it arrived.
 */
export class TeleportEffect implements GameObject {
  position: VectorLike;
  isDestroy: boolean = false;

  private _elapsed: number = 0;
  private _incoming: boolean;

  constructor(x: number, y: number, incoming: boolean) {
    this.position = { x, y };
    this._incoming = incoming;
  }

  update(deltaTime: number) {
    this._elapsed += deltaTime;
    if (this._elapsed > lifetime) this.isDestroy = true;
  }

  render(ctx: CanvasRenderingContext2D, zoom: number) {
    const rate = Math.min(1, this._elapsed / lifetime);
    // Departure collapses inward, arrival blooms outward.
    const radius = this._incoming ? 0.3 + rate * 1.4 : 1.7 * (1 - rate);

    ctx.save();
    ctx.globalAlpha = 1 - rate;
    ctx.strokeStyle = this._incoming ? '#7de2ff' : '#c58cff';
    ctx.lineWidth = 2 / zoom;

    ctx.beginPath();
    ctx.arc(this.position.x, this.position.y, Math.max(0, radius), 0, Math.PI * 2);
    ctx.stroke();

    // A second, offset ring reads as a "warp" rather than a plain pulse.
    ctx.globalAlpha = (1 - rate) * 0.5;
    ctx.beginPath();
    ctx.arc(
      this.position.x,
      this.position.y,
      Math.max(0, radius * 0.55),
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    ctx.restore();
  }
}
