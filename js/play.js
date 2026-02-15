// js/config.js
window.Config = (() => {
  const CFG = {};

  // ====== EVENT TIMEZONE (VN) ======
  // Luôn tính theo giờ VN (GMT+7) dù user ở đâu
  CFG.EVENT_TZ_OFFSET_MIN = 7 * 60; // +0700

  // ====== LOCK MODE ======
  // "todayOnly": Chỉ đúng ngày đó mới chơi được (hết ngày -> khóa lại)
  // "cumulative": Đến ngày đó mở, và các ngày trước vẫn chơi được
  CFG.LOCK_MODE = "todayOnly";

  // ====== GAME SETTINGS ======
  CFG.GAME = {
    cols: 4,
    rows: 3,
    seconds: 90,
    passThreshold: 80
  };

  // ====== DAY CONFIG ======
  // SỬA ngày mở ở OPEN_DATE theo ý bạn (YYYY-MM-DD)
  CFG.DAYS = {
    1: {
      title: "Ngày 1 • Thành phố 1",
      img: "assets/day1.jpg",
      reward: "2",
      OPEN_DATE: "2026-02-15"
    },
    2: {
      title: "Ngày 2 • Thành phố 2",
      img: "assets/day2.jpg",
      reward: "2",
      OPEN_DATE: "2026-02-16"
    },
    3: {
      title: "Ngày 3 • Thành phố 3",
      img: "assets/day3.jpg",
      reward: "02",     // ngày 3 nhận 2 số
      OPEN_DATE: "2026-02-17"
    }
  };

  // ====== GOOGLE FORM ======
  // OPTION A (khuyên dùng): 1 FORM CHUNG cho cả 3 ngày
  // CFG.FORM = { BASE: "...", ENTRY: {...} };

  // OPTION B: 3 FORM RIÊNG theo từng ngày (mở đúng ngày)
  CFG.FORM_BY_DAY = {
    1: { BASE: "", ENTRY: {} },
    2: { BASE: "", ENTRY: {} },
    3: { BASE: "", ENTRY: {} }
  };

  // ====== TIME HELPERS (VN TZ) ======
  const pad2 = (n) => (n < 10 ? "0" + n : "" + n);

  function tzNow() {
    // date shifted so UTC getters represent VN local time
    return new Date(Date.now() + CFG.EVENT_TZ_OFFSET_MIN * 60000);
  }
  function tzYMD(d) {
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  function parseYMD(s) {
    const [Y, M, D] = s.split("-").map(Number);
    return { Y, M, D };
  }
  function tzMidnightMs(ymd) {
    // midnight at VN time -> convert to absolute ms
    const { Y, M, D } = parseYMD(ymd);
    const utcMidnight = Date.UTC(Y, M - 1, D, 0, 0, 0);
    return utcMidnight - CFG.EVENT_TZ_OFFSET_MIN * 60000;
  }

  CFG.getDayConfig = (day) => CFG.DAYS[day] || null;

  CFG.isDayOpen = (day) => {
    const dc = CFG.getDayConfig(day);
    if (!dc) return false;

    const today = tzYMD(tzNow());
    if (CFG.LOCK_MODE === "todayOnly") {
      return today === dc.OPEN_DATE;
    }
    // cumulative
    return Date.now() >= tzMidnightMs(dc.OPEN_DATE);
  };

  CFG.getGateStatus = (day) => {
    const dc = CFG.getDayConfig(day);
    if (!dc) return { ok: false, reason: "NO_DAY" };

    const now = Date.now();
    const openMs = tzMidnightMs(dc.OPEN_DATE);

    if (CFG.LOCK_MODE === "todayOnly") {
      const today = tzYMD(tzNow());
      if (today === dc.OPEN_DATE) return { ok: true };
      // nếu chưa đến ngày mở -> countdown tới mở
      if (now < openMs) return { ok: false, reason: "NOT_YET", openMs };
      // nếu đã qua ngày mở -> khoá lại (todayOnly)
      return { ok: false, reason: "EXPIRED", openMs };
    }

    // cumulative
    if (now >= openMs) return { ok: true };
    return { ok: false, reason: "NOT_YET", openMs };
  };

  // Auto chọn day theo ngày (nếu bạn muốn index.html bấm "Chơi hôm nay")
  CFG.getTodayEventDay = () => {
    const today = tzYMD(tzNow());
    const days = Object.keys(CFG.DAYS).map(Number).sort((a, b) => a - b);

    if (CFG.LOCK_MODE === "todayOnly") {
      const found = days.find(d => CFG.DAYS[d].OPEN_DATE === today);
      return found || days[0];
    }

    // cumulative: chọn day lớn nhất đã mở
    let best = days[0];
    for (const d of days) {
      if (Date.now() >= tzMidnightMs(CFG.DAYS[d].OPEN_DATE)) best = d;
    }
    return best;
  };

  // ====== SUBMIT URL BUILDER ======
  // Bạn có thể dùng 1 form chung (CFG.FORM) hoặc 3 form theo ngày (CFG.FORM_BY_DAY)
  CFG.buildSubmitUrl = (payload) => {
    // nếu day đó đang bị khoá -> không cho submit
    if (!CFG.isDayOpen(payload.day)) return "";

    const form = CFG.FORM_BY_DAY?.[payload.day] || CFG.FORM;
    if (!form?.BASE) return "";

    const u = new URL(form.BASE);
    u.searchParams.set("usp", "pp_url");

    const E = form.ENTRY || {};
    // map theo entry ID bạn điền trong config
    if (E.id) u.searchParams.set(E.id, payload.id || "");
    if (E.name) u.searchParams.set(E.name, payload.name || "");
    if (E.day) u.searchParams.set(E.day, String(payload.day || ""));
    if (E.code) u.searchParams.set(E.code, payload.code || "");
    if (E.d1) u.searchParams.set(E.d1, payload.d1 || "");
    if (E.d2) u.searchParams.set(E.d2, payload.d2 || "");
    if (E.d3) u.searchParams.set(E.d3, payload.d3 || "");
    if (E.accuracy) u.searchParams.set(E.accuracy, String(payload.accuracy ?? ""));
    if (E.timeUsed) u.searchParams.set(E.timeUsed, String(payload.timeUsed ?? ""));

    return u.toString();
  };

  return CFG;
})();