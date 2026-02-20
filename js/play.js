// js/play.js — Simple Puzzle Swap (drag/tap)
(() => {
  Storage.ensureProfile();
  const $ = (id) => document.getElementById(id);
  const pad2 = (n) => (n < 10 ? "0" + n : "" + n);

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

  const day = parseDayFromUrl();
  const dc = Config.getDayConfig(day);
  if (!dc) return (location.href = "index.html");
  $("sceneTitle").textContent = dc.title;

  const G = Config.GAME;
  const COLS = G.cols;
  const ROWS = G.rows;
  const TOTAL = COLS * ROWS;

  const boardEl = $("board");
  const timeEl = $("timeLeft");
  const progEl = $("progress");
  const statusEl = $("status");

  const btnShowRef = $("btnShowRef");
  const btnStart = $("btnStart");
  const btnShuffle = $("btnShuffle");
  const btnRestart = $("btnRestart");

  const modalRef = $("modalRef");
  const refImgEl = $("refImg");
  const btnIRemember = $("btnIRemember");
  const btnCloseRef = $("btnCloseRef");

  const modalResult = $("modalResult");
  const resultTitle = $("resultTitle");
  const resultText = $("resultText");
  const resultActions = $("resultActions");

  const modalMirror = $("modalMirror");
  const mirrorGrid = $("mirrorGrid");
  const btnMirrorCancel = $("btnMirrorCancel");

  const toggleDrag = $("toggleDrag");
  const K_DRAG = "cgp_puzzle_drag";
  let dragEnabled = (localStorage.getItem(K_DRAG) ?? "1") === "1";
  toggleDrag.checked = dragEnabled;

  let img = null;
  let started = false;
  let running = false;
  let doneReward = false;

  let timer = G.seconds;
  let timerHandle = null;

  // tilesByPos[pos] = tileId (tileId is the correct piece index)
  let tilesByPos = [];
  let selectedPos = null;

  function openRef() { modalRef.classList.add("show"); }
  function closeRef() { modalRef.classList.remove("show"); }

  function setBoardEnabled(on) {
    boardEl.classList.toggle("disabled", !on);
    boardEl.style.pointerEvents = on ? "auto" : "none";
  }

  function buildBoardAspect() {
    // keep same aspect ratio as image
    if (img?.naturalWidth && img?.naturalHeight) {
      boardEl.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    }
  }

  function tileBgStyle(tileId) {
    const tx = tileId % COLS;
    const ty = Math.floor(tileId / COLS);

    const sizeX = COLS * 100;
    const sizeY = ROWS * 100;

    const px = (COLS === 1) ? 0 : (tx / (COLS - 1)) * 100;
    const py = (ROWS === 1) ? 0 : (ty / (ROWS - 1)) * 100;

    return {
      backgroundImage: `url(${dc.img})`,
      backgroundSize: `${sizeX}% ${sizeY}%`,
      backgroundPosition: `${px}% ${py}%`,
    };
  }

  function renderBoard() {
    boardEl.innerHTML = "";
    boardEl.style.display = "grid";
    boardEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
    boardEl.style.gap = "6px";
    boardEl.style.touchAction = "none";

    for (let pos = 0; pos < TOTAL; pos++) {
      const tileId = tilesByPos[pos];
      const cell = document.createElement("div");
      cell.className = "puzTile";
      cell.dataset.pos = String(pos);
      cell.dataset.tile = String(tileId);

      const s = tileBgStyle(tileId);
      Object.assign(cell.style, s);

      cell.addEventListener("pointerdown", onPointerDown, { passive: false });
      cell.addEventListener("click", onTapSwap);

      boardEl.appendChild(cell);
    }
    updateProgress();
  }

  function updateTileEl(pos) {
    const el = boardEl.querySelector(`.puzTile[data-pos="${pos}"]`);
    if (!el) return;
    const tileId = tilesByPos[pos];
    el.dataset.tile = String(tileId);
    const s = tileBgStyle(tileId);
    Object.assign(el.style, s);
  }

  function swapPos(a, b) {
    if (a == null || b == null || a === b) return;
    [tilesByPos[a], tilesByPos[b]] = [tilesByPos[b], tilesByPos[a]];
    updateTileEl(a);
    updateTileEl(b);
    updateProgress();
    if (computeProgress() === 100 && !doneReward) finishGame("win");
  }

  function computeProgress() {
    let correct = 0;
    for (let pos = 0; pos < TOTAL; pos++) {
      if (tilesByPos[pos] === pos) correct++;
    }
    return Math.round((correct / TOTAL) * 100);
  }

  function updateProgress() {
    const p = computeProgress();
    progEl.textContent = p + "%";
  }

  function resetPuzzle(shuffleIt = true) {
    tilesByPos = Array.from({ length: TOTAL }, (_, i) => i);
    if (shuffleIt) shuffle(tilesByPos);
    selectedPos = null;
    renderBoard();
  }

  // ===== Tap-to-swap (always works on mobile) =====
  function onTapSwap(e) {
    if (!running) return;
    if (dragEnabled) return; // khi bật kéo-thả, ưu tiên drag, tap vẫn ok nhưng mình khóa để tránh double
    const pos = Number(e.currentTarget.dataset.pos);

    // select first
    if (selectedPos == null) {
      selectedPos = pos;
      highlightSelected(pos, true);
      return;
    }

    // swap
    const a = selectedPos;
    highlightSelected(a, false);
    selectedPos = null;
    swapPos(a, pos);
  }

  function highlightSelected(pos, on) {
    const el = boardEl.querySelector(`.puzTile[data-pos="${pos}"]`);
    if (!el) return;
    el.classList.toggle("selected", on);
  }

  // ===== Drag-to-swap (pointer events) =====
  let dragging = null; // {fromPos, moved}
  function onPointerDown(e) {
    if (!running || !dragEnabled) return;
    e.preventDefault();

    const fromPos = Number(e.currentTarget.dataset.pos);
    dragging = { fromPos, moved: false };

    boardEl.setPointerCapture?.(e.pointerId);

    const move = (ev) => {
      if (!dragging) return;
      dragging.moved = true;
    };

    const up = (ev) => {
      if (!dragging) return;
      const pointEl = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = pointEl?.closest?.(".puzTile");
      const toPos = target ? Number(target.dataset.pos) : null;
      const a = dragging.fromPos;
      dragging = null;

      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);

      if (toPos != null) swapPos(a, toPos);
    };

    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
  }

  // ===== Timer =====
  function startTimer() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      if (!running) return;
      timer = Math.max(0, timer - 1);
      const m = Math.floor(timer / 60);
      const s = timer % 60;
      timeEl.textContent = `${pad2(m)}:${pad2(s)}`;

      if (timer <= 0) {
        clearInterval(timerHandle);
        finishGame("timeout");
      }
    }, 1000);
  }

  // ===== Result / Mirror / Reward =====
  function showResult(title, html, actions) {
    modalResult.classList.add("show");
    resultTitle.textContent = title;
    resultText.innerHTML = html;
    resultActions.innerHTML = "";

    (actions || []).forEach((a) => {
      const b = document.createElement("button");
      b.className = a.cls;
      b.textContent = a.text;
      b.onclick = a.onClick;
      resultActions.appendChild(b);
    });
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
      card.innerHTML = `<div class="mirrorTitle">Gương ${idx + 1}</div><div class="mirrorSub">Chạm để chọn</div>`;
      card.onclick = () => {
        modalMirror.classList.remove("show");
        if (idx === correctIndex) {
          doneReward = true;
          giveReward(correct, accuracy, timeUsed, false);
        } else {
          showResult("Sai gương rồi!",
            `Gương bạn chọn không có số đúng. Hãy chơi lại để thử tiếp.<br/>Tiến độ đúng: <b>${accuracy}%</b>`,
            [
              { text: "Chơi lại", cls: "btn", onClick: () => { modalResult.classList.remove("show"); restartAll(); } },
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

    if (timer <= 0 && accuracy >= (G.passThreshold ?? 80)) {
      showMirror(accuracy, timeUsed);
      return;
    }

    showResult("Chưa đạt",
      `Tiến độ đúng: <b>${accuracy}%</b> • Bạn cần <b>100%</b> (hoặc ≥ <b>${G.passThreshold ?? 80}%</b> khi hết giờ để mở gương).`,
      [
        { text: "Chơi lại", cls: "btn", onClick: () => { modalResult.classList.remove("show"); restartAll(); } },
        { text: "Về trang chính", cls: "btnGhost", onClick: () => (location.href = "index.html") },
      ]
    );
  }

  function restartAll() {
    doneReward = false;
    started = false;
    running = false;
    timer = G.seconds;
    timeEl.textContent = "01:30";
    if (timerHandle) clearInterval(timerHandle);
    setBoardEnabled(false);
    resetPuzzle(true);
    openRef();
    statusEl.textContent = "Xem tranh gốc, bấm “Tôi đã nhớ” để bắt đầu.";
  }

  // ===== UI events =====
  btnShowRef.onclick = openRef;
  btnCloseRef.onclick = closeRef;

  btnStart.onclick = () => openRef();

  btnIRemember.onclick = () => {
    closeRef();
    if (!started) {
      started = true;
      running = true;
      timer = G.seconds;
      setBoardEnabled(true);
      startTimer();
      statusEl.textContent = dragEnabled
        ? "Đang chơi... Kéo-thả để đổi chỗ (swap)."
        : "Đang chơi... Chạm 2 mảnh để đổi chỗ.";
    }
  };

  btnShuffle.onclick = () => {
    if (!started) return; // trộn khi đang chơi
    resetPuzzle(true);
    statusEl.textContent = "Đã trộn lại!";
  };

  btnRestart.onclick = restartAll;

  toggleDrag.addEventListener("change", () => {
    dragEnabled = !!toggleDrag.checked;
    localStorage.setItem(K_DRAG, dragEnabled ? "1" : "0");
    statusEl.textContent = dragEnabled
      ? "Kéo-thả đang BẬT: kéo mảnh để đổi chỗ (swap)."
      : "Kéo-thả đang TẮT: chạm 2 mảnh để đổi chỗ.";
  });

  btnMirrorCancel.onclick = () => modalMirror.classList.remove("show");

  // ===== init =====
  (async function init() {
    refImgEl.src = dc.img;
    // preload image to get aspect ratio
    img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Không load được ảnh: " + dc.img));
      im.src = dc.img;
    });

    buildBoardAspect();
    setBoardEnabled(false);
    resetPuzzle(true);
    openRef();
  })().catch((err) => {
    console.error(err);
    alert(err.message);
  });
})();