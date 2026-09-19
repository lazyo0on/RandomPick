import { MapEntity, EntityShape } from '../types/MapEntity.type';
import { StageDef, stages } from '../data/maps';
import { VectorLike } from '../types/VectorLike';
import {
  EditorView,
  entityBounds,
  hitTest,
  MARBLE_RADIUS,
  MINIMAP_WIDTH,
  SPAWN_X_MAX,
  SPAWN_X_MIN,
} from './editorView';
import { exportStage, Problem, validateStage } from './serialize';
import { TestRun } from './testRun';
import { editorMarkup, ensureEditorStyles } from './editorTemplate';
import {
  CustomMap,
  deleteCustomMap,
  getCustomMaps,
  saveCustomMap,
} from '../customMaps';

type Tool = 'select' | 'wall' | 'peg' | 'box' | 'spinner' | 'magnet';

const DRAFT_KEY = 'mbr_editor_draft';

/** Magnet rocks are drawn in their own colour so they read as different. */
export const MAGNET_COLOR = '#ff5bb0';

export type MapEditorOptions = {
  /** Adds a close button and reports when it is pressed. */
  onClose?: () => void;
  /** Called after any change to the saved-map list. */
  onMapsChanged?: () => void;
};

export class MapEditor {
  private root: HTMLElement;
  private options: MapEditorOptions;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  view = new EditorView();
  private run = new TestRun();

  stage: StageDef = {
    title: 'My Map',
    goalY: 92,
    zoomY: 88,
    entities: [],
  };

  /** Id of the stored map being edited, if this map has been saved. */
  private currentId: string | null = null;
  private savedMaps: CustomMap[] = [];

  private tool: Tool = 'select';
  private selected: MapEntity | null = null;

  private draft: VectorLike[] = [];
  private cursor: VectorLike = { x: 0, y: 0 };

  private dragging: MapEntity | null = null;
  private dragOffset: VectorLike = { x: 0, y: 0 };
  private panning = false;
  private spaceHeld = false;
  private lastMouse: VectorLike = { x: 0, y: 0 };

  private problems: Problem[] = [];
  private frameHandle = 0;
  private destroyed = false;

  constructor(root: HTMLElement, options: MapEditorOptions = {}) {
    this.root = root;
    this.options = options;

    ensureEditorStyles();
    root.classList.add('mapeditor');
    root.innerHTML = editorMarkup(!!options.onClose);

    this.canvas = this.el<HTMLCanvasElement>('canvas');
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;

    this.setupPresets();
    this.restoreDraft();
    this.bindTools();
    this.bindStageFields();
    this.bindCanvas();
    this.bindSideButtons();

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    this.resize();
    this.view.fit(this.canvas, this.stage.goalY);
    this.revalidate();
    void this.refreshSavedMaps();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  /** Detaches listeners and stops the render loop. */
  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.frameHandle);
    this.run.stop();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.root.classList.remove('mapeditor');
    this.root.innerHTML = '';
  }

  /** Re-measures the canvas; call after the editor becomes visible. */
  refresh() {
    this.resize();
    this.view.fit(this.canvas, this.stage.goalY);
    void this.refreshSavedMaps();
  }

  // ------------------------------------------------------------- elements

  private el<T extends HTMLElement>(role: string): T {
    return this.root.querySelector(`[data-role="${role}"]`) as T;
  }

  // ---------------------------------------------------------------- setup

  private setupPresets() {
    const sel = this.el<HTMLSelectElement>('preset');
    stages.forEach((s, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = s.title;
      sel.append(opt);
    });
  }

  private bindTools() {
    this.root.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', () =>
        this.setTool(btn.dataset.tool as Tool),
      );
    });
  }

  private setTool(tool: Tool) {
    this.tool = tool;
    this.draft = [];
    this.root.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    this.canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  }

  private syncStageFields() {
    this.el<HTMLInputElement>('title').value = this.stage.title;
    this.el<HTMLInputElement>('goalY').value = String(this.stage.goalY);
    this.el<HTMLInputElement>('zoomY').value = String(this.stage.zoomY);
  }

  private bindStageFields() {
    this.el<HTMLInputElement>('title').addEventListener('input', (e) => {
      this.stage.title = (e.target as HTMLInputElement).value;
      this.persistDraft();
    });

    (['goalY', 'zoomY'] as const).forEach((role) => {
      this.el<HTMLInputElement>(role).addEventListener('input', (e) => {
        const value = Number((e.target as HTMLInputElement).value);
        if (Number.isNaN(value)) return;
        this.stage[role] = value;
        this.revalidate();
        this.persistDraft();
      });
    });

    this.syncStageFields();
  }

  private bindSideButtons() {
    this.el('fit').addEventListener('click', () =>
      this.view.fit(this.canvas, this.stage.goalY),
    );

    this.el('run').addEventListener('click', () => void this.startRun());
    this.el('stop').addEventListener('click', () => {
      this.run.stop();
      this.el('runStatus').textContent = '정지됨';
    });

    this.el('save').addEventListener('click', () => void this.save(false));
    this.el('saveAsNew').addEventListener('click', () => void this.save(true));

    this.el('load').addEventListener('click', () => {
      const index = Number(this.el<HTMLSelectElement>('preset').value);
      const preset = stages[index];
      if (!preset) return;
      this.loadStage(JSON.parse(JSON.stringify(preset)) as StageDef, null);
      this.toast(`"${this.stage.title}" 불러옴`);
    });

    this.el('clear').addEventListener('click', () => {
      if (!confirm('모든 도형을 지울까요?')) return;
      this.stage.entities = [];
      this.selected = null;
      this.renderProps();
      this.revalidate();
      this.persistDraft();
    });

    this.el('export').addEventListener('click', () => {
      this.el<HTMLTextAreaElement>('out').value = exportStage(this.stage);
      this.toast('코드를 생성했습니다');
    });

    this.el('copy').addEventListener('click', async () => {
      const text = this.el<HTMLTextAreaElement>('out').value;
      if (!text) return this.toast('먼저 코드를 생성하세요');
      try {
        await navigator.clipboard.writeText(text);
        this.toast('복사했습니다');
      } catch {
        this.el<HTMLTextAreaElement>('out').select();
        this.toast('Ctrl+C로 복사하세요');
      }
    });

    const closeBtn = this.root.querySelector('[data-role="close"]');
    closeBtn?.addEventListener('click', () => this.options.onClose?.());
  }

  // ----------------------------------------------------------- saved maps

  private loadStage(stage: StageDef, id: string | null) {
    this.stage = stage;
    this.currentId = id;
    this.selected = null;
    this.draft = [];
    this.syncStageFields();
    this.view.fit(this.canvas, this.stage.goalY);
    this.renderProps();
    this.revalidate();
    this.persistDraft();
    this.updateSaveState();
  }

  private async save(asNew: boolean) {
    const errors = this.problems.filter((p) => p.level === 'error');
    if (errors.length) {
      this.toast('먼저 문제를 해결하세요: ' + errors[0].message);
      return;
    }
    if (!this.stage.title.trim()) {
      this.toast('맵 이름을 입력하세요');
      return;
    }

    const record = await saveCustomMap(
      this.stage,
      asNew ? undefined : this.currentId ?? undefined,
    );
    this.currentId = record.id;
    await this.refreshSavedMaps();
    this.updateSaveState();
    this.options.onMapsChanged?.();
    this.toast(`"${record.title}" 저장됨 - 맵 목록에서 고를 수 있습니다`);
  }

  private async refreshSavedMaps() {
    this.savedMaps = await getCustomMaps();
    const list = this.el<HTMLUListElement>('savedList');
    list.innerHTML = '';

    if (this.savedMaps.length === 0) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="empty">저장한 맵이 없습니다.</span>';
      list.append(li);
      return;
    }

    this.savedMaps.forEach((map) => {
      const li = document.createElement('li');

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent =
        map.title + (map.id === this.currentId ? ' (편집 중)' : '');

      const edit = document.createElement('button');
      edit.textContent = '편집';
      edit.addEventListener('click', () => {
        this.loadStage(
          JSON.parse(JSON.stringify(map)) as StageDef,
          map.id,
        );
        void this.refreshSavedMaps();
        this.toast(`"${map.title}" 불러옴`);
      });

      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '삭제';
      del.addEventListener('click', async () => {
        if (!confirm(`"${map.title}" 맵을 지울까요?`)) return;
        await deleteCustomMap(map.id);
        if (this.currentId === map.id) this.currentId = null;
        await this.refreshSavedMaps();
        this.updateSaveState();
        this.options.onMapsChanged?.();
      });

      li.append(name, edit, del);
      list.append(li);
    });
  }

  private updateSaveState() {
    this.el('saveState').textContent = this.currentId
      ? '저장된 맵을 편집 중입니다. "이 맵 저장"은 덮어씁니다.'
      : '저장되지 않음';
  }

  // ---------------------------------------------------------------- input

  private mousePos(e: MouseEvent): VectorLike {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }

  private snap(p: VectorLike): VectorLike {
    if (!this.el<HTMLInputElement>('snap').checked) return p;
    const step = Number(this.el<HTMLSelectElement>('snapsize').value);
    return {
      x: Math.round(p.x / step) * step,
      y: Math.round(p.y / step) * step,
    };
  }

  private bindCanvas() {
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.view.zoomAt(this.mousePos(e), e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    this.canvas.addEventListener('mousedown', (e) => {
      const screen = this.mousePos(e);
      const world = this.view.toWorld(screen);
      this.lastMouse = screen;

      if (e.button === 1 || this.spaceHeld) {
        this.panning = true;
        return;
      }

      if (e.button === 2) {
        if (this.tool === 'wall' && this.draft.length >= 2) this.commitWall();
        else this.draft = [];
        return;
      }

      if (this.tool === 'wall') {
        this.draft.push(this.snap(world));
        return;
      }

      if (this.tool === 'select') {
        const hit = this.pick(world);
        this.selected = hit;
        this.renderProps();
        if (hit) {
          this.dragging = hit;
          this.dragOffset = {
            x: world.x - hit.position.x,
            y: world.y - hit.position.y,
          };
        }
        return;
      }

      this.placeEntity(this.snap(world));
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const screen = this.mousePos(e);
      const world = this.view.toWorld(screen);
      this.cursor = world;
      this.el('pos').textContent =
        `x ${world.x.toFixed(2)}, y ${world.y.toFixed(2)}`;

      if (this.panning) {
        this.view.panBy(screen.x - this.lastMouse.x, screen.y - this.lastMouse.y);
      } else if (this.dragging) {
        const target = this.snap({
          x: world.x - this.dragOffset.x,
          y: world.y - this.dragOffset.y,
        });
        this.dragging.position.x = target.x;
        this.dragging.position.y = target.y;
      }
      this.lastMouse = screen;
    });

    const endDrag = () => {
      if (this.dragging) {
        this.revalidate();
        this.persistDraft();
        this.renderProps();
      }
      this.dragging = null;
      this.panning = false;
    };
    this.canvas.addEventListener('mouseup', endDrag);
    this.canvas.addEventListener('mouseleave', endDrag);

    this.canvas.addEventListener('dblclick', () => {
      if (this.tool === 'wall' && this.draft.length >= 2) this.commitWall();
    });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.destroyed || !this.root.isConnected) return;
    // Do not steal keys while the editor is hidden behind the game.
    if (this.root.offsetParent === null && this.root.tagName !== 'BODY') return;

    const target = e.target as HTMLElement;
    if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;

    if (e.code === 'Space') {
      this.spaceHeld = true;
      e.preventDefault();
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'v': this.setTool('select'); break;
      case 'w': this.setTool('wall'); break;
      case 'p': this.setTool('peg'); break;
      case 'b': this.setTool('box'); break;
      case 'r': this.setTool('spinner'); break;
      case 'm': this.setTool('magnet'); break;
      case 'f': this.view.fit(this.canvas, this.stage.goalY); break;
      case 't': void this.startRun(); break;
      case 'enter':
        if (this.tool === 'wall' && this.draft.length >= 2) this.commitWall();
        break;
      case 'escape':
        if (this.draft.length || this.selected) {
          this.draft = [];
          this.selected = null;
          this.renderProps();
        } else {
          this.options.onClose?.();
        }
        break;
      case 'delete':
      case 'backspace':
        this.deleteSelected();
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') this.spaceHeld = false;
  };

  private onResize = () => this.resize();

  // ------------------------------------------------------------- entities

  private pick(world: VectorLike): MapEntity | null {
    const tolerance = 6 / this.view.scale;
    const entities = this.stage.entities ?? [];
    for (let i = entities.length - 1; i >= 0; i--) {
      if (hitTest(entities[i], world, tolerance)) return entities[i];
    }
    return null;
  }

  private addEntity(entity: MapEntity) {
    if (!this.stage.entities) this.stage.entities = [];
    this.stage.entities.push(entity);
    this.selected = entity;
    this.renderProps();
    this.revalidate();
    this.persistDraft();
  }

  private placeEntity(at: VectorLike) {
    const base = { density: 1, angularVelocity: 0, restitution: 0 };

    if (this.tool === 'peg') {
      this.addEntity({
        type: 'static',
        position: { ...at },
        props: { ...base, restitution: 0.4 },
        shape: { type: 'circle', radius: 0.35 },
      });
    } else if (this.tool === 'box') {
      this.addEntity({
        type: 'static',
        position: { ...at },
        props: { ...base },
        shape: { type: 'box', width: 1.5, height: 0.15, rotation: 0 },
      });
    } else if (this.tool === 'spinner') {
      this.addEntity({
        type: 'kinematic',
        position: { ...at },
        props: { ...base, angularVelocity: 1.4 },
        shape: { type: 'box', width: 1.6, height: 0.15, rotation: 0 },
      });
    } else if (this.tool === 'magnet') {
      this.addEntity({
        type: 'static',
        position: { ...at },
        props: { ...base, stickDuration: 1200 },
        shape: { type: 'circle', radius: 0.55, color: MAGNET_COLOR },
      });
    }
  }

  private commitWall() {
    if (this.draft.length < 2) return;
    const anchor = this.draft[0];
    this.addEntity({
      type: 'static',
      position: { x: anchor.x, y: anchor.y },
      props: { density: 1, angularVelocity: 0, restitution: 0 },
      shape: {
        type: 'polyline',
        rotation: 0,
        points: this.draft.map((p) => [
          Number((p.x - anchor.x).toFixed(4)),
          Number((p.y - anchor.y).toFixed(4)),
        ]) as [number, number][],
      },
    });
    this.draft = [];
  }

  private deleteSelected() {
    if (!this.selected || !this.stage.entities) return;
    const index = this.stage.entities.indexOf(this.selected);
    if (index >= 0) this.stage.entities.splice(index, 1);
    this.selected = null;
    this.renderProps();
    this.revalidate();
    this.persistDraft();
  }

  // ---------------------------------------------------------------- props

  private renderProps() {
    const host = this.el('props');
    const entity = this.selected;

    if (!entity) {
      host.innerHTML = '<p class="empty">선택된 도형이 없습니다.</p>';
      return;
    }

    const rows: string[] = [];
    const num = (label: string, key: string, value: number, step = 0.05) =>
      `<div class="row"><label>${label}</label>` +
      `<input type="number" data-prop="${key}" value="${value}" step="${step}"></div>`;

    rows.push(
      `<div class="row"><label>종류</label><input type="text" value="${entity.shape.type}" disabled></div>`,
    );
    rows.push(num('위치 X', 'position.x', entity.position.x));
    rows.push(num('위치 Y', 'position.y', entity.position.y));

    if (entity.shape.type === 'circle') {
      rows.push(num('반지름', 'shape.radius', entity.shape.radius));
    } else if (entity.shape.type === 'box') {
      rows.push(num('폭(절반)', 'shape.width', entity.shape.width));
      rows.push(num('높이(절반)', 'shape.height', entity.shape.height));
      rows.push(num('기울기(rad)', 'shape.rotation', entity.shape.rotation));
    }

    rows.push(num('반발력', 'props.restitution', entity.props.restitution));
    rows.push(num('회전속도', 'props.angularVelocity', entity.props.angularVelocity, 0.1));
    rows.push(
      `<div class="row"><label>움직임</label>` +
      `<select data-prop="type">` +
      `<option value="static"${entity.type === 'static' ? ' selected' : ''}>고정</option>` +
      `<option value="kinematic"${entity.type === 'kinematic' ? ' selected' : ''}>회전</option>` +
      `</select></div>`,
    );
    rows.push(
      num('붙잡는 시간(ms)', 'props.stickDuration', entity.props.stickDuration ?? 0, 100),
    );
    rows.push(
      `<div class="row"><label>닿으면 사라짐</label>` +
      `<input type="checkbox" data-prop="props.life"${entity.props.life ? ' checked' : ''}></div>`,
    );
    rows.push(
      `<div class="row"><label>색</label>` +
      `<input type="text" data-prop="shape.color" value="${entity.shape.color ?? ''}" placeholder="비우면 기본색"></div>`,
    );
    rows.push(`<button class="me-btn danger" data-role="del">이 도형 삭제</button>`);

    host.innerHTML = rows.join('');

    host.querySelectorAll<HTMLElement>('[data-prop]').forEach((input) => {
      input.addEventListener('input', () => this.applyProp(entity, input));
      input.addEventListener('change', () => this.applyProp(entity, input));
    });
    host.querySelector('[data-role="del"]')?.addEventListener('click', () =>
      this.deleteSelected(),
    );
  }

  private applyProp(entity: MapEntity, input: HTMLElement) {
    const path = input.dataset.prop!;
    const shape = entity.shape as unknown as Record<string, unknown>;

    if (path === 'type') {
      entity.type = (input as HTMLSelectElement).value as MapEntity['type'];
    } else if (path === 'props.life') {
      if ((input as HTMLInputElement).checked) entity.props.life = 1;
      else delete entity.props.life;
    } else if (path === 'shape.color') {
      const value = (input as HTMLInputElement).value.trim();
      if (value) shape.color = value;
      else delete shape.color;
    } else {
      const value = Number((input as HTMLInputElement).value);
      if (Number.isNaN(value)) return;
      if (path === 'position.x') entity.position.x = value;
      else if (path === 'position.y') entity.position.y = value;
      else if (path === 'props.restitution') entity.props.restitution = value;
      else if (path === 'props.angularVelocity') entity.props.angularVelocity = value;
      else if (path === 'props.stickDuration') {
        if (value > 0) entity.props.stickDuration = value;
        else delete entity.props.stickDuration;
      }
      else shape[path.replace('shape.', '')] = value;
    }

    this.revalidate();
    this.persistDraft();
  }

  // ------------------------------------------------------------- test run

  private async startRun() {
    const count = Math.max(
      1,
      Number(this.el<HTMLInputElement>('count').value) || 20,
    );
    this.el('runStatus').textContent = '물리 엔진 준비 중...';
    try {
      await this.run.start(
        JSON.parse(JSON.stringify(this.stage)) as StageDef,
        count,
      );
      this.setTool('select');
    } catch (e) {
      this.el('runStatus').textContent = '주행 실패: ' + (e as Error).message;
    }
  }

  // -------------------------------------------------------------- storage

  private persistDraft() {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ stage: this.stage, id: this.currentId }),
      );
    } catch {
      // Storage unavailable - editing still works, it just will not be kept.
    }
  }

  private restoreDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const stage = parsed?.stage ?? parsed;
      if (stage && Array.isArray(stage.entities)) {
        this.stage = stage as StageDef;
        this.currentId = typeof parsed?.id === 'string' ? parsed.id : null;
      }
    } catch {
      // Ignore a corrupt draft.
    }
  }

  private revalidate() {
    this.problems = validateStage(this.stage);
    const errors = this.problems.filter((p) => p.level === 'error');
    const warns = this.problems.filter((p) => p.level === 'warn');
    const el = this.el('valid');

    if (errors.length) {
      el.className = 'warn';
      el.textContent = '⚠ ' + errors[0].message;
    } else if (warns.length) {
      el.className = 'warn';
      el.textContent = '· ' + warns[0].message;
    } else {
      el.className = 'ok';
      el.textContent = '✓ 제약 조건 통과';
    }

    this.el('count-label').textContent =
      `도형 ${(this.stage.entities ?? []).length}개`;
  }

  private toast(message: string) {
    const el = this.el('toast');
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1800);
  }

  // --------------------------------------------------------------- render

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
  }

  private frame = () => {
    if (this.destroyed) return;
    this.frameHandle = requestAnimationFrame(this.frame);

    // Skip work entirely while hidden inside the game.
    if (this.root.offsetParent === null && this.root.tagName !== 'BODY') return;

    this.run.update();
    if (this.run.running) {
      const secs = (this.run.elapsedMs / 1000).toFixed(1);
      const stuck = this.run.stuckCount
        ? ` · 멈춘 구슬 ${this.run.stuckCount}개`
        : '';
      this.el('runStatus').textContent =
        `주행 중 ${this.run.finished}/${this.run.total} 도착 · ${secs}초${stuck}`;
    } else if (this.run.total > 0 && this.run.finished === this.run.total) {
      this.el('runStatus').textContent =
        `✓ 전원 완주 (${(this.run.elapsedMs / 1000).toFixed(1)}초)`;
    }

    this.draw();
  };

  private draw() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.translate(
      -this.view.offset.x * this.view.scale,
      -this.view.offset.y * this.view.scale,
    );
    ctx.scale(this.view.scale, this.view.scale);

    this.drawGrid(ctx);
    if (this.el<HTMLInputElement>('guides').checked) this.drawGuides(ctx);
    this.drawEntities(ctx);
    this.drawDraft(ctx);
    this.drawMarbles(ctx);

    ctx.restore();
  }

  private drawGrid(ctx: CanvasRenderingContext2D) {
    const topLeft = this.view.toWorld({ x: 0, y: 0 });
    const bottomRight = this.view.toWorld({
      x: this.canvas.width,
      y: this.canvas.height,
    });

    const step = this.view.scale > 14 ? 1 : 5;
    ctx.lineWidth = 1 / this.view.scale;
    ctx.strokeStyle = '#242424';
    ctx.beginPath();
    for (let x = Math.floor(topLeft.x / step) * step; x <= bottomRight.x; x += step) {
      ctx.moveTo(x, topLeft.y);
      ctx.lineTo(x, bottomRight.y);
    }
    for (let y = Math.floor(topLeft.y / step) * step; y <= bottomRight.y; y += step) {
      ctx.moveTo(topLeft.x, y);
      ctx.lineTo(bottomRight.x, y);
    }
    ctx.stroke();
  }

  private drawGuides(ctx: CanvasRenderingContext2D) {
    const top = this.view.toWorld({ x: 0, y: 0 }).y;
    const bottom = this.view.toWorld({ x: 0, y: this.canvas.height }).y;
    const px = 1 / this.view.scale;

    ctx.strokeStyle = '#3d5a80';
    ctx.lineWidth = px;
    ctx.setLineDash([4 * px, 4 * px]);
    ctx.beginPath();
    ctx.moveTo(0, top); ctx.lineTo(0, bottom);
    ctx.moveTo(MINIMAP_WIDTH, top); ctx.lineTo(MINIMAP_WIDTH, bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(80, 200, 120, 0.10)';
    ctx.fillRect(SPAWN_X_MIN, -12, SPAWN_X_MAX - SPAWN_X_MIN, 14);
    ctx.strokeStyle = 'rgba(80, 200, 120, 0.55)';
    ctx.lineWidth = px;
    ctx.strokeRect(SPAWN_X_MIN, -12, SPAWN_X_MAX - SPAWN_X_MIN, 14);

    ctx.fillStyle = 'rgba(80, 200, 120, 0.9)';
    ctx.font = '0.9px sans-serif';
    ctx.fillText('구슬 시작 구역', SPAWN_X_MIN, -12.4);

    const line = (y: number, color: string, label: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(-4, y);
      ctx.lineTo(MINIMAP_WIDTH + 4, y);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '0.9px sans-serif';
      ctx.fillText(label, MINIMAP_WIDTH + 0.4, y - 0.3);
    };
    line(this.stage.goalY, '#e0563f', '결승선');
    line(this.stage.zoomY, '#9b6bd8', '줌 시작');
  }

  private strokeShape(ctx: CanvasRenderingContext2D, entity: MapEntity) {
    const shape: EntityShape = entity.shape;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);

    if (shape.type === 'polyline') {
      ctx.beginPath();
      const pts = shape.points;
      if (pts.length) {
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.stroke();
    } else if (shape.type === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, shape.radius, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.rotate(shape.rotation);
      ctx.strokeRect(-shape.width, -shape.height, shape.width * 2, shape.height * 2);
    }

    ctx.restore();
  }

  private drawEntities(ctx: CanvasRenderingContext2D) {
    const px = 1 / this.view.scale;
    (this.stage.entities ?? []).forEach((entity) => {
      const isSelected = entity === this.selected;
      ctx.lineWidth = (isSelected ? 3 : 2) * px;
      ctx.strokeStyle = isSelected
        ? '#ffd166'
        : entity.shape.color ??
          (entity.props.stickDuration
            ? MAGNET_COLOR
            : entity.type === 'kinematic'
              ? '#4dd0e1'
              : '#dddddd');
      this.strokeShape(ctx, entity);

      if (isSelected) {
        const b = entityBounds(entity);
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.45)';
        ctx.lineWidth = px;
        ctx.setLineDash([3 * px, 3 * px]);
        ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
        ctx.setLineDash([]);
      }
    });
  }

  private drawDraft(ctx: CanvasRenderingContext2D) {
    if (this.tool !== 'wall' || this.draft.length === 0) return;
    const px = 1 / this.view.scale;

    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.moveTo(this.draft[0].x, this.draft[0].y);
    for (let i = 1; i < this.draft.length; i++) {
      ctx.lineTo(this.draft[i].x, this.draft[i].y);
    }
    const preview = this.snap(this.cursor);
    ctx.lineTo(preview.x, preview.y);
    ctx.stroke();

    ctx.fillStyle = '#ffd166';
    this.draft.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 * px, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private drawMarbles(ctx: CanvasRenderingContext2D) {
    const marbles = this.run.activeMarbles;
    if (marbles.length === 0) return;
    const px = 1 / this.view.scale;

    marbles.forEach((marble, i) => {
      const stuck = this.run.isStuck(i);
      ctx.fillStyle = stuck ? '#ff4d4d' : marble.color;
      ctx.beginPath();
      ctx.arc(marble.x, marble.y, MARBLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      if (stuck) {
        ctx.strokeStyle = '#ff4d4d';
        ctx.lineWidth = 2 * px;
        ctx.beginPath();
        ctx.arc(marble.x, marble.y, MARBLE_RADIUS + 4 * px, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }
}
