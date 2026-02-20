
console.log("PLAY TILE VERSION LOADED ✅");
// js/play.js (TILE-IMAGE VERSION: cắt ảnh gốc thành gạch và ghép lại)
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

  // ----- DOM -----
  $("sceneTitle").textContent = dc.title;

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

  // ----- Game config -----
  const G = Config.GAME;
  const COLS = G.cols;
  const ROWS = G.rows;
  const TOTAL = COLS * ROWS;

  // Resize canvas to fit grid nicely
  const CELL = Math.floor(Math.min(520 / COLS, 520 / ROWS));
  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;

  // ----- Image slicing -----
  let img = null;     // loaded Image
  let tiles = null;   // tiles[id] = {sx,sy,sw,sh, tx,ty}
  let bag = [];       // list of tile ids (shuffled)

  // ----- Board state -----
  let board = null; // board[y][x] = tileId or null

  // Piece is a single tile "cursor-falling"
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
          id,
          tx,
          ty,
          sx: Math.floor(tx * tw),
          sy: Math.floor(ty * th),
          sw: Math.ceil(tw),
          sh: Math.ceil(th),
        };
      }
    }
    return list;
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

    drawNext();
    updateHUD();
    updateProgress();
    statusEl.textContent = "Sẵn sàng. Hãy xem tranh gốc và bấm 'Tôi đã nhớ' để bắt đầu.";
    draw();
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
    // viền nhẹ
    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.strokeRect(dx + 0.5, dy + 0.5, CELL - 1, CELL - 1);
  }

  function draw() {
    // nền
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // tiles placed
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const id = board[y][x];
        if (id != null) {
          drawTileAt(id, x * CELL, y * CELL, 1);
        } else {
          // grid
          ctx.strokeStyle = "rgba(255,255,255,.06)";
          ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL - 1, CELL - 1);
        }
      }
    }

    // current piece preview (semi transparent)
    if (piece.id != null) {
      drawTileAt(piece.id, piece.x * CELL, piece.y * CELL, 0.85);
      // highlight cursor
      ctx.strokeStyle = "rgba(255,122,24,.85)";
      ctx.lineWidth = 2;
      ctx.strokeRect(piece.x * CELL + 1, piece.y * CELL + 1, CELL - 2, CELL - 2);
      ctx.lineWidth = 1;
    } else {
      // nếu không có mảnh trên tay: vẫn highlight ô đang chọn
      ctx.strokeStyle = "rgba(255,122,24,.85)";
      ctx.lineWidth = 2;
      ctx.strokeRect(piece.x * CELL + 1, piece.y * CELL + 1, CELL - 2, CELL - 2);
      ctx.lineWidth = 1;
    }
  }

  function drawNext() {
    nctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (nextId == null || !img) return;

    const t = tiles[nextId];
    // fit center
    const size = Math.min(nextCanvas.width, nextCanvas.height) - 16;
    const dx = (nextCanvas.width - size) / 2;
    const dy = (nextCanvas.height - size) / 2;

    nctx.drawImage(img, t.sx, t.sy, t.sw, t.sh, dx, dy, size, size);
    nctx.strokeStyle = "rgba(0,0,0,.25)";
    nctx.strokeRect(dx + 0.5, dy + 0.5, size - 1, size - 1);
  }

  // ----- Placement actions -----
  function spawnNext() {
    piece.y = 0;
    piece.x = clamp(piece.x, 0, COLS - 1);

    piece.id = nextId;
    nextId = bag.pop() ?? null;
    drawNext();
  }

  // Space / click: place or swap
  function placeOrSwap() {
    if (!running) return;
    if (piece.id == null) return;

    const cur = board[piece.y][piece.x];
    board[piece.y][piece.x] = piece.id;

    // swap: nếu ô đã có mảnh => mảnh đó trở thành "mảnh đang cầm"
    piece.id = cur;

    updateProgress();
    draw();

    // nếu sau swap mà không còn mảnh trên tay (cur=null) => spawn next từ bag
    if (piece.id == null) {
      if (nextId != null || bag.length > 0) {
        spawnNext();
      } else {
        // hết bag và không còn mảnh trên tay: vẫn cho phép sửa bằng phím X (pick up)
        statusEl.textContent = "Đã hết mảnh. Bạn có thể nhấn X để nhấc một mảnh lên và đổi chỗ.";
      }
    }
  }

  // X: pick up tile at cursor (để sửa khi hết mảnh hoặc muốn đổi)
  function pickUpAtCursor() {
    if (!running) return;
    if (piece.id != null) return; // đang cầm mảnh rồi thì không nhấc
    const cur = board[piece.y][piece.x];
    if (cur == null) return;
    board[piece.y][piece.x] = null;
    piece.id = cur;
    updateProgress();
    draw();
  }

  // ----- Timer & Loop -----
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
  function stepUpWrap() {
    piece.y--;
    if (piece.y < 0) piece.y = ROWS - 1;
  }

  function loop(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;

    const speed = softDropping ? G.softDropMs : tickMs;
    fallAccum += dt;
    while (fallAccum >= speed) {
      fallAccum -= speed;
      stepDownWrap();
    }
    draw();
    requestAnimationFrame(loop);
  }

  // ----- Finish / Reward -----
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

  function randDigit() {
    return String(Math.floor(Math.random() * 10));
  }
  function randTwo() {
    return pad2(Math.floor(Math.random() * 100));
  }

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

  // ----- Controls -----
  function move(dx) {
    piece.x = clamp(piece.x + dx, 0, COLS - 1);
    draw();
  }

  window.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space", "KeyX"].includes(e.code)) e.preventDefault();

    if (e.code === "ArrowLeft") move(-1);
    if (e.code === "ArrowRight") move(1);
    if (e.code === "ArrowUp") { if (running) { stepUpWrap(); draw(); } }
    if (e.code === "Space") placeOrSwap();
    if (e.code === "KeyX") pickUpAtCursor();

    if (e.code === "ArrowDown") softDropping = true;
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowDown") softDropping = false;
  });

  // Click support (dễ chơi hơn)
  canvas.addEventListener("click", () => placeOrSwap());
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    pickUpAtCursor();
  });

  // Mobile pad (nếu có)
  document.querySelectorAll(".btnPad").forEach((btn) => {
    const act = btn.getAttribute("data-act");
    btn.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        if (act === "left") move(-1);
        if (act === "right") move(1);
        if (act === "rot") { if (running) { stepUpWrap(); draw(); } }     // dùng nút ↑ như "lên"
        if (act === "down") softDropping = true;
        if (act === "drop") placeOrSwap();                                // dùng nút THẢ = đặt
      },
      { passive: false }
    );
    btn.addEventListener("touchend", () => {
      if (act === "down") softDropping = false;
    });
  });

  // ----- Ref modal flow -----
  function openRef() {
    modalRef.classList.add("show");
  }
  btnShowRef.onclick = openRef;
  btnCloseRef.onclick = () => modalRef.classList.remove("show");

  btnIRemember.onclick = () => {
    modalRef.classList.remove("show");
    if (!started) {
      running = true;
      started = true;
      statusEl.textContent = "Đang chơi... (Space để đặt • X để nhấc mảnh)";
      startTimer();
      requestAnimationFrame(loop);
    }
  };

  btnStart.onclick = () => {
    if (!started) openRef();
  };

  btnRestart.onclick = () => {
    modalRef.classList.remove("show");
    modalResult.classList.remove("show");
    modalMirror.classList.remove("show");
    if (timerHandle) clearInterval(timerHandle);
    resetGame();
    openRef();
  };

  btnMirrorCancel.onclick = () => modalMirror.classList.remove("show");

  // ----- Init -----
  (async function init() {
    try {
      statusEl.textContent = "Đang tải ảnh thành phố...";
      refImgEl.src = dc.img;

      // NOTE: Ảnh phải host cùng domain (GitHub Pages ok). Nếu nhúng ảnh ngoài domain có thể bị CORS.
      img = await loadImage(dc.img);
      tiles = buildTiles(img);

      resetGame();
      openRef();
      statusEl.textContent = "Xem tranh gốc, bấm 'Tôi đã nhớ' để bắt đầu.";
    } catch (err) {
      console.error(err);
      statusEl.textContent =
        "Lỗi tải ảnh. Hãy chắc chắn assets/dayX.jpg đúng đường dẫn và ảnh không bị chặn CORS.";
      alert("Lỗi: " + err.message);
    }
  })();
})();