import { IPhysics } from './IPhysics';
import { StageDef } from './data/maps';
import Box2DFactory from 'box2d-wasm';
import { MapEntity, MapEntityState } from './types/MapEntity.type';

/** Must match the radius used when creating a marble body. */
const MARBLE_RADIUS = 0.25;

export class Box2dPhysics implements IPhysics {
  private Box2D!: typeof Box2D & EmscriptenModule;
  private gravity!: Box2D.b2Vec2;
  private world!: Box2D.b2World;

  private marbleMap: { [id: number]: Box2D.b2Body } = {};
  private entities: ({ body: Box2D.b2Body } & MapEntityState)[] = [];

  private deleteCandidates: Box2D.b2Body[] = [];

  /** Marbles currently stuck to a magnet, and where/until when. */
  private heldMarbles: {
    [id: number]: { until: number; x: number; y: number };
  } = {};
  private stickCooldown: { [id: number]: number } = {};
  private elapsedMs = 0;

  async init(): Promise<void> {
    this.Box2D = await Box2DFactory();
    this.gravity = new this.Box2D.b2Vec2(0, 10);
    this.world = new this.Box2D.b2World(this.gravity);
    console.log('box2d ready');
  }

  clear(): void {
    this.clearEntities();
  }

  clearMarbles(): void {
    Object.values(this.marbleMap).forEach((body) => {
      this.world.DestroyBody(body);
    });
    this.marbleMap = {};
    this.heldMarbles = {};
    this.stickCooldown = {};
  }

  createStage(stage: StageDef): void {
    this.createEntities(stage.entities);
  }

  createEntities(entities?: MapEntity[]) {
    if (!entities) return;

    const bodyTypes = {
      static: this.Box2D.b2_staticBody,
      kinematic: this.Box2D.b2_kinematicBody,
    } as const;

    entities.forEach((entity) => {
      const bodyDef = new this.Box2D.b2BodyDef();
      bodyDef.set_type(bodyTypes[entity.type]);
      const body = this.world.CreateBody(bodyDef);

      const fixtureDef = new this.Box2D.b2FixtureDef();
      fixtureDef.set_density(entity.props.density);
      fixtureDef.set_restitution(entity.props.restitution);

      let shape;
      switch (entity.shape.type) {
        case 'box':
          shape = new this.Box2D.b2PolygonShape();
          shape.SetAsBox(
            entity.shape.width,
            entity.shape.height,
            0,
            entity.shape.rotation,
          );
          fixtureDef.set_shape(shape);
          body.CreateFixture(fixtureDef);
          break;
        case 'polyline':
          shape = new this.Box2D.b2EdgeShape();
          for (let i = 0; i < entity.shape.points.length - 1; i++) {
            const p1 = entity.shape.points[i];
            const p2 = entity.shape.points[i + 1];
            const v1 = new this.Box2D.b2Vec2(p1[0], p1[1]);
            const v2 = new this.Box2D.b2Vec2(p2[0], p2[1]);
            const edge = new this.Box2D.b2EdgeShape();
            edge.SetTwoSided(v1, v2);
            body.CreateFixture(edge, 1);
          }
          break;
        case 'circle':
          shape = new this.Box2D.b2CircleShape();
          shape.set_m_radius(entity.shape.radius);
          fixtureDef.set_shape(shape);
          body.CreateFixture(fixtureDef);
          break;
      }

      body.SetAngularVelocity(entity.props.angularVelocity);
      body.SetTransform(
        new this.Box2D.b2Vec2(entity.position.x, entity.position.y),
        0,
      );
      this.entities.push({
        body,
        x: entity.position.x,
        y: entity.position.y,
        angle: 0,
        shape: entity.shape,
        life: entity.props.life ?? -1,
        stickDuration: entity.props.stickDuration ?? 0,
      });
    });
  }

  clearEntities() {
    this.entities.forEach((entity) => {
      this.world.DestroyBody(entity.body);
    });
    this.entities = [];
  }

  createMarble(id: number, x: number, y: number): void {
    const circleShape = new this.Box2D.b2CircleShape();
    circleShape.set_m_radius(MARBLE_RADIUS);

    const bodyDef = new this.Box2D.b2BodyDef();
    bodyDef.set_type(this.Box2D.b2_dynamicBody);
    bodyDef.set_position(new this.Box2D.b2Vec2(x, y));

    const body = this.world.CreateBody(bodyDef);
    body.CreateFixture(circleShape, 1 + Math.random());
    body.SetAwake(false);
    body.SetEnabled(false);
    this.marbleMap[id] = body;
  }

  shakeMarble(id: number): void {
    const body = this.marbleMap[id];
    if (body) {
      body.ApplyLinearImpulseToCenter(
        new this.Box2D.b2Vec2(Math.random() * 10 - 5, Math.random() * 10 - 5),
        true,
      );
    }
  }

  removeMarble(id: number): void {
    const marble = this.marbleMap[id];
    if (marble) {
      this.world.DestroyBody(marble);
      delete this.marbleMap[id];
    }
    delete this.heldMarbles[id];
    delete this.stickCooldown[id];
  }

  getMarblePosition(id: number): { x: number; y: number; angle: number } {
    const marble = this.marbleMap[id];
    if (marble) {
      const pos = marble.GetPosition();
      return { x: pos.x, y: pos.y, angle: marble.GetAngle() };
    } else {
      return { x: 0, y: 0, angle: 0 };
    }
  }

  getEntities(): MapEntityState[] {
    return this.entities.map((entity) => {
      return {
        ...entity,
        angle: entity.body.GetAngle(),
      };
    });
  }

  impact(id: number): void {
    const src = this.marbleMap[id];
    if (!src) return;

    Object.values(this.marbleMap).forEach((body) => {
      if (body === src) return;

      const distVector = new this.Box2D.b2Vec2(
        body.GetPosition().x,
        body.GetPosition().y,
      );
      distVector.op_sub(src.GetPosition());
      const distSq = distVector.LengthSquared();

      if (distSq < 100) {
        distVector.Normalize();
        const power = 1 - distVector.Length() / 10;
        distVector.op_mul(power * power * 5);
        body.ApplyLinearImpulseToCenter(distVector, true);
      }
    });
  }

  /**
   * Swaps this marble with a random one that is further ahead.
   *
   * Swapping rather than moving to an arbitrary spot means the marble always
   * lands somewhere another marble already fits, so it can never be dropped
   * outside the track or inside a wall on any map.
   * Returns false when there is nobody ahead to swap with.
   */
  teleport(id: number): boolean {
    const src = this.marbleMap[id];
    if (!src) return false;

    const sx = src.GetPosition().x;
    const sy = src.GetPosition().y;

    const ahead = Object.values(this.marbleMap).filter(
      (body) => body !== src && body.GetPosition().y > sy + 1,
    );
    if (ahead.length === 0) return false;

    const target = ahead[Math.floor(Math.random() * ahead.length)];
    const tx = target.GetPosition().x;
    const ty = target.GetPosition().y;

    src.SetTransform(new this.Box2D.b2Vec2(tx, ty), src.GetAngle());
    target.SetTransform(new this.Box2D.b2Vec2(sx, sy), target.GetAngle());
    src.SetAwake(true);
    target.SetAwake(true);
    return true;
  }

  start(): void {
    for (const key in this.marbleMap) {
      const marble = this.marbleMap[key];
      marble.SetAwake(true);
      marble.SetEnabled(true);
    }
  }

  /**
   * Holds a marble in place for a while when it touches a "magnet" entity.
   *
   * The hold is driven by a timer rather than a physics joint, so every held
   * marble is guaranteed to be let go; a marble can never be trapped forever
   * and stall the race. After release a short cooldown stops it from sticking
   * to the same rock again immediately.
   */
  private updateMagnets(deltaSeconds: number) {
    this.elapsedMs += deltaSeconds * 1000;

    const magnets = this.entities.filter((e) => (e.stickDuration ?? 0) > 0);

    // Release anything whose hold has expired, or whose marble is gone.
    for (const key of Object.keys(this.heldMarbles)) {
      const id = Number(key);
      const hold = this.heldMarbles[id];
      const body = this.marbleMap[id];

      if (!body) {
        delete this.heldMarbles[id];
        continue;
      }
      if (this.elapsedMs >= hold.until) {
        delete this.heldMarbles[id];
        this.stickCooldown[id] = this.elapsedMs + 2000;
        // A nudge away from the rock so it does not settle straight back on.
        body.ApplyLinearImpulseToCenter(
          new this.Box2D.b2Vec2((Math.random() - 0.5) * 2, 2.5),
          true,
        );
      }
    }

    if (magnets.length > 0) {
      for (const key of Object.keys(this.marbleMap)) {
        const id = Number(key);
        if (this.heldMarbles[id]) continue;
        if (this.elapsedMs < (this.stickCooldown[id] ?? 0)) continue;

        const body = this.marbleMap[id];
        const mx = body.GetPosition().x;
        const my = body.GetPosition().y;

        for (const magnet of magnets) {
          const radius =
            magnet.shape.type === 'circle' ? magnet.shape.radius : 0.5;
          const dx = mx - magnet.x;
          const dy = my - magnet.y;
          const dist = Math.hypot(dx, dy);
          const contact = radius + MARBLE_RADIUS;

          if (dist <= contact + 0.12) {
            const nx = dist > 0 ? dx / dist : 0;
            const ny = dist > 0 ? dy / dist : -1;
            this.heldMarbles[id] = {
              until: this.elapsedMs + (magnet.stickDuration ?? 0),
              x: magnet.x + nx * contact,
              y: magnet.y + ny * contact,
            };
            break;
          }
        }
      }
    }

    // Pin every held marble to the rock's surface.
    for (const key of Object.keys(this.heldMarbles)) {
      const id = Number(key);
      const body = this.marbleMap[id];
      if (!body) continue;
      const hold = this.heldMarbles[id];
      body.SetTransform(
        new this.Box2D.b2Vec2(hold.x, hold.y),
        body.GetAngle(),
      );
      body.SetLinearVelocity(new this.Box2D.b2Vec2(0, 0));
      body.SetAngularVelocity(0);
      body.SetAwake(true);
    }
  }

  step(deltaSeconds: number): void {
    this.deleteCandidates.forEach((body) => {
      this.world.DestroyBody(body);
    });
    this.deleteCandidates = [];

    this.world.Step(deltaSeconds, 6, 2);
    this.updateMagnets(deltaSeconds);

    for (let i = this.entities.length - 1; i >= 0; i--) {
      const entity = this.entities[i];
      if (entity.life > 0) {
        const edge = entity.body.GetContactList();
        if (edge.contact && edge.contact.IsTouching()) {
          this.deleteCandidates.push(entity.body);
          this.entities.splice(i, 1);
        }
      }
    }
  }
}
