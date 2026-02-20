// js/storage.js
const Storage = (() => {
  const K_PROFILE = "cgp_profile";
  const K_DIGITS  = "cgp_digits";
  const K_HISTORY = "cgp_history";

  function uid(){
    // ID ngắn đủ dùng, tránh trùng
    return "CGP-" + Math.random().toString(16).slice(2,6).toUpperCase() + "-" + Date.now().toString(36).toUpperCase();
  }

  function ensureProfile(){
    const raw = localStorage.getItem(K_PROFILE);
    if(raw) return JSON.parse(raw);
    const profile = { id: uid(), name: "" };
    localStorage.setItem(K_PROFILE, JSON.stringify(profile));
    return profile;
  }

  function getProfile(){
    return ensureProfile();
  }

  function setName(name){
    const p = ensureProfile();
    p.name = name || "";
    localStorage.setItem(K_PROFILE, JSON.stringify(p));
  }

  function getDigits(){
    return JSON.parse(localStorage.getItem(K_DIGITS) || "{}");
  }

  function setDigit(day, rewardStr){
    const d = getDigits();
    d[String(day)] = String(rewardStr);
    localStorage.setItem(K_DIGITS, JSON.stringify(d));
  }

  function getFinalCode(){
    const d = getDigits();
    const a = d["1"] || "";
    const b = d["2"] || "";
    const c = d["3"] || "";
    const code = (a + b + c).trim();
    return code.length ? code : "";
  }

  function addHistory(entry){
    const h = JSON.parse(localStorage.getItem(K_HISTORY) || "[]");
    h.unshift(entry);
    localStorage.setItem(K_HISTORY, JSON.stringify(h));
  }

  function resetAll(){
    localStorage.removeItem(K_PROFILE);
    localStorage.removeItem(K_DIGITS);
    localStorage.removeItem(K_HISTORY);
    ensureProfile();
  }

  return { ensureProfile, getProfile, setName, getDigits, setDigit, getFinalCode, addHistory, resetAll };
})();