// js/play.js
(() => {
  Storage.ensureProfile();

  // ----- helpers -----
  const $ = (id) => document.getElementById(id);
  const clamp = (n,a,b)=> Math.max(a, Math.min(b,n));
  const pad2 = (n)=> (n<10?("0"+n):(""+n));

  function parseDayFromUrl(){
    const u = new URL(location.href);
    const q = u.searchParams.get("day");
    if(q && ["1","2","3"].includes(q)) return Number(q);
    // nếu không có, tự suy ra theo mốc event
    const auto = Config.getTodayEventDay();
    return auto || 1; // nếu ngoài event thì mặc định day 1 để test
  }

  function shuffle(arr){
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]] = [arr[j],arr[i]];
    }
    return arr;
  }

  function rgbKey(r,g,b){ return `${r},${g},${b}`; }

  // ----- config/day -----
  const day = parseDayFromUrl();
  const dc = Config.getDayConfig(day);
  if(!dc){
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
  const btnBackHome = $("btnBackHome");
  const btnRetry = $("btnRetry");

  const mirrorGrid = $("mirrorGrid");
  const btnMirrorCancel = $("btnMirrorCancel");

  // ----- Game state -----
  const G = Config.GAME;
  const COLS = G.cols;
  const ROWS = G.rows;
  const CELL = Math.floor(Math.min(canvas.width / COLS, canvas.height / ROWS));
  // fit canvas to grid nicely
  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;

  let target = null;  // 2D array [r][c] => "r,g,b"
  let board = null;   // 2D array [r][c] => key or null
  let bag = [];       // colors for pieces (each cell appears once)
  let piece = null;
  let nextPiece = null;

  let running = false;
  let started = false;
  let timer = G.seconds;
  let tickMs = G.tickMs;
  let fallAccum = 0;
  let lastTs = 0;

  let softDropping = false;
  let doneReward = false;

  // ----- Piece: domino (2 cells), rotatable -----
  function makePieceFromBag(){
    if(bag.length < 2) return null;
    const c1 = bag.pop();
    const c2 = bag.pop();
    return {
      x: Math.floor(COLS/2)-1,
      y: 0,
      rot: 0, // 0 = ngang, 1 = dọc
      a: c1,
      b: c2
    };
  }

  function cellsOf(p){
    // returns [{x,y,colorKey}, ...]
    if(p.rot === 0){
      return [
        {x:p.x,   y:p.y,   k:p.a},
        {x:p.x+1, y:p.y,   k:p.b},
      ];
    }
    return [
      {x:p.x, y:p.y,   k:p.a},
      {x:p.x, y:p.y+1, k:p.b},
    ];
  }

  function collides(p){
    const cells = cellsOf(p);
    for(const c of cells){
      if(c.x < 0 || c.x >= COLS || c.y < 0 || c.y >= ROWS) return true;
      if(board[c.y][c.x]) return true;
    }
    return false;
  }

  function lockPiece(p){
    for(const c of cellsOf(p)){
      if(c.y>=0 && c.y<ROWS && c.x>=0 && c.x<COLS){
        board[c.y][c.x] = c.k;
      }
    }
  }

  function hardDrop(){
    if(!running) return;
    let p = {...piece};
    while(true){
      const np = {...p, y:p.y+1};
      if(collides(np)) break;
      p = np;
    }
    piece = p;
    lockAndNext();
  }

  function rotate(){
    if(!running) return;
    const np = {...piece, rot: piece.rot ? 0 : 1};
    // thử kick nhẹ
    const kicks = [
      {x:0,y:0},{x:-1,y:0},{x:1,y:0},{x:0,y:-1}
    ];
    for(const k of kicks){
      const test = {...np, x: np.x + k.x, y: np.y + k.y};
      if(!collides(test)){
        piece = test;
        return;
      }
    }
  }

  function move(dx){
    if(!running) return;
    const np = {...piece, x: piece.x + dx};
    if(!collides(np)) piece = np;
  }

  function stepDown(){
    if(!running) return;
    const np = {...piece, y: piece.y + 1};
    if(!collides(np)){
      piece = np;
    }else{
      lockAndNext();
    }
  }

  function lockAndNext(){
    lockPiece(piece);
    updateProgress();

    // nếu đầy board hoặc hết bag => kết thúc (có thể chưa 100%)
    if(isBoardFull() || bag.length < 2){
      finishGame("filled");
      return;
    }

    piece = nextPiece || makePieceFromBag();
    nextPiece = makePieceFromBag();

    // spawn collision => game over
    if(!piece || collides(piece)){
      finishGame("over");
      return;
    }
    drawNext();
  }

  function isBoardFull(){
    for(let r=0;r<ROWS;r++){
      for(let c=0;c<COLS;c++){
        if(!board[r][c]) return false;
      }
    }
    return true;
  }

  // ----- Target image -> grid -----
  async function loadTargetFromImage(url){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // vẽ về canvas nhỏ COLSxROWS để lấy màu
        const oc = document.createElement("canvas");
        oc.width = COLS;
        oc.height = ROWS;
        const octx = oc.getContext("2d", {willReadFrequently:true});
        octx.drawImage(img, 0, 0, COLS, ROWS);
        const data = octx.getImageData(0,0,COLS,ROWS).data;

        const t = [];
        let i=0;
        for(let y=0;y<ROWS;y++){
          const row=[];
          for(let x=0;x<COLS;x++){
            const r=data[i++], g=data[i++], b=data[i++], a=data[i++];
            // làm "màu gọn" (quantize) để nhìn đẹp & dễ match
            const q = (v)=> Math.round(v/16)*16;
            row.push(rgbKey(q(r),q(g),q(b)));
          }
          t.push(row);
        }
        resolve({img, t});
      };
      img.onerror = () => reject(new Error("Không load được ảnh: " + url));
      img.src = url;
    });
  }

  function buildBagFromTarget(t){
    const arr = [];
    for(let y=0;y<ROWS;y++){
      for(let x=0;x<COLS;x++){
        arr.push(t[y][x]);
      }
    }
    // cần số chẵn để bốc 2 ô / miếng
    if(arr.length % 2 === 1) arr.pop();
    shuffle(arr);
    return arr;
  }

  // ----- Render -----
  function clear(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
  }

  function drawCell(x,y,key, alpha=1){
    const [r,g,b] = key.split(",").map(Number);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x*CELL, y*CELL, CELL, CELL);
    ctx.globalAlpha = 1;

    // viền nhẹ
    ctx.strokeStyle = "rgba(0,0,0,.22)";
    ctx.strokeRect(x*CELL+0.5, y*CELL+0.5, CELL-1, CELL-1);
  }

  function drawBoard(){
    // nền lưới
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // cells đã lock
    for(let y=0;y<ROWS;y++){
      for(let x=0;x<COLS;x++){
        const k = board[y][x];
        if(k) drawCell(x,y,k,1);
        else{
          // ô trống
          ctx.strokeStyle = "rgba(255,255,255,.05)";
          ctx.strokeRect(x*CELL+0.5, y*CELL+0.5, CELL-1, CELL-1);
        }
      }
    }

    // piece đang rơi
    if(piece){
      for(const c of cellsOf(piece)){
        if(c.y>=0) drawCell(c.x,c.y,c.k,1);
      }
    }
  }

  function drawNext(){
    nctx.clearRect(0,0,nextCanvas.width,nextCanvas.height);
    if(!nextPiece) return;

    // vẽ miếng next ở giữa
    const box = 4; // grid 4x4
    const cell = Math.floor(nextCanvas.width / box);
    const draw = (gx,gy,key)=>{
      const [r,g,b]=key.split(",").map(Number);
      nctx.fillStyle = `rgb(${r},${g},${b})`;
      nctx.fillRect(gx*cell, gy*cell, cell, cell);
      nctx.strokeStyle = "rgba(0,0,0,.22)";
      nctx.strokeRect(gx*cell+0.5, gy*cell+0.5, cell-1, cell-1);
    };

    if(nextPiece.rot===0){
      draw(1,2,nextPiece.a);
      draw(2,2,nextPiece.b);
    }else{
      draw(2,1,nextPiece.a);
      draw(2,2,nextPiece.b);
    }
  }

  function updateHUD(){
    const m = Math.floor(timer/60);
    const s = timer%60;
    timeEl.textContent = `${pad2(m)}:${pad2(s)}`;
  }

  function computeProgress(){
    let correct=0;
    const total = ROWS*COLS;
    for(let y=0;y<ROWS;y++){
      for(let x=0;x<COLS;x++){
        const placed = board[y][x];
        if(placed && placed === target[y][x]) correct++;
      }
    }
    return Math.round((correct/total)*100);
  }

  function updateProgress(){
    const p = computeProgress();
    progEl.textContent = p + "%";
    if(p === 100 && !doneReward){
      finishGame("win");
    }
  }

  // ----- Game lifecycle -----
  function resetGame(){
    running = false;
    started = false;
    doneReward = false;
    timer = G.seconds;
    tickMs = G.tickMs;
    fallAccum = 0;
    lastTs = 0;
    softDropping = false;

    board = Array.from({length:ROWS}, ()=> Array.from({length:COLS}, ()=> null));
    bag = buildBagFromTarget(target);

    piece = makePieceFromBag();
    nextPiece = makePieceFromBag();

    if(piece && collides(piece)){
      statusEl.textContent = "Board bị kẹt (ảnh/size lỗi). Hãy đổi ảnh khác.";
      return;
    }
    drawNext();
    updateHUD();
    progEl.textContent = "0%";
    statusEl.textContent = "Sẵn sàng. Bấm Bắt đầu hoặc xem tranh gốc.";
    clear();
    drawBoard();
  }

  function startGame(){
    if(running || !piece) return;
    running = true;
    started = true;
    statusEl.textContent = "Đang chơi...";
    requestAnimationFrame(loop);
  }

  function finishGame(reason){
    if(doneReward) return;
    running = false;

    const accuracy = computeProgress();
    const timeUsed = G.seconds - timer;

    // ghi history
    const profile = Storage.getProfile();
    Storage.addHistory({
      ts: new Date().toISOString(),
      day,
      accuracy,
      timeUsed,
      userId: profile.id,
      name: profile.name || ""
    });

    // WIN 100% => nhận số ngay
    if(reason === "win"){
      doneReward = true;
      giveReward(dc.reward, accuracy, timeUsed, true);
      return;
    }

    // Hết giờ: nếu >=80% => chọn gương
    if(timer <= 0 && accuracy >= G.passThreshold){
      showMirror(accuracy, timeUsed);
      return;
    }

    // Còn lại: fail
    showResult("Chưa đạt", `Tiến độ đúng: ${accuracy}% • Bạn cần 100% (hoặc ≥ ${G.passThreshold}% khi hết giờ để mở gương).`);
  }

  function giveReward(rewardStr, accuracy, timeUsed, directWin){
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
      timeUsed
    };
    const url = Config.buildSubmitUrl(payload);

    const msg = directWin
      ? `Bạn đã hoàn thành <b>100%</b>! Nhận số: <b>${rewardStr}</b><br/>Mã hiện tại: <b>${code}</b>`
      : `Bạn đã chọn đúng gương! Nhận số: <b>${rewardStr}</b><br/>Mã hiện tại: <b>${code}</b>`;

    showResult("Chúc mừng!", msg, [
      {text:"Gửi kết quả (Google Form)", cls:"btn", onClick: ()=> window.open(url, "_blank", "noopener,noreferrer")},
      {text:"Về trang chính", cls:"btnGhost", onClick: ()=> location.href="index.html"}
    ]);
  }

  function showResult(title, html, actions){
    modalResult.classList.add("show");
    resultTitle.textContent = title;
    resultText.innerHTML = html;

    const actWrap = $("resultActions");
    actWrap.innerHTML = "";

    const defaultActions = actions || [
      {text:"Về trang chính", cls:"btn", onClick: ()=> location.href="index.html"},
      {text:"Chơi lại", cls:"btnGhost", onClick: ()=> { modalResult.classList.remove("show"); resetGame(); }}
    ];

    for(const a of defaultActions){
      const b = document.createElement("button");
      b.className = a.cls;
      b.textContent = a.text;
      b.onclick = a.onClick;
      actWrap.appendChild(b);
    }
  }

  function hideAllModals(){
    modalRef.classList.remove("show");
    modalResult.classList.remove("show");
    modalMirror.classList.remove("show");
  }

  function showMirror(accuracy, timeUsed){
    modalMirror.classList.add("show");
    mirrorGrid.innerHTML = "";

    // tạo 3 options: 1 đúng, 2 sai
    const correct = dc.reward;
    const decoys = [];

    function randDigit(){
      return String(Math.floor(Math.random()*10));
    }
    function randTwo(){
      return pad2(Math.floor(Math.random()*100));
    }

    while(decoys.length < 2){
      const d = (correct.length === 2) ? randTwo() : randDigit();
      if(d !== correct && !decoys.includes(d)) decoys.push(d);
    }

    const options = shuffle([correct, decoys[0], decoys[1]]);
    const correctIndex = options.indexOf(correct);

    options.forEach((val, idx) => {
      const card = document.createElement("div");
      card.className = "mirror";
      card.innerHTML = `
        <div class="mirrorTitle">Gương ${idx+1}</div>
        <div class="mirrorSub">Chạm để chọn</div>
      `;
      card.onclick = () => {
        modalMirror.classList.remove("show");
        if(idx === correctIndex){
          doneReward = true;
          giveReward(correct, accuracy, timeUsed, false);
        }else{
          showResult("Sai gương rồi!", `Gương bạn chọn không có số đúng. Hãy chơi lại để thử tiếp.<br/>Tiến độ đúng lúc hết giờ: <b>${accuracy}%</b>`, [
            {text:"Chơi lại", cls:"btn", onClick: ()=> { modalResult.classList.remove("show"); resetGame(); }},
            {text:"Về trang chính", cls:"btnGhost", onClick: ()=> location.href="index.html"}
          ]);
        }
      };
      mirrorGrid.appendChild(card);
    });
  }

  // ----- Main loop -----
  function loop(ts){
    if(!running) return;

    if(!lastTs) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;

    const speed = softDropping ? G.softDropMs : tickMs;
    fallAccum += dt;

    while(fallAccum >= speed){
      fallAccum -= speed;
      stepDown();
    }

    // draw
    drawBoard();

    requestAnimationFrame(loop);
  }

  // ----- Timer -----
  let timerHandle = null;
  function startTimer(){
    if(timerHandle) clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      if(!running) return;
      timer = Math.max(0, timer - 1);
      updateHUD();
      if(timer <= 0){
        clearInterval(timerHandle);
        finishGame("timeout");
      }
    }, 1000);
  }

  // ----- Controls -----
  window.addEventListener("keydown", (e) => {
    if(["ArrowLeft","ArrowRight","ArrowDown","ArrowUp","Space"].includes(e.code)){
      e.preventDefault();
    }
    if(e.code === "ArrowLeft") move(-1);
    if(e.code === "ArrowRight") move(1);
    if(e.code === "ArrowUp") rotate();
    if(e.code === "Space") hardDrop();
    if(e.code === "ArrowDown") softDropping = true;
  });

  window.addEventListener("keyup", (e) => {
    if(e.code === "ArrowDown") softDropping = false;
  });

  // Mobile pad
  document.querySelectorAll(".btnPad").forEach(btn => {
    const act = btn.getAttribute("data-act");
    let holdInt = null;

    const doAct = () => {
      if(act === "left") move(-1);
      if(act === "right") move(1);
      if(act === "rot") rotate();
      if(act === "down") stepDown();
      if(act === "drop") hardDrop();
    };

    btn.addEventListener("touchstart", (e)=>{
      e.preventDefault();
      doAct();
      // giữ để lặp nhanh với left/right/down
      if(["left","right","down"].includes(act)){
        holdInt = setInterval(doAct, 120);
      }
    }, {passive:false});

    btn.addEventListener("touchend", ()=>{
      if(holdInt) clearInterval(holdInt);
      holdInt = null;
    });
  });

  // ----- Ref modal flow -----
  function openRef(){
    modalRef.classList.add("show");
  }

  btnShowRef.onclick = openRef;
  btnCloseRef.onclick = () => modalRef.classList.remove("show");

  btnIRemember.onclick = () => {
    modalRef.classList.remove("show");
    // Start game + timer
    if(!started){
      startGame();
      startTimer();
    }
  };

  btnStart.onclick = () => {
    // nếu muốn đúng flow: khuyến khích xem tranh gốc trước
    if(!started){
      openRef();
    }
  };

  btnRestart.onclick = () => {
    hideAllModals();
    resetGame();
  };

  btnBackHome.onclick = () => location.href = "index.html";
  btnRetry.onclick = () => { modalResult.classList.remove("show"); resetGame(); };
  btnMirrorCancel.onclick = () => modalMirror.classList.remove("show");

  // ----- Init load image & setup -----
  (async function init(){
    try{
      statusEl.textContent = "Đang tải ảnh thành phố...";
      refImgEl.src = dc.img;

      const { t } = await loadTargetFromImage(dc.img);
      target = t;

      resetGame();

      // auto show ref to guide user
      openRef();
      statusEl.textContent = "Xem tranh gốc, bấm 'Tôi đã nhớ' để bắt đầu.";
    }catch(err){
      console.error(err);
      statusEl.textContent = "Lỗi tải ảnh. Hãy chắc chắn đã đặt assets/dayX.jpg đúng đường dẫn.";
      alert("Lỗi: " + err.message);
    }
  })();
})();