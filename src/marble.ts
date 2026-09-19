import { Skills, STUCK_DELAY } from './data/constants';
import { rad } from './utils/utils';
import options from './options';
import { VectorLike } from './types/VectorLike';
import { Vector } from './utils/Vector';
import { IPhysics } from './IPhysics';
import { MarbleSkin } from './rouletteRenderer';

export class Marble {
  type = 'marble' as const;
  name: string = '';
  size: number = 0.5;
  color: string = 'red';
  hue: number = 0;
  impact: number = 0;
  weight: number = 1;
  skill: Skills = Skills.None;
  isActive: boolean = false;

  private _skillRate = 0.0005;
  private _coolTime = 5000;
  private _maxCoolTime = 5000;
  private _stuckTime = 0;
  private lastPosition: VectorLike = { x: 0, y: 0 };

  private physics: IPhysics;

  id: number;

  get position() {
    return this.physics.getMarblePosition(this.id) || { x: 0, y: 0, angle: 0 };
  }

  get x() {
    return this.position.x;
  }

  set x(v: number) {
    this.position.x = v;
  }

  get y() {
    return this.position.y;
  }

  set y(v: number) {
    this.position.y = v;
  }

  get angle() {
    return this.position.angle;
  }

  constructor(
    physics: IPhysics,
    order: number,
    max: number,
    name?: string,
    weight: number = 1,
  ) {
    this.name = name || `M${order}`;
    this.weight = weight;
    this.physics = physics;

    this._maxCoolTime = 1000 + (1 - this.weight) * 4000;
    this._coolTime = this._maxCoolTime * Math.random();
    this._skillRate = 0.2 * this.weight;

    const maxLine = Math.ceil(max / 10);
    const line = Math.floor(order / 10);
    const lineDelta = -Math.max(0, Math.ceil(maxLine - 5));
    this.hue = (360 / max) * order;
    this.color = `hsl(${this.hue} 100% 70%)`;
    this.id = order;

    physics.createMarble(
      order,
      10.25 + (order % 10) * 0.6,
      maxLine - line + lineDelta,
    );
  }

  update(deltaTime: number) {
    if (
      this.isActive &&
      Vector.lenSq(Vector.sub(this.lastPosition, this.position)) < 0.00001
    ) {
      this._stuckTime += deltaTime;

      if (this._stuckTime > STUCK_DELAY) {
        this.physics.shakeMarble(this.id);
        this._stuckTime = 0;
      }
    } else {
      this._stuckTime = 0;
    }
    this.lastPosition = { x: this.position.x, y: this.position.y };

    this.skill = Skills.None;
    if (this.impact) {
      this.impact = Math.max(0, this.impact - deltaTime);
    }
    if (!this.isActive) return;
    if (options.useSkills) {
      this._updateSkillInformation(deltaTime);
    }
  }

  /** Picks one of the usable skills with equal probability. */
  private static _randomSkill(): Skills {
    const usable = [Skills.Impact, Skills.Teleport];
    return usable[Math.floor(Math.random() * usable.length)];
  }

  private _updateSkillInformation(deltaTime: number) {
    if (this._coolTime > 0) {
      this._coolTime -= deltaTime;
    }

    if (this._coolTime <= 0) {
      this.skill =
        Math.random() < this._skillRate ? Marble._randomSkill() : Skills.None;
      this._coolTime = this._maxCoolTime;
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    zoom: number,
    outline: boolean,
    isMinimap: boolean = false,
    skin?: MarbleSkin,
  ) {
    ctx.save();
    if (isMinimap) {
      this._renderMinimap(ctx);
    } else {
      this._renderNormal(ctx, zoom, outline, skin);
    }
    ctx.restore();
  }

  private _renderMinimap(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = this.color;
    this._drawMarbleBody(ctx, true);
  }

  private _drawMarbleBody(ctx: CanvasRenderingContext2D, isMinimap: boolean) {
    ctx.beginPath();
    ctx.arc(
      this.x,
      this.y,
      isMinimap ? this.size : this.size / 2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  /**
   * Draws the skin image clipped to the marble's circle.
   * The marble colour is painted underneath first, so transparent PNGs
   * still read as a marble and keep their glow.
   */
  private _drawSkin(ctx: CanvasRenderingContext2D, skin: MarbleSkin) {
    const radius = this.size / 2;

    ctx.save();
    ctx.translate(this.x, this.y);

    // Backdrop + glow (shadow settings are still active here).
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    // Everything after this is confined to the circle.
    ctx.clip();
    ctx.shadowBlur = 0;
    ctx.rotate(this.angle);

    const sw = skin instanceof ImageBitmap ? skin.width : skin.naturalWidth;
    const sh = skin instanceof ImageBitmap ? skin.height : skin.naturalHeight;

    if (sw > 0 && sh > 0) {
      // Center-crop to a square so non-square images are not squashed.
      const side = Math.min(sw, sh);
      const sx = (sw - side) / 2;
      const sy = (sh - side) / 2;
      ctx.drawImage(
        skin,
        sx,
        sy,
        side,
        side,
        -radius,
        -radius,
        radius * 2,
        radius * 2,
      );
    }

    ctx.restore();
  }

  private _renderNormal(
    ctx: CanvasRenderingContext2D,
    zoom: number,
    outline: boolean,
    skin?: MarbleSkin,
  ) {
    ctx.fillStyle = `hsl(${this.hue} 100% ${70 + 25 * Math.min(1, this.impact / 500)}%`;
    if (this._stuckTime > 0) {
      ctx.fillStyle = `hsl(${this.hue} 100% ${70 + 25 * Math.min(1, this._stuckTime / STUCK_DELAY)}%`;
    }

    ctx.shadowColor = this.color;
    ctx.shadowBlur = zoom / 2;
    if (skin) {
      this._drawSkin(ctx, skin);
    } else {
      this._drawMarbleBody(ctx, false);
    }

    ctx.shadowColor = '';
    ctx.shadowBlur = 0;
    this._drawName(ctx, zoom);

    if (outline) {
      this._drawOutline(ctx, 2 / zoom);
    }

    if (options.useSkills) {
      this._renderCooltime(ctx, zoom);
    }
    // this._renderStuck(ctx, zoom); // for debug
  }

  private _drawName(ctx: CanvasRenderingContext2D, zoom: number) {
    ctx.save();
    ctx.translate(this.x, this.y + 0.25);
    ctx.scale(1 / zoom, 1 / zoom);
    ctx.font = `12pt sans-serif`;
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    ctx.fillStyle = this.color;
    ctx.shadowBlur = 0;
    ctx.strokeText(this.name, 0, 0);
    ctx.fillText(this.name, 0, 0);
    ctx.restore();
  }

  private _drawOutline(ctx: CanvasRenderingContext2D, lineWidth: number) {
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = lineWidth;
    ctx.arc(this.x, this.y, this.size / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private _renderCooltime(ctx: CanvasRenderingContext2D, zoom: number) {
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.arc(
      this.x,
      this.y,
      this.size / 2 + 2 / zoom,
      rad(270),
      rad(270 + (360 * this._coolTime) / this._maxCoolTime),
    );
    ctx.stroke();
  }

  private _renderStuck(ctx: CanvasRenderingContext2D, zoom: number) {
    ctx.strokeStyle = 'green';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.arc(
      this.x,
      this.y,
      this.size / 2 + 3 / zoom,
      rad(270),
      rad(270 + 360 * (1 - this._stuckTime / STUCK_DELAY)),
    );
    ctx.stroke();
  }
}
