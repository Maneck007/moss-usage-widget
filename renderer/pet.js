'use strict';
// Public edition: an original geometric desktop companion, drawn on canvas.
// The optional sheet argument supports a user-supplied 8x9 sprite sheet.

const CELL_W = 192, CELL_H = 208, COLS = 8;

// 行号 → 动作（9 行素材全映射）：
// 0 待机  1 摆动  2 倾身  3 招呼(挥手/伸出机械臂)  4 工作(青色扫描光)
// 5 警告(红色火花)  6/7 备用姿态(空闲彩蛋)  8 疾行(速度线，拖拽窗口时用)
const STATE_ANIM = {
  idle:  { row: 0, fps: 6 },
  sway:  { row: 1, fps: 7 },
  lean:  { row: 2, fps: 7 },
  greet: { row: 3, fps: 10, once: true },
  work:  { row: 4, fps: 8 },
  alert: { row: 5, fps: 8 },
  pose:  { row: 6, fps: 6 },
  pose2: { row: 7, fps: 6 },
  drag:  { row: 8, fps: 12 },
};

class MossPet {
  constructor(canvas, sheetUrl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sheet = sheetUrl ? new Image() : null;
    if (this.sheet) this.sheet.src = sheetUrl;
    this.stateName = 'idle';
    this.frame = 0;
    this.acc = 0;
    this.last = 0;
    this.onOnceDone = null;
    requestAnimationFrame(t => this._tick(t));
  }

  setState(name) {
    if (!STATE_ANIM[name]) name = 'idle';
    if (this.stateName === name) return;
    this.stateName = name;
    this.frame = 0;
    this.acc = 0;
  }

  playOnce(name, done) {
    this.setState(name);
    this.onOnceDone = done || null;
  }

  _tick(t) {
    if (!this.last) this.last = t;
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    const a = STATE_ANIM[this.stateName];
    this.acc += dt;
    const step = 1 / a.fps;
    while (this.acc >= step) {
      this.acc -= step;
      this.frame++;
      if (this.frame >= COLS) {
        if (a.once) {
          this.frame = COLS - 1;
          const cb = this.onOnceDone; this.onOnceDone = null;
          if (cb) { cb(); }
          break;
        }
        this.frame = 0;
      }
    }
    this._draw(a.row, this.frame);
    requestAnimationFrame(tt => this._tick(tt));
  }

  _draw(row, frame) {
    const { ctx, canvas, sheet } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sheet || !sheet.complete || !sheet.naturalWidth) {
      this._drawBuiltin(row, frame);
      return;
    }
    ctx.drawImage(sheet, frame * CELL_W, row * CELL_H, CELL_W, CELL_H,
      0, 0, canvas.width, canvas.height);
  }

  _drawBuiltin(row, frame) {
    const { ctx, canvas } = this;
    const wave = Math.sin(frame / COLS * Math.PI * 2);
    const color = row === 5 ? '#ff6b6b' : '#63e6be';
    ctx.save();
    ctx.scale(canvas.width / CELL_W, canvas.height / CELL_H);
    ctx.translate(row === 8 ? wave * 5 : 0, wave * 2);
    const box = (x, y, w, h, radius, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill();
    };
    // Monitor, stand and two small arms; no third-party artwork is embedded.
    box(34, 29, 124, 106, 22, '#172534');
    box(44, 39, 104, 76, 15, '#294356');
    box(54, 58, 84, 32, 10, color);
    box(71, 67, 8, row === 2 ? 3 : 12, 3, '#172534');
    box(113, 67, 8, row === 2 ? 3 : 12, 3, '#172534');
    box(79, 135, 34, 24, 5, '#294356');
    box(54, 158, 84, 13, 6, color);
    box(18, row === 3 ? 45 + wave * 10 : 100, 13, 28, 6, color);
    box(161, row === 3 ? 45 - wave * 10 : 100, 13, 28, 6, color);
    if (row === 4) box(50, 98, 92 * (frame + 1) / COLS, 4, 2, color);
    ctx.restore();
  }
}
