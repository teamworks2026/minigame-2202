// js/play.js — FINAL Puzzle + Day Lock + Form Gate
(() => {
  const $ = (id) => document.getElementById(id);
  const pad2 = (n) => (n < 10 ? "0" + n : "" + n);

  // dọn các fx overlay cũ nếu có
  (function killFxLoop(){
    const kill = () => {
      document.querySelectorAll(".glow,.fxGlow,.touchGlow,.ripple,.tapFx,.pointerFx,[data-fx],[data-ripple]")
        .forEach(el => el.remove());
    };
    kill();
    setInterval(kill, 800);
  })();

  // ===== helpers =====
  function shuffle(arr){
    for (let i = arr.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function parseDayFromUrl(){
    const u = new URL(location.href);
    const q = u.searchParams.get("day");
    if (q && ["1","2","3"].includes(q)) return Number(q);
    return Config.getTodayEventDay();
  }
  function safeEl(id){
    const el = $(id);
    if (!el) throw new Error(`Thiếu element #${id} trong play.html`);
    return el;
  }

  // ===== init =====
  Storage.ensureProfile?.();

  const day = parseDayFromUrl();
  const dc = Config.getDayConfig(day);
  if (!dc) { location.href = "index.html"; return; }

  const G = Config.GAME;
  const COLS = G.cols, ROWS = G.rows;
  const TOTAL = COLS * ROWS;
  const PASS = G.passThreshold ?? 80;

  // ===== DOM =====
  safeEl("sceneTitle").textContent = dc.title;

  const boardEl = safeEl("board");
  const timeEl = safeEl("timeLeft");
  const progEl = safeEl("progress");
  const statusEl = safeEl("status");

  const btnShowRef = safeEl("btnShowRef");
  const btnStart = safeEl("btnStart");
  const btnShuffle = safeEl("btnShuffle");
  const btnRestart = safeEl("btnRestart");

  const modalRef = safeEl("modalRef");
  const refImgEl = safeEl("refImg");
  const btnIRemember = safeEl("btnIRemember");
  const btnCloseRef = safeEl("btnCloseRef");

  const modalResult = safeEl("modalResult");
  const resultTitle = safeEl("resultTitle");
  const resultText = safeEl("resultText");
  const resultActions = safeEl("resultActions");

  const modalMirror = safeEl("modalMirror");
  const mirrorGrid = safeEl("mirrorGrid");
  const btnMirrorCancel = safeEl("btnMirrorCancel");

  // ===== state =====
  let img = null;
  let started = false;
  let running = false;
  let doneReward = false;

  let timer = G.seconds;
  let timerHandle = null;

  let tilesByPos = [];
  let selectedPos = null;

  const dragEnabled = true;
  let suppressClickUntil = 0;

  // ===== UI =====
  function openRef(){ modalRef.classList.add("show"); }
  function closeRef(){ modalRef.classList.remove("show"); }

  function showResult(title, html, actions){
    modalResult.classList.add("show");
    resultTitle.textContent = title;
    resultText.innerHTML = html;
    resultActions.innerHTML = "";
    (actions||[]).forEach(a=>{
      const b = document.createElement("button");
      b.className = a.cls;
      b.textContent = a.text;
      b.onclick = a.onClick;
      resultActions.appendChild(b);
    });
  }

  function setBoardEnabled(on){
    boardEl.classList.toggle("disabled", !on);
    boardEl.style.pointerEvents = on ? "auto" : "none";
  }

  function tileBgStyle(tileId){
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
      backgroundRepeat: "no-repeat",
    };
  }

  function computeProgress(){
    let correct = 0;
    for (let pos=0; pos<TOTAL; pos++){
      if (tilesByPos[pos] === pos) correct++;
    }
    return Math.round((correct / TOTAL) * 100);
  }
  function updateProgress(){ progEl.textContent = computeProgress() + "%"; }

  function getTileEl(pos){
    return boardEl.querySelector(`.puzTile[data-pos="${pos}"]`);
  }
  function updateTileEl(pos){
    const el = getTileEl(pos);
    if (!el) return;
    Object.assign(el.style, tileBgStyle(tilesByPos[pos]));
  }
  function flash(el){
     return;
  }

  function swapPos(a,b){
    if (a==null || b==null || a===b) return;
    [tilesByPos[a], tilesByPos[b]] = [tilesByPos[b], tilesByPos[a]];
    updateTileEl(a); updateTileEl(b);
    flash(getTileEl(a)); flash(getTileEl(b));
    updateProgress();
    if (computeProgress() === 100 && !doneReward) finishGame("win");
  }

  function highlightSelected(pos,on){
    const el = getTileEl(pos);
    if (!el) return;
    el.classList.toggle("selected", on);
  }

  function resetPuzzle(doShuffle=true){
    tilesByPos = Array.from({length:TOTAL},(_,i)=>i);
    if (doShuffle) shuffle(tilesByPos);
    selectedPos = null;
    renderBoard();
    updateProgress();
  }

  function renderBoard(){
    boardEl.innerHTML = "";
    boardEl.classList.add("puzzleBoard");
    boardEl.style.display = "grid";
    boardEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
    boardEl.style.gap = "8px";

    for (let pos=0; pos<TOTAL; pos++){
      const cell = document.createElement("div");
      cell.className = "puzTile";
      cell.dataset.pos = String(pos);
      Object.assign(cell.style, tileBgStyle(tilesByPos[pos]));
      cell.addEventListener("pointerdown", onPointerDown, { passive:false });
      cell.addEventListener("click", onTapSwap);
      boardEl.appendChild(cell);
    }
  }

  // tap swap fallback
  function onTapSwap(e){
    if (!running) return;
    if (Date.now() < suppressClickUntil) return;

    const pos = Number(e.currentTarget.dataset.pos);
    if (selectedPos == null){
      selectedPos = pos;
      highlightSelected(pos, true);
      return;
    }
    const a = selectedPos;
    highlightSelected(a,false);
    selectedPos = null;
    swapPos(a, pos);
  }

  // drag swap
  let dragging = null;
  function clearDropTargets(){
    boardEl.querySelectorAll(".puzTile.dropTarget").forEach(el => el.classList.remove("dropTarget"));
  }
  function onPointerDown(e){
    if (!running || !dragEnabled) return;
    e.preventDefault();

    const fromPos = Number(e.currentTarget.dataset.pos);
    const fromEl = e.currentTarget;

    dragging = { fromPos, el: fromEl };
    fromEl.classList.add("dragging");
    fromEl.setPointerCapture?.(e.pointerId);

    const move = (ev) => {
      if (!dragging) return;
      const pointEl = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = pointEl?.closest?.(".puzTile");
      clearDropTargets();
      if (target && target !== dragging.el) target.classList.add("dropTarget");
    };

    const up = (ev) => {
      if (!dragging) return;
      const pointEl = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = pointEl?.closest?.(".puzTile");
      const toPos = target ? Number(target.dataset.pos) : null;

      dragging.el.classList.remove("dragging");
      clearDropTargets();

      const a = dragging.fromPos;
      dragging = null;

      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);

      if (toPos != null){
        swapPos(a, toPos);
        suppressClickUntil = Date.now() + 250;
      }
    };

    window.addEventListener("pointermove", move, { passive:true });
    window.addEventListener("pointerup", up, { passive:true });
  }

  // timer
  function startTimer(){
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      if (!running) return;
      timer = Math.max(0, timer - 1);
      const m = Math.floor(timer/60);
      const s = timer%60;
      timeEl.textContent = `${pad2(m)}:${pad2(s)}`;
      if (timer <= 0){
        clearInterval(timerHandle);
        finishGame("timeout");
      }
    }, 1000);
  }

  // ===== GATE (LOCK BY DATE) =====
  function startLockScreen(gate){
    setBoardEnabled(false);
    running = false;
    started = false;

    const openDate = dc.OPEN_DATE;
    const back = { text:"Về trang chính", cls:"btnGhost", onClick:()=>location.href="index.html" };

    if (gate.reason === "EXPIRED") {
      showResult(
        "Ngày này đã khóa",
        `Hôm nay <b>không phải</b> ngày mở của <b>Day ${day}</b>.<br/>Day này chỉ mở vào: <b>${openDate}</b> (giờ VN).`,
        [back]
      );
      return;
    }

    // NOT_YET: countdown
    const boxId = "countdownBox";
    showResult(
      "Chưa mở",
      `Day ${day} sẽ mở vào <b>${openDate}</b> (00:00 giờ VN).<br/>
       <div id="${boxId}" style="margin-top:10px;font-weight:800;font-size:18px;">Đang tính…</div>`,
      [back]
    );

    const tick = () => {
      const ms = Math.max(0, gate.openMs - Date.now());
      const sec = Math.floor(ms/1000);
      const hh = Math.floor(sec/3600);
      const mm = Math.floor((sec%3600)/60);
      const ss = sec%60;
      const el = document.getElementById(boxId);
      if (!el) return;
      el.textContent = `Còn ${pad2(hh)}:${pad2(mm)}:${pad2(ss)} để mở`;
      if (ms <= 0) {
        el.textContent = "Đã đến giờ! F5/Refresh để vào chơi.";
      }
    };
    tick();
    setInterval(tick, 1000);
  }

  // ===== Reward + Submit (Form gate nằm trong Config.buildSubmitUrl) =====
  function randDigit(){ return String(Math.floor(Math.random()*10)); }
  function randTwo(){ return pad2(Math.floor(Math.random()*100)); }

  function showMirror(accuracy, timeUsed){
    modalMirror.classList.add("show");
    mirrorGrid.innerHTML = "";

    const correct = dc.reward;
    const decoys = [];
    while (decoys.length < 2){
      const d = correct.length === 2 ? randTwo() : randDigit();
      if (d !== correct && !decoys.includes(d)) decoys.push(d);
    }
    const options = shuffle([correct, decoys[0], decoys[1]]);
    const correctIndex = options.indexOf(correct);

    options.forEach((_, idx) => {
      const card = document.createElement("div");
      card.className = "mirror";
      card.innerHTML = `<div class="mirrorTitle">Gương ${idx+1}</div><div class="mirrorSub">Chạm để chọn</div>`;
      card.onclick = () => {
        modalMirror.classList.remove("show");
        if (idx === correctIndex){
          doneReward = true;
          giveReward(correct, accuracy, timeUsed, false);
        } else {
          showResult(
            "Sai gương rồi!",
            `Gương bạn chọn không có số đúng. Hãy chơi lại nhé.<br/>Tiến độ đúng: <b>${accuracy}%</b>`,
            [
              { text:"Chơi lại", cls:"btn", onClick:()=>{ modalResult.classList.remove("show"); restartAll(); } },
              { text:"Về trang chính", cls:"btnGhost", onClick:()=>location.href="index.html" }
            ]
          );
        }
      };
      mirrorGrid.appendChild(card);
    });
  }

  function giveReward(rewardStr, accuracy, timeUsed, directWin){
    Storage.setDigit?.(day, rewardStr);

    const digits = Storage.getDigits?.() || {};
    const code = Storage.getFinalCode?.() || "";
    const profile = Storage.getProfile?.() || { id:"", name:"" };

    const payload = {
      id: profile.id,
      name: profile.name || "",
      code,
      d1: digits["1"] || "",
      d2: digits["2"] || "",
      d3: digits["3"] || "",
      day,
      accuracy,
      timeUsed
    };

    const url = Config.buildSubmitUrl(payload);

    const msg = directWin
      ? `Bạn đã ghép đúng <b>100%</b>! Nhận số: <b>${rewardStr}</b><br/>Mã hiện tại: <b>${code}</b>`
      : `Bạn đã chọn đúng gương! Nhận số: <b>${rewardStr}</b><br/>Mã hiện tại: <b>${code}</b>`;

    const actions = [];
    if (url){
      actions.push({ text:"Gửi kết quả (Google Form)", cls:"btn", onClick:()=>window.open(url,"_blank","noopener,noreferrer") });
    } else {
      actions.push({ text:"Form đang khóa / chưa cấu hình", cls:"btnGhost", onClick:()=>{} });
    }
    actions.push({ text:"Về trang chính", cls:"btnGhost", onClick:()=>location.href="index.html" });

    showResult("Chúc mừng!", msg, actions);
  }

  function finishGame(reason){
    if (doneReward) return;
    running = false;

    const accuracy = computeProgress();
    const timeUsed = G.seconds - timer;

    if (reason === "win"){
      doneReward = true;
      giveReward(dc.reward, accuracy, timeUsed, true);
      return;
    }

    if (timer <= 0 && accuracy >= PASS){
      showMirror(accuracy, timeUsed);
      return;
    }

    showResult(
      "Chưa đạt",
      `Tiến độ đúng: <b>${accuracy}%</b> • Bạn cần <b>100%</b> (hoặc ≥ <b>${PASS}%</b> khi hết giờ để mở gương).`,
      [
        { text:"Chơi lại", cls:"btn", onClick:()=>{ modalResult.classList.remove("show"); restartAll(); } },
        { text:"Về trang chính", cls:"btnGhost", onClick:()=>location.href="index.html" }
      ]
    );
  }

  function restartAll(){
    doneReward = false;
    started = false;
    running = false;
    timer = G.seconds;
    if (timerHandle) clearInterval(timerHandle);

    timeEl.textContent = `${pad2(Math.floor(timer/60))}:${pad2(timer%60)}`;
    setBoardEnabled(false);
    resetPuzzle(true);

    openRef();
    statusEl.textContent = "Xem tranh gốc, bấm “Tôi đã nhớ” để bắt đầu.";
  }

  // buttons
  btnShowRef.onclick = openRef;
  btnStart.onclick = openRef;
  btnCloseRef.onclick = closeRef;

  btnIRemember.onclick = () => {
    // gate check lại khi bấm “Tôi đã nhớ”
    const gate = Config.getGateStatus(day);
    if (!gate.ok) { closeRef(); startLockScreen(gate); return; }

    closeRef();
    if (!started){
      started = true;
      running = true;
      timer = G.seconds;
      timeEl.textContent = `${pad2(Math.floor(timer/60))}:${pad2(timer%60)}`;
      setBoardEnabled(true);
      startTimer();
      statusEl.textContent = "Đang chơi... Kéo-thả để đổi chỗ (swap).";
    }
  };

  btnShuffle.onclick = () => {
    if (!started) return;
    resetPuzzle(true);
    statusEl.textContent = "Đã trộn lại!";
  };

  btnRestart.onclick = restartAll;
  btnMirrorCancel.onclick = () => modalMirror.classList.remove("show");

  // start
  (async function init(){
    refImgEl.src = dc.img;

    // gate check ngay lúc vào trang
    const gate = Config.getGateStatus(day);

    img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Không load được ảnh: " + dc.img));
      im.src = dc.img;
    });

    setBoardEnabled(false);
    resetPuzzle(true);

    timeEl.textContent = `${pad2(Math.floor(G.seconds/60))}:${pad2(G.seconds%60)}`;

    openRef();
    statusEl.textContent = "Xem tranh gốc, bấm “Tôi đã nhớ” để bắt đầu.";

    if (!gate.ok) {
      // cho xem tranh gốc nhưng khóa gameplay
      // khi bấm “Tôi đã nhớ” sẽ hiện lock screen
      // (còn nếu muốn hiện lock ngay từ đầu, mở dòng dưới)
      // startLockScreen(gate);
    }
  })().catch(err => {
    console.error(err);
    alert(err.message);
  });
})();