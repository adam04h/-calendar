(() => {
  "use strict";

  const DB_NAME = "my-desk-calendar-v3";
  const DB_VERSION = 1;
  const STORE = "notes";
  const OLD_STORAGE_KEY = "my-desk-calendar-v2";
  const HOLIDAY_CACHE_PREFIX = "tw-holidays-cache-";
  const HOLIDAY_API = year =>
    `https://cdn.jsdelivr.net/gh/imsyuan/taiwan-holidays/data/${year}/holidays.json`;
  const WORKDAY_API = year =>
    `https://cdn.jsdelivr.net/gh/imsyuan/taiwan-holidays/data/${year}/makeup-workdays.json`;

  const monthNames = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];
  const weekNames = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"];

  // 台灣政府行政機關辦公日曆／國定假日資料。
  // 2027：依行政院人事行政總處已核定的 116 年辦公日曆表。
  // 2028：目前尚未到政府正式公告年度；先依現行法規與曆日推算，標示「預估」。
  // 官方 2028 辦公日曆公布後，可直接更新這一區，不需要重做整個網站。
  const BUILTIN_HOLIDAYS = {
    // ===== 2026 =====
    "2026-01-01":"元旦／開國紀念日",
    "2026-02-16":"春節",
    "2026-02-17":"春節",
    "2026-02-18":"春節",
    "2026-02-19":"春節",
    "2026-02-20":"春節補假",
    "2026-02-27":"和平紀念日補假",
    "2026-02-28":"和平紀念日",
    "2026-04-03":"兒童節補假",
    "2026-04-04":"兒童節",
    "2026-04-05":"清明節",
    "2026-04-06":"清明節補假",
    "2026-05-01":"勞動節",
    "2026-06-19":"端午節",
    "2026-09-25":"中秋節",
    "2026-09-28":"教師節／孔子誕辰",
    "2026-10-09":"國慶日補假",
    "2026-10-10":"國慶日",
    "2026-10-25":"臺灣光復暨金門古寧頭大捷紀念日",
    "2026-10-26":"臺灣光復紀念日補假",
    "2026-12-25":"行憲紀念日",

    // ===== 2027：官方已核定 =====
    "2027-01-01":"元旦／開國紀念日",
    "2027-02-04":"春節假期",
    "2027-02-05":"除夕",
    "2027-02-06":"春節",
    "2027-02-07":"春節",
    "2027-02-08":"春節",
    "2027-02-09":"春節補假",
    "2027-02-10":"春節補假",
    "2027-02-28":"和平紀念日",
    "2027-03-01":"和平紀念日補假",
    "2027-04-04":"兒童節",
    "2027-04-05":"清明節／兒童節放假",
    "2027-04-06":"兒童節補假",
    "2027-04-30":"勞動節補假",
    "2027-05-01":"勞動節",
    "2027-06-09":"端午節",
    "2027-09-15":"中秋節",
    "2027-09-28":"教師節／孔子誕辰",
    "2027-10-10":"國慶日",
    "2027-10-11":"國慶日補假",
    "2027-10-25":"臺灣光復暨金門古寧頭大捷紀念日",
    "2027-12-24":"行憲紀念日補假",
    "2027-12-25":"行憲紀念日",
    "2027-12-31":"2028元旦補假",

    // ===== 2028：預估，等待 DGPA 正式公告 =====
    "2028-01-01":"元旦／開國紀念日（預估）",
    "2028-01-25":"除夕（預估）",
    "2028-01-26":"春節（預估）",
    "2028-01-27":"春節（預估）",
    "2028-01-28":"春節（預估）",
    "2028-01-29":"春節（預估）",
    "2028-01-30":"春節（預估）",
    "2028-02-28":"和平紀念日（預估）",
    "2028-04-04":"兒童節／清明節（預估）",
    "2028-05-01":"勞動節（預估）",
    "2028-05-28":"端午節（預估）",
    "2028-05-29":"端午節補假（預估）",
    "2028-09-28":"教師節／孔子誕辰（預估）",
    "2028-10-03":"中秋節（預估）",
    "2028-10-10":"國慶日（預估）",
    "2028-10-25":"臺灣光復暨金門古寧頭大捷紀念日（預估）",
    "2028-12-25":"行憲紀念日（預估）"
  };


  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2,"0");
  const dateKey = (y,m,d) => `${y}-${pad(m+1)}-${pad(d)}`;

  let notes = {};
  let holidayMap = {...BUILTIN_HOLIDAYS};
  let selectedKey = null;
  let viewDate = new Date();
  viewDate.setDate(1);

  // ---------- IndexedDB：比 localStorage 更適合長期保存記事 ----------
  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function loadNotes() {
    try {
      const db = await openDB();
      const data = await new Promise((resolve,reject) => {
        const tx = db.transaction(STORE,"readonly");
        const req = tx.objectStore(STORE).get("all");
        req.onsuccess = () => resolve(req.result || {});
        req.onerror = () => reject(req.error);
      });
      notes = data || {};
      // 第一/第二版遷移
      if (Object.keys(notes).length === 0) {
        let migrated = null;
        try { migrated = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY) || "null"); } catch {}
        if (!migrated) {
          try { migrated = JSON.parse(localStorage.getItem("my-desk-calendar-notes-v1") || "null"); } catch {}
        }
        if (migrated && typeof migrated === "object") {
          notes = migrated;
          await saveNotes();
        }
      }
    } catch {
      try { notes = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY) || "{}"); } catch { notes = {}; }
    }
  }

  async function saveNotes() {
    try {
      const db = await openDB();
      await new Promise((resolve,reject) => {
        const tx = db.transaction(STORE,"readwrite");
        tx.objectStore(STORE).put(notes,"all");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      $("storageState").textContent = "✓ 已自動儲存";
      return true;
    } catch {
      try {
        localStorage.setItem(OLD_STORAGE_KEY, JSON.stringify(notes));
        $("storageState").textContent = "✓ 已儲存";
        return true;
      } catch {
        $("storageState").textContent = "儲存失敗";
        return false;
      }
    }
  }

  // ---------- 台灣國定假日同步 ----------
  async function loadHolidayYear(year) {
    const cacheKey = HOLIDAY_CACHE_PREFIX + year;

    // 先讀快取
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (Array.isArray(cached)) {
        cached.forEach(x => {
          const k = formatApiDate(x.date);
          if (k && x.description && !BUILTIN_HOLIDAYS[k]) holidayMap[k] = x.description;
        });
      }
    } catch {}

    // 只抓「國定假日」資料，不把普通週末當成國定假日。
    // 這是上一版把 10~12 月大量標成放假的主要問題來源。
    try {
      const res = await fetch(HOLIDAY_API(year), {cache:"no-store"});
      if (!res.ok) throw new Error("holiday api");
      const data = await res.json();

      if (Array.isArray(data)) {
        data.forEach(x => {
          const k = formatApiDate(x.date);
          if (k && !BUILTIN_HOLIDAYS[k]) holidayMap[k] = x.description || "放假";
        });
        try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch {}
      }
    } catch {}

    render();
  }

  function formatApiDate(v) {
    if (!v) return "";
    const s = String(v).replaceAll("-","").replaceAll("/","");
    if (!/^\d{8}$/.test(s)) return "";
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  }

  function holidayInfo(key) {
    return holidayMap[key] || "";
  }

  function isToday(y,m,d) {
    const t = new Date();
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
  }

  function render() {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    $("yearLabel").textContent = y;
    $("monthLabel").textContent = monthNames[m];

    const grid = $("calendarGrid");
    grid.innerHTML = "";
    const firstDay = new Date(y,m,1).getDay();
    const days = new Date(y,m+1,0).getDate();

    for (let i=0;i<firstDay;i++) {
      const blank = document.createElement("div");
      blank.className = "day empty";
      grid.appendChild(blank);
    }

    let monthNoteCount = 0;

    for (let d=1; d<=days; d++) {
      const dt = new Date(y,m,d);
      const dow = dt.getDay();
      const key = dateKey(y,m,d);
      const note = String(notes[key] || "").trim();
      const holiday = holidayInfo(key);
      if (note) monthNoteCount++;

      const btn = document.createElement("button");
      btn.className = "day" + ((dow===0 || dow===6) ? " weekend" : "") + (isToday(y,m,d) ? " today" : "");
      if (holiday && !/補班/.test(holiday)) btn.classList.add("holiday");

      const num = document.createElement("div");
      num.className = "num";
      num.textContent = d;

      // 手機直式會改成 3 欄排列，因此把星期放進日期格，
      // 讓畫面像紙本桌曆一樣直接看到「1(四)」。
      const mobileWeek = document.createElement("span");
      mobileWeek.className = "mobileWeek";
      mobileWeek.textContent = `(${["日","一","二","三","四","五","六"][dow]})`;
      num.appendChild(mobileWeek);
      btn.appendChild(num);

      if (holiday) {
        const hol = document.createElement("div");
        hol.className = "holidayLabel";
        hol.textContent = holiday;
        btn.appendChild(hol);
      }

      if (note) {
        const mark = document.createElement("span");
        mark.className = "noteMark";
        btn.appendChild(mark);

        const preview = document.createElement("div");
        preview.className = "notePreview";
        preview.textContent = note;
        btn.appendChild(preview);
      }

      btn.addEventListener("click", () => openNote(y,m,d,key));
      grid.appendChild(btn);
    }

    const holidayYearNote = (y === 2028) ? "　※2028 假日為預估，待官方公告更新" : "";
    $("monthSummary").textContent = `${monthNoteCount} 筆記事${holidayYearNote}`;
  }

  function openNote(y,m,d,key) {
    selectedKey = key;
    const dt = new Date(y,m,d);
    $("noteWeek").textContent = weekNames[dt.getDay()];
    $("noteDate").textContent = `${y} 年 ${m+1} 月 ${d} 日`;
    $("noteInput").value = notes[key] || "";
    $("noteSaveState").textContent = "會自動儲存";
    $("noteOverlay").classList.add("open");
    $("noteOverlay").setAttribute("aria-hidden","false");
    setTimeout(() => {
      $("noteInput").focus();
      const n = $("noteInput").value.length;
      $("noteInput").setSelectionRange(n,n);
    }, 80);
  }

  function closeNote() {
    $("noteOverlay").classList.remove("open");
    $("noteOverlay").setAttribute("aria-hidden","true");
    selectedKey = null;
    render();
  }

  function changeMonth(delta) {
    viewDate.setMonth(viewDate.getMonth() + delta);
    loadHolidayYear(viewDate.getFullYear());
    render();
  }

  $("noteInput").addEventListener("input", async e => {
    if (!selectedKey) return;
    const value = e.target.value;
    if (value.trim()) notes[selectedKey] = value;
    else delete notes[selectedKey];
    await saveNotes();
    $("noteSaveState").textContent = "✓ 已儲存";
    render();
  });

  $("closeNote").addEventListener("click", closeNote);
  $("doneNote").addEventListener("click", closeNote);
  $("noteOverlay").addEventListener("click", e => { if(e.target === $("noteOverlay")) closeNote(); });

  $("clearNote").addEventListener("click", async () => {
    if (!selectedKey) return;
    delete notes[selectedKey];
    await saveNotes();
    $("noteInput").value = "";
    $("noteSaveState").textContent = "已清除";
    render();
  });

  $("prevMonth").addEventListener("click", () => changeMonth(-1));
  $("nextMonth").addEventListener("click", () => changeMonth(1));
  $("goToday").addEventListener("click", () => {
    viewDate = new Date();
    viewDate.setDate(1);
    loadHolidayYear(viewDate.getFullYear());
    render();
  });

  // ESC 關閉
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && $("noteOverlay").classList.contains("open")) closeNote();
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  (async () => {
    await loadNotes();
    render();
    await loadHolidayYear(viewDate.getFullYear());
  })();
})();