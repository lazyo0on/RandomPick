import { canvasHeight, canvasWidth, DefaultBloomColor, DefaultEntityColor, initialZoom } from './data/constants';
import { Camera } from './camera';
import { StageDef } from './data/maps';
import { Marble } from './marble';
import { ParticleManager } from './particleManager';
import { GameObject } from './gameObject';
import { UIObject } from './UIObject';
import { VectorLike } from './types/VectorLike';
import { MapEntityState } from './types/MapEntity.type';

export type RenderParameters = {
  camera: Camera;
  stage: StageDef;
  entities: MapEntityState[];
  marbles: Marble[];
  winners: Marble[];
  particleManager: ParticleManager;
  effects: GameObject[];
  winnerRank: number;
  winner: Marble | null;
  size: VectorLike;
};

export type MarbleSkin = HTMLImageElement | ImageBitmap;

export class RouletteRenderer {
  private _canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;

  /** CSS pixels -> logical pixels, used to map mouse coordinates. */
  public sizeFactor = 1;

  /**
   * The drawing code works in "logical pixels". The canvas backing store is
   * `renderScale` times larger, and every frame starts with a matching
   * transform, so the picture is drawn at a higher resolution without
   * anything changing size or position on screen.
   */
  private _logicalWidth = canvasWidth;
  private _logicalHeight = canvasHeight;
  private _renderScale = 1;

  private _images: { [key: string]: HTMLImageElement } = {};

  /** User-uploaded skins, keyed by marble name. Always win over built-in ones. */
  private _customSkins: { [key: string]: ImageBitmap } = {};
  private _customSkinBlobs: { [key: string]: Blob } = {};

  constructor() {
  }

  async setCustomSkin(name: string, blob: Blob): Promise<void> {
    const bitmap = await createImageBitmap(blob);
    this._customSkins[name]?.close();
    this._customSkins[name] = bitmap;
    this._customSkinBlobs[name] = blob;
  }

  removeCustomSkin(name: string): void {
    this._customSkins[name]?.close();
    delete this._customSkins[name];
    delete this._customSkinBlobs[name];
  }

  getCustomSkinBlob(name: string): Blob | null {
    return this._customSkinBlobs[name] ?? null;
  }

  getSkin(name: string): MarbleSkin | undefined {
    return this._customSkins[name] ?? this._images[name] ?? undefined;
  }

  get width() {
    return this._logicalWidth;
  }

  get height() {
    return this._logicalHeight;
  }

  get canvas() {
    return this._canvas;
  }

  async init() {
    await this._load();

    this._canvas = document.createElement('canvas');
    this._canvas.width = canvasWidth;
    this._canvas.height = canvasHeight;
    this.ctx = this._canvas.getContext('2d', {
      alpha: false,
    }) as CanvasRenderingContext2D;

    document.body.appendChild(this._canvas);

    const resizing = (entries?: ResizeObserverEntry[]) => {
      const realSize = entries
        ? entries[0].contentRect
        : this._canvas.getBoundingClientRect();
      if (!realSize.width || !realSize.height) return;

      // Logical size decides how much of the world fits on screen, so it is
      // kept exactly as before; only the pixel density below it changes.
      const width = Math.max(realSize.width / 2, 640);
      const height = (width / realSize.width) * realSize.height;

      this._logicalWidth = width;
      this._logicalHeight = height;
      this.sizeFactor = width / realSize.width;

      // Logical is half the CSS size, so a scale of 2 already means one
      // backing pixel per CSS pixel; on a HiDPI screen we go further.
      const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      let scale = 2 * density;

      // Keep very large windows from producing an unreasonable buffer.
      const maxPixels = 3840 * 2160;
      if (width * height * scale * scale > maxPixels) {
        scale = Math.sqrt(maxPixels / (width * height));
      }

      this._renderScale = Math.max(1, scale);
      this._canvas.width = Math.round(width * this._renderScale);
      this._canvas.height = Math.round(height * this._renderScale);
    };

    const resizeObserver = new ResizeObserver(resizing);

    resizeObserver.observe(this._canvas);
    resizing();
  }

  private async _loadImage(url: string): Promise<HTMLImageElement | null> {
    return new Promise((rs) => {
      const img = new Image();
      img.addEventListener('load', () => rs(img));
      img.addEventListener('error', () => {
        console.warn(`Failed to load skin image: ${url}`);
        rs(null);
      });
      img.src = url;
    });
  }

  private async _load(): Promise<void> {
    const loadPromises = [
      {
        name: '챔루',
        imgUrl: new URL('../assets/images/chamru.png', import.meta.url).href,
      },
      {
        name: '쿠빈',
        imgUrl: new URL('../assets/images/kubin.png', import.meta.url).href,
      },
    ].map(({ name, imgUrl }) => {
      return (async () => {
        const img = await this._loadImage(imgUrl);
        if (img) this._images[name] = img;
      })();
    });

    await Promise.all(loadPromises);
  }

  render(renderParameters: RenderParameters, uiObjects: UIObject[]) {
    // Everything below draws in logical pixels; this maps them onto the
    // higher-resolution backing store.
    this.ctx.setTransform(
      this._renderScale,
      0,
      0,
      this._renderScale,
      0,
      0,
    );

    this.ctx.fillStyle = 'black';
    this.ctx.fillRect(0, 0, this._logicalWidth, this._logicalHeight);

    this.ctx.save();
    this.ctx.scale(initialZoom, initialZoom);
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.font = '0.4pt sans-serif';
    this.ctx.lineWidth = 3 / (renderParameters.camera.zoom + initialZoom);
    renderParameters.camera.renderScene(
      this.ctx,
      { x: this._logicalWidth, y: this._logicalHeight },
      () => {
        this.renderEntities(renderParameters.entities);
        this.renderEffects(renderParameters);
        this.renderMarbles(renderParameters);
      },
    );
    this.ctx.restore();

    uiObjects.forEach((obj) =>
      obj.render(
        this.ctx,
        renderParameters,
        this._logicalWidth,
        this._logicalHeight,
      ),
    );
    renderParameters.particleManager.render(this.ctx);
    this.renderWinner(renderParameters);
  }

  private renderEntities(entities: MapEntityState[]) {
    this.ctx.save();
    entities.forEach((entity) => {
      this.ctx.save();
      this.ctx.translate(entity.x, entity.y);
      this.ctx.rotate(entity.angle);
      this.ctx.fillStyle = entity.shape.color ?? DefaultEntityColor[entity.shape.type];
      this.ctx.strokeStyle = entity.shape.color ?? DefaultEntityColor[entity.shape.type];
      this.ctx.shadowBlur = 15;
      this.ctx.shadowColor = entity.shape.bloomColor ?? entity.shape.color ?? DefaultBloomColor[entity.shape.type];
      const shape = entity.shape;
      switch (shape.type) {
        case 'polyline':
          if (shape.points.length > 0) {
            this.ctx.beginPath();
            this.ctx.moveTo(shape.points[0][0], shape.points[0][1]);
            for (let i = 1; i < shape.points.length; i++) {
              this.ctx.lineTo(shape.points[i][0], shape.points[i][1]);
            }
            this.ctx.stroke();
          }
          break;
        case 'box':
          const w = shape.width * 2;
          const h = shape.height * 2;
          this.ctx.rotate(shape.rotation);
          this.ctx.fillRect(-w / 2, -h / 2, w, h);
          this.ctx.strokeRect(-w / 2, -h / 2, w, h);
          break;
        case 'circle':
          this.ctx.beginPath();
          this.ctx.arc(0, 0, shape.radius, 0, Math.PI * 2, false);
          this.ctx.stroke();
          break;
      }

      this.ctx.restore();
    });
    this.ctx.restore();
  }

  private renderEffects({ effects, camera }: RenderParameters) {
    effects.forEach((effect) =>
      effect.render(this.ctx, camera.zoom * initialZoom),
    );
  }

  private renderMarbles({
                          marbles,
                          camera,
                          winnerRank,
                          winners,
                        }: RenderParameters) {
    const winnerIndex = winnerRank - winners.length;

    marbles.forEach((marble, i) => {
      marble.render(
        this.ctx,
        camera.zoom * initialZoom,
        i === winnerIndex,
        false,
        this.getSkin(marble.name),
      );
    });
  }

  private renderWinner({ winner }: RenderParameters) {
    if (!winner) return;
    const w = this._logicalWidth;
    const h = this._logicalHeight;

    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.fillRect(w / 2, h - 168, w / 2, 168);
    this.ctx.fillStyle = 'white';
    this.ctx.font = 'bold 48px sans-serif';
    this.ctx.textAlign = 'right';
    this.ctx.fillText('Winner', w - 10, h - 120);
    this.ctx.font = 'bold 72px sans-serif';
    this.ctx.fillStyle = winner.color;
    this.ctx.fillText(winner.name, w - 10, h - 55);
    this.ctx.restore();
  }
}
