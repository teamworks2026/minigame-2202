// js/config.js
const Config = (() => {
  // Mốc sự kiện
  const EVENT_START = "2026-02-15"; // YYYY-MM-DD (theo giờ máy người chơi)
  const EVENT_DAYS = 3;

  // Cấu hình từng ngày: ảnh + phần thưởng
  // Ngày 1 -> "2", Ngày 2 -> "2", Ngày 3 -> "02" (2 số)
  const DAYS = {
    1: { title: "Ngày 1 • Thành phố 1", img: "assets/day1.jpg", reward: "2" },
    2: { title: "Ngày 2 • Thành phố 2", img: "assets/day2.jpg", reward: "2" },
    3: { title: "Ngày 3 • Thành phố 3", img: "assets/day3.jpg", reward: "02" },
  };

  // Độ khó game
  // cols*rows nên là số chẵn (vì miếng rơi 2 ô)
  const GAME = {
  cols: 4,
  rows: 3,
  seconds: 90,
  passThreshold: 80,
};

  // ====== Google Form / Submit site ======
  // Bạn thay FORM_URL bằng link prefill của form của bạn.
  // Cách dùng: tạo Google Form -> vào "Get pre-filled link" -> copy link đó vào đây.
  // Sau đó map đúng tên entry.* ở buildSubmitUrl() nếu cần.
  const FORM_URL = "https://docs.google.com/forms/d/e/FORM_ID/viewform?usp=pp_url";

  function buildSubmitUrl(payload){
    // payload: {id,name,code,d1,d2,d3, day, accuracy, timeUsed}
    // Bạn chỉnh entry.XXXX cho đúng với Google Form của bạn.
    const p = new URLSearchParams();
    p.set("entry.1111111111", payload.id || "");
    p.set("entry.2222222222", payload.name || "");
    p.set("entry.3333333333", payload.code || "");
    p.set("entry.4444444444", payload.d1 || "");
    p.set("entry.5555555555", payload.d2 || "");
    p.set("entry.6666666666", payload.d3 || "");
    if(payload.day) p.set("entry.7777777777", String(payload.day));
    if(payload.accuracy != null) p.set("entry.8888888888", String(payload.accuracy));
    if(payload.timeUsed != null) p.set("entry.9999999999", String(payload.timeUsed));

    return FORM_URL + "&" + p.toString();
  }

  function getTodayEventDay(){
    const now = new Date();
    const start = new Date(EVENT_START + "T00:00:00");
    const diffMs = now.getTime() - start.getTime();
    const day = Math.floor(diffMs / (24*60*60*1000)) + 1;
    if(day < 1 || day > EVENT_DAYS) return null;
    return day;
  }

  function getDayConfig(day){
    return DAYS[day] || null;
  }

  return { EVENT_START, EVENT_DAYS, DAYS, GAME, FORM_URL, buildSubmitUrl, getTodayEventDay, getDayConfig };
})();