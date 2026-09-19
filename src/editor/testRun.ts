import { Box2dPhysics } from '../physics-box2d';
import { Marble } from '../marble';
import { StageDef } from '../data/maps';
import options from '../options';

/**
 * Runs the map being edited with the game's own physics and marble classes,
 * so what happens here is what happens in the game.
 */
export class TestRun {
  private physics: Box2dPhysics | null = null;
  private marbles: Marble[] = [];
  private stage: StageDef | null = null;

  private lastTime = 0;
  private accumulator = 0;
  private readonly stepMs = 10;

  finished = 0;
  total = 0;
  elapsedMs = 0;
  running = false;

  /** Marbles that have not moved for a while - usually a map problem. */
  stuckCount = 0;
  private lastPositions: { x: number; y: number }[] = [];
  private stillMs: number[] = [];

  get activeMarbles(): Marble[] {
    return this.marbles;
  }

  async start(stage: StageDef, count: number) {
    this.stop();

    this.stage = stage;
    this.physics = new Box2dPhysics();
    await this.physics.init();
    this.physics.createStage(stage);

    // Skills would add randomness that has nothing to do with map layout.
    const previousUseSkills = options.useSkills;
    options.useSkills = false;

    this.marbles = [];
    for (let i = 0; i < count; i++) {
      this.marbles.push(new Marble(this.physics, i, count));
    }
    options.useSkills = previousUseSkills;

    this.physics.start();
    this.marbles.forEach((m) => (m.isActive = true));

    this.lastPositions = this.marbles.map((m) => ({ x: m.x, y: m.y }));
    this.stillMs = this.marbles.map(() => 0);

    this.total = count;
    this.finished = 0;
    this.elapsedMs = 0;
    this.stuckCount = 0;
    this.accumulator = 0;
    this.lastTime = 0;
    this.running = true;
  }

  stop() {
    this.running = false;
    this.marbles = [];
    this.lastPositions = [];
    this.stillMs = [];
    this.physics = null;
    this.stage = null;
  }

  /** Advances the simulation. Call once per animation frame. */
  update() {
    if (!this.running || !this.physics || !this.stage) return;

    const now = Date.now();
    if (!this.lastTime) this.lastTime = now;
    let delta = now - this.lastTime;
    this.lastTime = now;
    if (delta > 100) delta = 100;

    this.accumulator += delta;
    this.elapsedMs += delta;

    while (this.accumulator >= this.stepMs) {
      this.physics.step(this.stepMs / 1000);
      this.marbles.forEach((m) => m.update(this.stepMs));
      this.accumulator -= this.stepMs;
    }

    // Goal detection mirrors roulette.ts.
    const goalY = this.stage.goalY;
    const remaining: Marble[] = [];
    this.marbles.forEach((marble, i) => {
      if (marble.y > goalY) {
        this.finished++;
        this.physics!.removeMarble(marble.id);
        return;
      }

      const prev = this.lastPositions[i];
      if (prev && Math.hypot(marble.x - prev.x, marble.y - prev.y) < 0.01) {
        this.stillMs[i] = (this.stillMs[i] ?? 0) + delta;
      } else {
        this.stillMs[i] = 0;
      }
      remaining.push(marble);
    });

    // Compact the parallel arrays alongside the marble list.
    const keptStill: number[] = [];
    this.marbles.forEach((marble, i) => {
      if (marble.y <= goalY) keptStill.push(this.stillMs[i] ?? 0);
    });

    this.marbles = remaining;
    this.stillMs = keptStill;
    this.lastPositions = this.marbles.map((m) => ({ x: m.x, y: m.y }));
    this.stuckCount = this.stillMs.filter((ms) => ms > 3000).length;

    if (this.marbles.length === 0) this.running = false;
  }

  isStuck(index: number) {
    return (this.stillMs[index] ?? 0) > 3000;
  }
}
