// js/play.js (TILE + TOUCH + DRAG TOGGLE)
(() => {
  Storage.ensureProfile();

  const $ = (id) => document.getElementById(id);
  const pad2 = (n) => (n < 10 ? "0" + n : "" + n);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function parseDayFromUrl() {
    const u = new URL(location.href);
    const q = u.searchParams.get("day");
    if (q && ["1", "2", "3"].includes(q)) return Number(q);
    const auto = Config.getTodayEventDay();
    return auto || 1;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ----- config/day -----
  const day = parseDayFromUrl();
  const dc = Config.getDayConfig(day);
  if (!dc) {
    alert("Không tìm thấy cấu hình ngày " + day);
    location.href = "index.html";
    return;
  }
  $("sceneTitle").textContent = dc.title;

  // ----- DOM -----
  const canvas = $("game");
  const ctx = canvas.getContext("2d");
  const nextCanvas = $("next");
  const nctx = nextCanvas.getContext("2d");

  const timeEl = $("timeLeft");
  const progEl = $("progress");
  const statusEl = $("status");

  const modalRef = $("modalRef");
  const modalResult = $("modalResult");
  const modalMirror = $("modalMirror");

  const refImgEl = $("refImg");
  const btnShowRef = $("btnShowRef");
  const btnIRemember = $("btnIRemember");
  const btnCloseRef = $("btnCloseRef");

  const btnStart = $("btnStart");
  const btnRestart = $("btnRestart");

  const resultTitle = $("resultTitle");
  const resultText = $("resultText");

  const mirrorGrid = $("mirrorGrid");
  const btnMirrorCancel = $("btnMirrorCancel");

  const toggleDrag = $("toggleDrag"); // NEW

  // ----- Game config -----
  const G = Config.GAME;
  const COLS = G.cols;
  const ROWS = G.rows;
  const TOTAL = COLS * ROWS;

  // Board cell size (auto-fit for mobile)
  const maxW = Math.min(520, Math.max(260, window.innerWidth - 28));
  const maxH = Math.min(520, Math.max(260, Math.floor(window.innerHeight * 0.55)));
  const CELL = Math.floor(Math.min(maxW / COLS, maxH / ROWS));

  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;

  // ----- Image slicing -----
  let img = null;
  let tiles = null; // tiles[id] = {sx,sy,sw,sh, tx,ty}

  // ----- State -----
  let bag = [];
  let board = null; // board[y][x] = tileId or null

  // current "hand" tile
  let piece = { x: Math.floor(COLS / 2), y: 0, id: null };
  let nextId = null;

  let running = false;
  let started = false;
  let doneReward = false;

  let timer = G.seconds;
  let tickMs = G.tickMs;
  let fallAccum = 0;
  let lastTs = 0;
  let softDropping = false;

  let timerHandle = null;

  // drag feature
  let dragEnabled = true;
  const K_DRAG = "cgp_drag_enabled";

  const drag = {
    active: false,
    fromPiece: false,
    id: null,
    ox: null, oy: null,   // origin cell if dragging from board
    px: 0, py: 0,         // pointer in canvas coords (for drawing)
  };

  function tileTargetPos(id) {
    return { tx: id % COLS, ty: Math.floor(id / COLS) };
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Không load được ảnh: " + url));
      im.src = url;
    });
  }

  function buildTiles(im) {
    const tw = im.naturalWidth / COLS;
    const th = im.naturalHeight / ROWS;
    const list = new Array(TOTAL);

    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        const id = ty * COLS + tx;
        list[id] = {
          id, tx, ty,
          sx: Math.floor(tx * tw),
          sy: Math.floor(ty * th),
          sw: Math.ceil(tw),
          sh: Math.ceil(th),
        };
      }
    }
    return list;
  }

  function updateHUD() {
    const m = Math.floor(timer / 60);
    const s = timer % 60;
    timeEl.textContent = `${pad2(m)}:${pad2(s)}`;
  }

  function computeProgress() {
    let correct = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const id = board[y][x];
        if (id == null) continue;
        const { tx, ty } = tileTargetPos(id);
        if (tx === x && ty === y) correct++;
      }
    }
    return Math.round((correct / TOTAL) * 100);
  }

  function updateProgress() {
    const p = computeProgress();
    progEl.textContent = p + "%";
    if (p === 100 && !doneReward) finishGame("win");
  }

  function drawTileAt(id, dx, dy, alpha = 1) {
    if (id == null) return;
    const t = tiles[id];
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, t.sx, t.sy, t.sw, t.sh, dx, dy, CELL, CELL);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.strokeRect(dx + 0.5, dy + 0.5, CELL - 1, CELL - 1);
  }

  function drawNext() {
    nctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (nextId == null || !img) return;

    const t = tiles[nextId];
    const size = Math.min(nextCanvas.width, nextCanvas.height) - 16;
    const dx = (nextCanvas.width - size) / 2;
    const dy = (nextCanvas.height - size) / 2;

    nctx.drawImage(img, t.sx, t.sy, t.sw, t.sh, dx, dy, size, size);
    nctx.strokeStyle = "rgba(0,0,0,.25)";
    nctx.strokeRect(dx + 0.5, dy + 0.5, size - 1, size - 1);
  }

  function draw() {
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const id = board[y][x];
        if (id != null) drawTileAt(id, x * CELL, y * CELL, 1);
        else {
          ctx.strokeStyle = "rgba(255,255,255,.06)";
          ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL - 1, CELL - 1);
        }
      }
    }

    // current hand tile (preview)
    if (!drag.active && piece.id != null) {
      drawTileAt(piece.id, piece.x * CELL, piece.y * CELL, 0.85);
    }

    // cursor highlight
    ctx.strokeStyle = "rgba(255,122,24,.85)";
    ctx.lineWidth = 2;
    ctx.strokeRect(piece.x * CELL + 1, piece.y * CELL + 1, CELL - 2, CELL - 2);
    ctx.lineWidth = 1;

    // floating tile while dragging
    if (drag.active && drag.id != null) {
      const dx = drag.px - CELL / 2;
      const dy = drag.py - CELL / 2;
      drawTileAt(drag.id, dx, dy, 0.95);

      ctx.strokeStyle = "rgba(255,122,24,.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(dx + 1, dy + 1, CELL - 2, CELL - 2);
      ctx.lineWidth = 1;
    }
  }

  function resetGame() {
    running = false;
    started = false;
    doneReward = false;

    timer = G.seconds;
    fallAccum = 0;
    lastTs = 0;
    softDropping = false;

    board = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));

    bag = [];
    for (let i = 0; i < TOTAL; i++) bag.push(i);
    shuffle(bag);

    piece = { x: Math.floor(COLS / 2), y: 0, id: bag.pop() ?? null };
    nextId = bag.pop() ?? null;

    drag.active = false;
    drag.id = null;

    drawNext();
    updateHUD();
    updateProgress();
    statusEl.textContent = "Sẵn sàng. Chạm để đặt, bật kéo-thả để đổi chỗ nhanh.";
    draw();
  }

  function spawnNext() {
    piece.x = clamp(piece.x, 0, COLS - 1);
    piece.y = clamp(piece.y, 0, ROWS - 1);

    piece.id = nextId;
    nextId = bag.pop() ?? null;
    drawNext();
  }

  // Tap place/swap at current cursor cell
  function placeAt(x, y) {
    if (!running) return;
    if (piece.id == null) return;

    piece.x = clamp(x, 0, COLS - 1);
    piece.y = clamp(y, 0, ROWS - 1);

    const cur = board[piece.y][piece.x];
    board[piece.y][piece.x] = piece.id;
    piece.id = cur; // swap -> tile bị đè trở thành tile trên tay

    if (piece.id == null) {
      if (nextId != null || bag.length > 0) spawnNext();
    }

    updateProgress();
    draw();
  }

  // ===== Touch helpers =====
  function evtToCell(e) {
    const rect = canvas.getBoundingClientRect();
    // map to canvas coords
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;

    const cx = (e.clientX - rect.left) * sx;
    const cy = (e.clientY - rect.top) * sy;

    const x = clamp(Math.floor(cx / CELL), 0, COLS - 1);
    const y = clamp(Math.floor(cy / CELL), 0, ROWS - 1);
    return { x, y, px: cx, py: cy };
  }

  // Drag swap between cells (when enabled)
  function startDragFromBoard(cell) {
    const id = board[cell.y][cell.x];
    if (id == null) return false;
    drag.active = true;
    drag.fromPiece = false;
    drag.id = id;
    drag.ox = cell.x;
    drag.oy = cell.y;
    drag.px = cell.px;
    drag.py = cell.py;
    board[cell.y][cell.x] = null; // take out
    return true;
  }

  function startDragFromPiece(cell) {
    if (piece.id == null) return false;
    drag.active = true;
    drag.fromPiece = true;
    drag.id = piece.id;
    drag.ox = null;
    drag.oy = null;
    drag.px = cell.px;
    drag.py = cell.py;
    piece.id = null; // temporarily remove from hand while dragging
    return true;
  }

  function cancelDrag() {
    if (!drag.active) return;
    if (drag.fromPiece) {
      // restore to hand
      piece.id = drag.id;
    } else {
      // restore to origin
      board[drag.oy][drag.ox] = drag.id;
    }
    drag.active = false;
    drag.id = null;
    updateProgress();
    draw();
  }

  function endDrag(cell) {
    if (!drag.active) return;

    if (drag.fromPiece) {
      // place dragged tile onto drop cell; swap with board cell -> becomes hand tile
      const old = board[cell.y][cell.x];
      board[cell.y][cell.x] = drag.id;
      piece.id = old;
      piece.x = cell.x;
      piece.y = cell.y;

      if (piece.id == null) {
        if (nextId != null || bag.length > 0) spawnNext();
      }
    } else {
      // swap between origin cell and drop cell
      const old = board[cell.y][cell.x];
      board[cell.y][cell.x] = drag.id;
      board[drag.oy][drag.ox] = old;
    }

    drag.active = false;
    drag.id = null;

    updateProgress();
    draw();
  }

  // ===== Timer & loop =====
  function startTimer() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      if (!running) return;
      timer = Math.max(0, timer - 1);
      updateHUD();
      if (timer <= 0) {
        clearInterval(timerHandle);
        finishGame("timeout");
      }
    }, 1000);
  }

  function stepDownWrap() {
    piece.y++;
    if (piece.y >= ROWS) piece.y = 0;
  }

  function loop(ts) {
    if (!running) return;

    if (!lastTs) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;

    // Khi bật kéo-thả: không auto-rơi (đỡ khó trên mobile)
    if (!dragEnabled && !drag.active) {
      const speed = softDropping ? G.softDropMs : tickMs;
      fallAccum += dt;
      while (fallAccum >= speed) {
        fallAccum -= speed;
        stepDownWrap();
      }
    }

    draw();
    requestAnimationFrame(loop);
  }

  // ===== Reward/Mirror (giữ nguyên logic) =====
  function showResult(title, html, actions) {
    modalResult.classList.add("show");
    resultTitle.textContent = title;
    resultText.innerHTML = html;

    const actWrap = $("resultActions");
    actWrap.innerHTML = "";

    const defaultActions = actions || [
      { text: "Về trang chính", cls: "btn", onClick: () => (location.href = "index.html") },
      { text: "Chơi lại", cls: "btnGhost", onClick: () => { modalResult.classList.remove("show"); resetGame(); } },
    ];

    for (const a of defaultActions) {
      const b = document.createElement("button");
      b.className = a.cls;
      b.textContent = a.text;
      b.onclick = a.onClick;
      actWrap.appendChild(b);
    }
  }

  function randDigit() { return String(Math.floor(Math.random() * 10)); }
  function randTwo() { return pad2(Math.floor(Math.random() * 100)); }

  function showMirror(accuracy, timeUsed) {
    modalMirror.classList.add("show");
    mirrorGrid.innerHTML = "";

    const correct = dc.reward;
    const decoys = [];
    while (decoys.length < 2) {
      const d = correct.length === 2 ? randTwo() : randDigit();
      if (d !== correct && !decoys.includes(d)) decoys.push(d);
    }

    const options = shuffle([correct, decoys[0], decoys[1]]);
    const correctIndex = options.indexOf(correct);

    options.forEach((_, idx) => {
      const card = document.createElement("div");
      card.className = "mirror";
      card.innerHTML = `
        <div class="mirrorTitle">Gương ${idx + 1}</div>
        <div class="mirrorSub">Chạm để chọn</div>
      `;
      card.onclick = () => {
        modalMirror.classList.remove("show");
        if (idx === correctIndex) {
          doneReward = true;
          giveReward(correct, accuracy, timeUsed, false);
        } else {
          showResult(
            "Sai gương rồi!",
            `Gương bạn chọn không có số đúng. Hãy chơi lại để thử tiếp.<br/>Tiến độ đúng lúc hết giờ: <b>${accuracy}%</b>`,
            [
              { text: "Chơi lại", cls: "btn", onClick: () => { modalResult.classList.remove("show"); resetGame(); } },
              { text: "Về trang chính", cls: "btnGhost", onClick: () => (location.href = "index.html") },
            ]
          );
        }
      };
      mirrorGrid.appendChild(card);
    });
  }

  function giveReward(rewardStr, accuracy, timeUsed, directWin) {
    Storage.setDigit(day, rewardStr);

    const digits = Storage.getDigits();
    const code = Storage.getFinalCode();
    const profile = Storage.getProfile();

    const payload = {
      id: profile.id,
      name: profile.name || "",
      code: code || "",
      d1: digits["1"] || "",
      d2: digits["2"] || "",
      d3: digits["3"] || "",
      day,
      accuracy,
      timeUsed,
    };
    const url = Config.buildSubmitUrl(payload);

    const msg = directWin
      ? `Bạn đã ghép đúng <b>100%</b>! Nhận số: <b>${rewardStr}</b><br/>Mã hiện tại: <b>${code}</b>`
      : `Bạn đã chọn đúng gương! Nhận số: <b>${rewardStr}</b><br/>Mã hiện tại: <b>${code}</b>`;

    showResult("Chúc mừng!", msg, [
      { text: "Gửi kết quả (Google Form)", cls: "btn", onClick: () => window.open(url, "_blank", "noopener,noreferrer") },
      { text: "Về trang chính", cls: "btnGhost", onClick: () => (location.href = "index.html") },
    ]);
  }

  function finishGame(reason) {
    if (doneReward) return;
    running = false;

    const accuracy = computeProgress();
    const timeUsed = G.seconds - timer;

    const profile = Storage.getProfile();
    Storage.addHistory({
      ts: new Date().toISOString(),
      day,
      accuracy,
      timeUsed,
      userId: profile.id,
      name: profile.name || "",
    });

    if (reason === "win") {
      doneReward = true;
      giveReward(dc.reward, accuracy, timeUsed, true);
      return;
    }

    if (timer <= 0 && accuracy >= G.passThreshold) {
      showMirror(accuracy, timeUsed);
      return;
    }

    showResult(
      "Chưa đạt",
      `Tiến độ đúng: <b>${accuracy}%</b> • Bạn cần <b>100%</b> (hoặc ≥ <b>${G.passThreshold}%</b> khi hết giờ để mở gương).`
    );
  }

  // ===== Keyboard (desktop giữ lại) =====
  function move(dx) { piece.x = clamp(piece.x + dx, 0, COLS - 1); draw(); }

  window.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space"].includes(e.code)) e.preventDefault();
    if (!running) return;

    if (e.code === "ArrowLeft") move(-1);
    if (e.code === "ArrowRight") move(1);
    if (e.code === "ArrowUp") { piece.y = clamp(piece.y - 1, 0, ROWS - 1); draw(); }
    if (e.code === "Space") placeAt(piece.x, piece.y);
    if (e.code === "ArrowDown") softDropping = true;
  });
  window.addEventListener("keyup", (e) => { if (e.code === "ArrowDown") softDropping = false; });

  // ===== TOUCH / POINTER =====
  let downInfo = null;

  canvas.addEventListener("pointerdown", (e) => {
    if (!running) return;
    canvas.setPointerCapture?.(e.pointerId);

    const cell = evtToCell(e);
    downInfo = { x: cell.x, y: cell.y, mx: cell.px, my: cell.py, t: Date.now() };

    if (dragEnabled) {
      // ưu tiên kéo mảnh đang đặt trên board, nếu trống thì kéo mảnh trên tay
      if (!startDragFromBoard(cell)) {
        startDragFromPiece(cell);
      }
      draw();
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!running) return;
    if (!drag.active) return;
    const cell = evtToCell(e);
    drag.px = cell.px;
    drag.py = cell.py;
    draw();
  });

  window.addEventListener("pointerup", (e) => {
    if (!running) return;
    const cell = evtToCell(e);

    // Drag end
    if (drag.active) {
      endDrag(cell);
      downInfo = null;
      return;
    }

    // Tap-to-place when drag is OFF
    if (!dragEnabled && downInfo) {
      // treat as tap
      placeAt(cell.x, cell.y);
      downInfo = null;
    }
  });

  // chống scroll khi kéo trên canvas (mobile)
  canvas.style.touchAction = "none";

  // ===== Ref modal flow =====
  function openRef() { modalRef.classList.add("show"); }
  btnShowRef.onclick = openRef;
  btnCloseRef.onclick = () => modalRef.classList.remove("show");

  btnIRemember.onclick = () => {
    modalRef.classList.remove("show");
    if (!started) {
      running = true;
      started = true;
      statusEl.textContent = "Đang chơi... (Chạm để đặt • Bật kéo-thả để swap nhanh)";
      startTimer();
      requestAnimationFrame(loop);
    }
  };

  btnStart.onclick = () => { if (!started) openRef(); };

  btnRestart.onclick = () => {
    modalRef.classList.remove("show");
    modalResult.classList.remove("show");
    modalMirror.classList.remove("show");
    if (timerHandle) clearInterval(timerHandle);
    resetGame();
    openRef();
  };

  btnMirrorCancel.onclick = () => modalMirror.classList.remove("show");

  // ===== Drag toggle persistence =====
  function loadDragSetting() {
    const v = localStorage.getItem(K_DRAG);
    dragEnabled = (v == null) ? true : (v === "1");
    if (toggleDrag) toggleDrag.checked = dragEnabled;
  }
  function saveDragSetting(v) {
    localStorage.setItem(K_DRAG, v ? "1" : "0");
  }

  if (toggleDrag) {
    loadDragSetting();
    toggleDrag.addEventListener("change", () => {
      dragEnabled = !!toggleDrag.checked;
      saveDragSetting(dragEnabled);
      // nếu đang kéo mà tắt thì hủy
      if (!dragEnabled && drag.active) cancelDrag();
      statusEl.textContent = dragEnabled
        ? "Kéo-thả đang BẬT: kéo mảnh để đổi chỗ (swap)."
        : "Kéo-thả đang TẮT: chạm 1 ô để đặt/đổi.";
      draw();
    });
  } else {
    loadDragSetting();
  }

  // ===== Init =====
  (async function init() {
    try {
      statusEl.textContent = "Đang tải ảnh thành phố...";
      refImgEl.src = dc.img;

      img = await loadImage(dc.img);
      tiles = buildTiles(img);

      resetGame();
      openRef();
      statusEl.textContent = "Xem tranh gốc, bấm 'Tôi đã nhớ' để bắt đầu.";
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Lỗi tải ảnh. Kiểm tra assets/dayX.jpg và CORS.";
      alert("Lỗi: " + err.message);
    }
  })();
})();