import { Marble } from './marble';
import {
  initialZoom,
  NEUTRAL_WEIGHT,
  Skills,
  zoomThreshold,
} from './data/constants';
import { ParticleManager } from './particleManager';
import { StageDef, stages } from './data/maps';
import { parseName } from './utils/utils';
import { Camera } from './camera';
import { RouletteRenderer } from './rouletteRenderer';
import { SkillEffect } from './skillEffect';
import { TeleportEffect } from './teleportEffect';
import { GameObject } from './gameObject';
import options from './options';
import { bound } from './utils/bound.decorator';
import { UIObject } from './UIObject';
import { RankRenderer } from './rankRenderer';
import { Minimap } from './minimap';
import { VideoRecorder } from './utils/videoRecorder';
import { IPhysics } from './IPhysics';
import { Box2dPhysics } from './physics-box2d';
import { MouseEventHandlerName, MouseEventName } from './types/mouseEvents.type';
import {
  deleteSkin,
  getAllSkins,
  normalizeSkinFile,
  putSkin,
} from './skinStore';
import { CustomMap, getCustomMaps } from './customMaps';

export class Roulette extends EventTarget {
  private _marbles: Marble[] = [];

  private _lastTime: number = 0;
  private _elapsed: number = 0;
  private _noMoveDuration: number = 0;
  private _shakeAvailable: boolean = false;

  private _updateInterval = 10;
  private _timeScale = 1;
  private _speed = 1;

  private _winners: Marble[] = [];
  private _particleManager = new ParticleManager();
  private _stage: StageDef | null = null;

  private _camera: Camera = new Camera();
  private _renderer: RouletteRenderer = new RouletteRenderer();

  private _effects: GameObject[] = [];

  private _winnerRank = 0;
  private _totalMarbleCount = 0;
  private _goalDist: number = Infinity;
  private _isRunning: boolean = false;
  private _winner: Marble | null = null;

  private _uiObjects: UIObject[] = [];

  /** Unique marble names currently entered, in input order. */
  private _marbleNames: string[] = [];

  /** Maps the user built in the editor, loaded from this browser. */
  private _customMaps: CustomMap[] = [];

  private _autoRecording: boolean = false;
  private _recorder!: VideoRecorder;

  private physics!: IPhysics;

  private _isReady: boolean = false;
  get isReady() {
    return this._isReady;
  }

  constructor() {
    super();
    this._renderer.init().then(() => {
      this._init().then(() => {
        this._isReady = true;
        this._update();
      });
    });
  }

  public getZoom() {
    return initialZoom * this._camera.zoom;
  }

  private addUiObject(obj: UIObject) {
    this._uiObjects.push(obj);
    if (obj.onWheel) {
      this._renderer.canvas.addEventListener('wheel', obj.onWheel);
    }
    if (obj.onMessage) {
      obj.onMessage((msg) => {
        console.log('onMessage', msg);
        this.dispatchEvent(new CustomEvent('message', { detail: msg }));
      });
    }
  }

  @bound
  private _update() {
    if (!this._lastTime) this._lastTime = Date.now();
    const currentTime = Date.now();

    this._elapsed += (currentTime - this._lastTime) * this._speed;
    if (this._elapsed > 100) {
      this._elapsed %= 100;
    }
    this._lastTime = currentTime;

    const interval = (this._updateInterval / 1000) * this._timeScale;

    while (this._elapsed >= this._updateInterval) {
      this.physics.step(interval);
      this._updateMarbles(this._updateInterval);
      this._particleManager.update(this._updateInterval);
      this._updateEffects(this._updateInterval);
      this._elapsed -= this._updateInterval;
      this._uiObjects.forEach((obj) => obj.update(this._updateInterval));
    }

    if (this._marbles.length > 1) {
      this._marbles.sort((a, b) => b.y - a.y);
    }

    if (this._stage) {
      this._camera.update({
        marbles: this._marbles,
        stage: this._stage,
        needToZoom: this._goalDist < zoomThreshold,
        targetIndex:
          this._winners.length > 0
            ? this._winnerRank - this._winners.length
            : 0,
      });

      if (
        this._isRunning &&
        this._marbles.length > 0 &&
        this._noMoveDuration > 3000
      ) {
        this._changeShakeAvailable(true);
      } else {
        this._changeShakeAvailable(false);
      }
    }

    this._render();
    window.requestAnimationFrame(this._update);
  }

  private _updateMarbles(deltaTime: number) {
    if (!this._stage) return;

    for (let i = 0; i < this._marbles.length; i++) {
      const marble = this._marbles[i];
      marble.update(deltaTime);
      if (marble.skill === Skills.Impact) {
        this._effects.push(new SkillEffect(marble.x, marble.y));
        this.physics.impact(marble.id);
      } else if (marble.skill === Skills.Teleport) {
        const fromX = marble.x;
        const fromY = marble.y;
        if (this.physics.teleport(marble.id)) {
          this._effects.push(new TeleportEffect(fromX, fromY, false));
          this._effects.push(new TeleportEffect(marble.x, marble.y, true));
        }
      }
      if (marble.y > this._stage.goalY) {
        this._winners.push(marble);
        if (this._isRunning && this._winners.length === this._winnerRank + 1) {
          this.dispatchEvent(
            new CustomEvent('goal', { detail: { winner: marble.name } }),
          );
          this._winner = marble;
          this._isRunning = false;
          this._particleManager.shot(
            this._renderer.width,
            this._renderer.height,
          );
          setTimeout(() => {
            this._recorder.stop();
          }, 1000);
        } else if (
          this._isRunning &&
          this._winnerRank === this._winners.length &&
          this._winnerRank === this._totalMarbleCount - 1
        ) {
          this.dispatchEvent(
            new CustomEvent('goal', {
              detail: { winner: this._marbles[i + 1].name },
            }),
          );
          this._winner = this._marbles[i + 1];
          this._isRunning = false;
          this._particleManager.shot(
            this._renderer.width,
            this._renderer.height,
          );
          setTimeout(() => {
            this._recorder.stop();
          }, 1000);
        }
        setTimeout(() => {
          this.physics.removeMarble(marble.id);
        }, 500);
      }
    }

    const targetIndex = this._winnerRank - this._winners.length;
    const topY = this._marbles[targetIndex] ? this._marbles[targetIndex].y : 0;
    this._goalDist = Math.abs(this._stage.zoomY - topY);
    this._timeScale = this._calcTimeScale();

    this._marbles = this._marbles.filter(
      (marble) => marble.y <= this._stage!.goalY,
    );
  }

  private _calcTimeScale(): number {
    if (!this._stage) return 1;
    const targetIndex = this._winnerRank - this._winners.length;
    if (
      this._winners.length < this._winnerRank + 1 &&
      this._goalDist < zoomThreshold
    ) {
      if (
        this._marbles[targetIndex].y >
        this._stage.zoomY - zoomThreshold * 1.2 &&
        (this._marbles[targetIndex - 1] || this._marbles[targetIndex + 1])
      ) {
        return Math.max(0.2, this._goalDist / zoomThreshold);
      }
    }
    return 1;
  }

  private _updateEffects(deltaTime: number) {
    this._effects.forEach((effect) => effect.update(deltaTime));
    this._effects = this._effects.filter((effect) => !effect.isDestroy);
  }

  private _render() {
    if (!this._stage) return;
    const renderParams = {
      camera: this._camera,
      stage: this._stage,
      entities: this.physics.getEntities(),
      marbles: this._marbles,
      winners: this._winners,
      particleManager: this._particleManager,
      effects: this._effects,
      winnerRank: this._winnerRank,
      winner: this._winner,
      size: { x: this._renderer.width, y: this._renderer.height },
    };
    this._renderer.render(renderParams, this._uiObjects);
  }

  private async _init() {
    this._recorder = new VideoRecorder(this._renderer.canvas);

    this.physics = new Box2dPhysics();
    await this.physics.init();

    this.addUiObject(new RankRenderer());
    this.attachEvent();
    const minimap = new Minimap();
    minimap.onViewportChange((pos) => {
      if (pos) {
        this._camera.setPosition(pos, false);
        this._camera.lock(true);
      } else {
        this._camera.lock(false);
      }
    });
    this.addUiObject(minimap);

    try {
      this._customMaps = await getCustomMaps();
    } catch (e) {
      console.warn('Could not load saved maps', e);
    }

    this._stage = stages[0];
    this._loadMap();

    await this._restoreSkins();
  }

  private async _restoreSkins() {
    try {
      const stored = await getAllSkins();
      await Promise.all(
        Object.entries(stored).map(([name, blob]) =>
          this._renderer.setCustomSkin(name, blob).catch(() => {
            console.warn(`Could not decode stored skin for "${name}"`);
          }),
        ),
      );
    } catch (e) {
      console.warn('Could not restore saved skins', e);
    }
  }

  /** Unique marble names currently entered. */
  public getMarbleNames(): string[] {
    return this._marbleNames.slice();
  }

  /**
   * Stores a user-supplied image as the skin for `name`.
   * The file never leaves the browser.
   */
  public async setSkin(name: string, file: File): Promise<void> {
    const blob = await normalizeSkinFile(file);
    await this._renderer.setCustomSkin(name, blob);
    await putSkin(name, blob);
  }

  public async removeSkin(name: string): Promise<void> {
    this._renderer.removeCustomSkin(name);
    await deleteSkin(name);
  }

  /** Returns the stored image for `name`, for building a UI preview. */
  public getSkinBlob(name: string): Blob | null {
    return this._renderer.getCustomSkinBlob(name);
  }

  @bound
  private mouseHandler(eventName: MouseEventName, e: MouseEvent) {
    const handlerName = `on${eventName}` as MouseEventHandlerName;

    const sizeFactor = this._renderer.sizeFactor;
    const pos = { x: e.offsetX * sizeFactor, y: e.offsetY * sizeFactor };
    this._uiObjects.forEach((obj) => {
      if (!obj[handlerName]) return;
      const bounds = obj.getBoundingBox();
      if (!bounds) {
        obj[handlerName]({ ...pos, button: e.button });
      } else if (
        bounds &&
        pos.x >= bounds.x &&
        pos.y >= bounds.y &&
        pos.x <= bounds.x + bounds.w &&
        pos.y <= bounds.y + bounds.h
      ) {
        obj[handlerName]({ x: pos.x - bounds.x, y: pos.y - bounds.y, button: e.button });
      } else {
        obj[handlerName](undefined);
      }
    });
  }

  private attachEvent() {
    ['MouseMove', 'MouseUp', 'MouseDown', 'DblClick'].forEach(
      (ev) => {
        // @ts-ignore
        this._renderer.canvas.addEventListener(ev.toLowerCase(), this.mouseHandler.bind(this, ev));
      },
    );
  }

  private _loadMap() {
    if (!this._stage) {
      throw new Error('No map has been selected');
    }

    this.physics.createStage(this._stage);
  }

  public clearMarbles() {
    this.physics.clearMarbles();
    this._winner = null;
    this._winners = [];
    this._marbles = [];
  }

  public start() {
    this._isRunning = true;
    this._winnerRank = options.winningRank;
    if (this._winnerRank >= this._marbles.length) {
      this._winnerRank = this._marbles.length - 1;
    }
    if (this._autoRecording) {
      this._recorder.start().then(() => {
        this.physics.start();
        this._marbles.forEach((marble) => (marble.isActive = true));
      });
    } else {
      this.physics.start();
      this._marbles.forEach((marble) => (marble.isActive = true));
    }
  }

  public setSpeed(value: number) {
    if (value <= 0) {
      throw new Error('Speed multiplier must larger than 0');
    }
    this._speed = value;
  }

  public getSpeed() {
    return this._speed;
  }

  public setWinningRank(rank: number) {
    this._winnerRank = rank;
  }

  public setAutoRecording(value: boolean) {
    this._autoRecording = value;
  }

  public setMarbles(names: string[]) {
    this.reset();
    const arr = names.slice();

    let maxWeight = -Infinity;
    let minWeight = Infinity;

    const members = arr
      .map((nameString) => {
        const result = parseName(nameString);
        if (!result) return null;
        const { name, weight, count } = result;
        if (weight > maxWeight) maxWeight = weight;
        if (weight < minWeight) minWeight = weight;
        return { name, weight, count };
      })
      .filter((member) => !!member);

    const gap = maxWeight - minWeight;

    this._marbleNames = [...new Set(members.map((member) => member!.name))];

    let totalCount = 0;
    members.forEach((member) => {
      if (member) {
        // Weight drives how often a marble uses skills. When every name has
        // the same weight there is no spread to normalise, so give everyone a
        // neutral value; using the 0.1 floor there made skills almost never
        // fire in the common case where nobody types a `/weight`.
        member.weight = gap
          ? 0.1 + (member.weight - minWeight) / gap
          : NEUTRAL_WEIGHT;
        totalCount += member.count;
      }
    });

    const orders = Array(totalCount)
      .fill(0)
      .map((_, i) => i)
      .sort(() => Math.random() - 0.5);
    members.forEach((member) => {
      if (member) {
        for (let j = 0; j < member.count; j++) {
          const order = orders.pop() || 0;
          this._marbles.push(
            new Marble(
              this.physics,
              order,
              totalCount,
              member.name,
              member.weight,
            ),
          );
        }
      }
    });
    this._totalMarbleCount = totalCount;
  }

  private _clearMap() {
    this.physics.clear();
    this._marbles = [];
  }

  public reset() {
    this.clearMarbles();
    this._clearMap();
    this._loadMap();
    this._goalDist = Infinity;
  }

  public getCount() {
    return this._marbles.length;
  }

  private _changeShakeAvailable(v: boolean) {
    if (this._shakeAvailable !== v) {
      this._shakeAvailable = v;
      this.dispatchEvent(
        new CustomEvent('shakeAvailableChanged', { detail: v }),
      );
    }
  }

  public shake() {
    if (!this._shakeAvailable) return;
  }

  /** Built-in stages followed by the maps saved in this browser. */
  private get _allStages(): StageDef[] {
    return [...stages, ...this._customMaps];
  }

  public getMaps() {
    return this._allStages.map((stage, index) => {
      const custom = index >= stages.length;
      return {
        index,
        title: stage.title,
        custom,
        id: custom ? (stage as CustomMap).id : undefined,
      };
    });
  }

  public setMap(index: number) {
    const target = Number(index);
    const all = this._allStages;
    if (!Number.isFinite(target) || target < 0 || target > all.length - 1) {
      throw new Error('Incorrect map number');
    }
    const names = this._marbles.map((marble) => marble.name);
    this._stage = all[target];
    this.setMarbles(names);
  }

  /**
   * Re-reads the maps saved in this browser. Call after the editor saves or
   * deletes one. Returns the index the map selector should show, because a
   * deleted map cannot stay selected.
   */
  public async reloadCustomMaps(): Promise<number> {
    const previous = this._stage;
    this._customMaps = await getCustomMaps();

    const all = this._allStages;
    let index = previous ? all.indexOf(previous) : -1;

    if (index < 0 && previous) {
      // The selected map was edited or removed; match it by id if we can.
      const previousId = (previous as CustomMap).id;
      index = previousId
        ? all.findIndex((s) => (s as CustomMap).id === previousId)
        : -1;
    }

    if (index < 0) index = 0;

    const names = this._marbles.map((marble) => marble.name);
    this._stage = all[index];
    this.setMarbles(names);
    return index;
  }
}
