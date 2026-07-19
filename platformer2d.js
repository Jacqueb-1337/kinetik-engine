// Reusable axis-aligned 2D platformer motion and collision.
// Coordinates use X right and Y down. A collider may disable any collision
// face: { collisionSides: { top, bottom, left, right } }.
export function stepPlatformer2D(body, input, colliders, delta, options = {}) {
  const dt = Math.max(1 / 120, Math.min(1 / 20, delta || 1 / 60));
  const accel = options.acceleration ?? 1200;
  const maxSpeed = options.maxSpeed ?? 170;
  const friction = options.friction ?? 1500;
  const gravity = options.gravity ?? 2200;
  const jumpSpeed = options.jumpSpeed ?? 500;
  const coyoteTime = options.coyoteTime ?? 0.12;
  const sideOn = (collider, side) => collider.collidable !== false && collider.collisionSides?.[side] !== false;
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  const move = Math.max(-1, Math.min(1, input.moveX || 0));
  if (move) {
    body.velX += move * accel * dt;
    body.velX = Math.max(-maxSpeed, Math.min(maxSpeed, body.velX));
    body.facing = move < 0 ? -1 : 1;
  } else {
    const stop = friction * dt;
    body.velX = body.velX > 0 ? Math.max(0, body.velX - stop) : Math.min(0, body.velX + stop);
  }
  body.coyoteTimer = body.onGround ? coyoteTime : Math.max(0, (body.coyoteTimer || 0) - dt);
  if (input.jumpPressed && (body.onGround || body.coyoteTimer > 0)) {
    body.velY = -jumpSpeed; body.onGround = false; body.coyoteTimer = 0;
  }
  body.velY += gravity * dt;

  const oldX = body.x;
  body.x += body.velX * dt;
  for (const c of colliders) {
    if (!overlaps({ x: body.x, y: body.y, w: body.w, h: body.h }, c)) continue;
    if (body.velX > 0 && oldX + body.w <= c.x && sideOn(c, 'left')) { body.x = c.x - body.w; body.velX = 0; }
    if (body.velX < 0 && oldX >= c.x + c.w && sideOn(c, 'right')) { body.x = c.x + c.w; body.velX = 0; }
  }
  if (options.minX != null) body.x = Math.max(options.minX, body.x);
  if (options.maxX != null) body.x = Math.min(options.maxX, body.x);

  const oldY = body.y;
  body.y += body.velY * dt;
  body.onGround = false;
  if (options.floorY != null && body.y + body.h >= options.floorY) { body.y = options.floorY - body.h; body.velY = 0; body.onGround = true; }
  for (const c of colliders) {
    if (!overlaps({ x: body.x, y: body.y, w: body.w, h: body.h }, c)) continue;
    if (body.velY >= 0 && oldY + body.h <= c.y && sideOn(c, 'top')) { body.y = c.y - body.h; body.velY = 0; body.onGround = true; }
    if (body.velY < 0 && oldY >= c.y + c.h && sideOn(c, 'bottom')) { body.y = c.y + c.h; body.velY = 0; }
  }
  return body;
}
