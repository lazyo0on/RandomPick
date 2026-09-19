/**
 * Markup and styles for the map editor.
 *
 * Kept here rather than in a page so the editor can be mounted both as a
 * standalone page (editor.html) and as an overlay inside the game, without
 * the two copies drifting apart. Everything is scoped under `.mapeditor`
 * so it cannot collide with the game's own styles.
 */

export const EDITOR_STYLE_ID = 'mapeditor-style';

export const EDITOR_CSS = `
.mapeditor {
  --me-bg: #1e1e1e;
  --me-panel: #252526;
  --me-line: #3a3a3a;
  --me-text: #ddd;
  --me-muted: #888;
  --me-accent: #0a84ff;

  position: absolute;
  inset: 0;
  display: flex;
  background: var(--me-bg);
  color: var(--me-text);
  font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif;
  text-align: left;
}

.mapeditor * { box-sizing: border-box; }

.mapeditor .me-tools,
.mapeditor .me-side {
  flex-shrink: 0;
  background: var(--me-panel);
  overflow-y: auto;
  padding: 10px;
}

.mapeditor .me-tools { width: 210px; border-right: 1px solid var(--me-line); }
.mapeditor .me-side { width: 300px; border-left: 1px solid var(--me-line); }

.mapeditor h2 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--me-muted);
  margin: 16px 0 6px;
  font-weight: 600;
}

.mapeditor h2:first-child { margin-top: 0; }

.mapeditor .me-btn,
.mapeditor .tool-btn {
  display: block;
  width: 100%;
  text-align: left;
  background: #333;
  color: var(--me-text);
  border: 1px solid #444;
  border-radius: 4px;
  padding: 7px 9px;
  margin-bottom: 4px;
  cursor: pointer;
  font: inherit;
}

.mapeditor .tool-btn:hover,
.mapeditor .me-btn:hover { filter: brightness(1.18); }

.mapeditor .tool-btn.active {
  background: var(--me-accent);
  border-color: var(--me-accent);
  color: #fff;
}

.mapeditor .tool-btn .key { float: right; opacity: .55; font-size: 11px; }

.mapeditor .me-btn {
  text-align: center;
  padding: 8px 10px;
  margin-bottom: 5px;
}

.mapeditor .me-btn.primary {
  background: var(--me-accent);
  border-color: var(--me-accent);
  color: #fff;
}

.mapeditor .me-btn.danger { background: #a33; border-color: #a33; color: #fff; }

.mapeditor .row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}

.mapeditor .row label {
  width: 76px;
  flex-shrink: 0;
  color: #aaa;
  padding: 0;
  margin: 0;
}

.mapeditor .row input[type=number],
.mapeditor .row input[type=text],
.mapeditor .row select {
  flex: 1;
  min-width: 0;
  background: var(--me-bg);
  color: #eee;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 4px 6px;
  font: inherit;
  height: auto;
}

.mapeditor .row input[type=checkbox] {
  width: auto;
  height: auto;
  margin: 0;
  position: static;
  -webkit-appearance: checkbox;
  appearance: checkbox;
}

.mapeditor .row input[type=checkbox]:before,
.mapeditor .row input[type=checkbox]:after { content: none; }

.mapeditor .hint {
  color: var(--me-muted);
  font-size: 11px;
  line-height: 1.45;
  margin: 6px 0 0;
}

.mapeditor .me-stage { flex: 1; position: relative; min-width: 0; }

.mapeditor canvas.me-canvas {
  display: block;
  width: 100%;
  height: 100%;
  position: static;
  cursor: crosshair;
}

.mapeditor .me-status {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, .65);
  padding: 5px 10px;
  font-size: 12px;
  color: #bbb;
  display: flex;
  gap: 16px;
  pointer-events: none;
}

.mapeditor .me-status .warn { color: #ffb020; }
.mapeditor .me-status .ok { color: #4ec95a; }

.mapeditor textarea {
  width: 100%;
  height: 120px;
  background: var(--me-bg);
  color: #9cdcfe;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 6px;
  font: 11px/1.4 ui-monospace, Consolas, monospace;
  resize: vertical;
  min-height: 0;
}

.mapeditor .empty { color: #777; font-style: italic; }

.mapeditor .me-saved-list { list-style: none; margin: 0; padding: 0; }

.mapeditor .me-saved-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  border-bottom: 1px solid #333;
}

.mapeditor .me-saved-list li:last-child { border-bottom: none; }

.mapeditor .me-saved-list .name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mapeditor .me-saved-list button {
  flex-shrink: 0;
  width: auto;
  margin: 0;
  padding: 4px 8px;
  background: #3a3a3a;
  color: var(--me-text);
  border: 1px solid #444;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
}

.mapeditor .me-saved-list button.del { background: #a33; border-color: #a33; color: #fff; }

.mapeditor .me-toast {
  position: absolute;
  left: 50%;
  bottom: 40px;
  transform: translateX(-50%);
  background: var(--me-accent);
  color: #fff;
  padding: 9px 16px;
  border-radius: 5px;
  opacity: 0;
  transition: opacity .2s;
  pointer-events: none;
  z-index: 5;
}

.mapeditor .me-toast.show { opacity: 1; }

.mapeditor .me-close {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 6;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid #555;
  background: rgba(0, 0, 0, .6);
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

/* Full-screen overlay used when the editor opens inside the game. */
#editorOverlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: none;
}

#editorOverlay.open { display: block; }
`;

/** The editor's DOM. `showClose` adds the button used by the in-game overlay. */
export function editorMarkup(showClose: boolean): string {
  return `
${showClose ? '<button class="me-close" data-role="close" title="닫기">&times;</button>' : ''}
<div class="me-tools">
  <h2>도구</h2>
  <button class="tool-btn active" data-tool="select">선택 / 이동<span class="key">V</span></button>
  <button class="tool-btn" data-tool="wall">벽 그리기<span class="key">W</span></button>
  <button class="tool-btn" data-tool="peg">핀 (원)<span class="key">P</span></button>
  <button class="tool-btn" data-tool="box">발판 (고정)<span class="key">B</span></button>
  <button class="tool-btn" data-tool="spinner">회전바<span class="key">R</span></button>
  <button class="tool-btn" data-tool="magnet">자석 돌멩이<span class="key">M</span></button>
  <p class="hint">
    벽: 클릭으로 점을 찍고 <b>Enter</b> 또는 더블클릭으로 완성, <b>Esc</b> 취소.<br>
    화면 이동은 <b>마우스 휠 드래그</b> 또는 <b>Space+드래그</b>, 확대/축소는 <b>휠</b>.<br>
    선택 후 <b>Delete</b>로 삭제.
  </p>

  <h2>맵 설정</h2>
  <div class="row"><label>이름</label><input type="text" data-role="title" value="My Map"></div>
  <div class="row"><label>결승선 Y</label><input type="number" data-role="goalY" value="92" step="1"></div>
  <div class="row"><label>줌 시작 Y</label><input type="number" data-role="zoomY" value="88" step="1"></div>

  <h2>보기</h2>
  <div class="row"><label>격자 스냅</label><input type="checkbox" data-role="snap" checked></div>
  <div class="row"><label>스냅 간격</label>
    <select data-role="snapsize">
      <option value="0.25">0.25</option>
      <option value="0.5" selected>0.5</option>
      <option value="1">1</option>
    </select>
  </div>
  <div class="row"><label>가이드</label><input type="checkbox" data-role="guides" checked></div>
  <button class="me-btn" data-role="fit">전체 보기 (F)</button>

  <h2>시험 주행</h2>
  <div class="row"><label>구슬 수</label><input type="number" data-role="count" value="20" min="1" max="100"></div>
  <button class="me-btn primary" data-role="run">주행 시작 (T)</button>
  <button class="me-btn" data-role="stop">정지</button>
  <p class="hint" data-role="runStatus">정지됨</p>
</div>

<div class="me-stage">
  <canvas class="me-canvas" data-role="canvas"></canvas>
  <div class="me-status">
    <span data-role="pos">x 0.00, y 0.00</span>
    <span data-role="count-label">도형 0개</span>
    <span data-role="valid"></span>
  </div>
</div>

<div class="me-side">
  <h2>내 맵</h2>
  <button class="me-btn primary" data-role="save">이 맵 저장</button>
  <button class="me-btn" data-role="saveAsNew">새 맵으로 저장</button>
  <p class="hint" data-role="saveState">저장되지 않음</p>
  <ul class="me-saved-list" data-role="savedList"></ul>

  <h2>선택한 도형</h2>
  <div data-role="props"><p class="empty">선택된 도형이 없습니다.</p></div>

  <h2>기본 맵 불러오기</h2>
  <div class="row"><select data-role="preset"></select></div>
  <button class="me-btn" data-role="load">불러오기</button>
  <button class="me-btn danger" data-role="clear">전부 지우기</button>

  <h2>공유용 코드</h2>
  <button class="me-btn" data-role="export">maps.ts 코드 생성</button>
  <textarea data-role="out" readonly placeholder="생성된 코드가 여기에 나옵니다."></textarea>
  <button class="me-btn" data-role="copy">복사</button>
  <p class="hint">
    저장한 맵은 이 브라우저에 남아 바로 쓸 수 있습니다.
    다른 사람에게 주거나 영구히 포함하려면 이 코드를
    <b>src/data/maps.ts</b>의 <code>stages</code> 배열 맨 끝에 붙여넣으세요.
  </p>
</div>
<div class="me-toast" data-role="toast"></div>
`;
}

/** Injects the editor stylesheet once per page. */
export function ensureEditorStyles() {
  if (document.getElementById(EDITOR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = EDITOR_STYLE_ID;
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);
}
