/* Fieldfare kitchen screen. */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  };
  var openD = function (d) { if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", ""); };
  var shut = function (d) { if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); };
  var pad = function (n) { return String(n).padStart(3, "0"); };
  var LONDON = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  function londonMin() { var p = LONDON.formatToParts(new Date()), h = 0, m = 0; p.forEach(function (x) { if (x.type === "hour") h = +x.value; if (x.type === "minute") m = +x.value; }); return h * 60 + m; }
  function clockLabel(min) { var h = Math.floor(min / 60), m = min % 60; return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"); }

  var orders = {}, recall = [], soldOut = [], paused = false, menu = null;
  var ws = null, live = false, retry = 0, audio = null, wake = null, seen = {}, firstSnapshot = true;
  var sound = store.get("ff-k-sound", true);
  var ticks = store.get("ff-k-ticks", {});
  var queue = store.get("ff-k-queue", []);

  /* ---------- sign in ---------- */
  function show(id) { ["#login", "#start", "#board"].forEach(function (s) { $(s).hidden = s !== id; }); }
  fetch("/api/me", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) { show(d.role ? "#start" : "#login"); if (!d.role) $("#pw").focus(); }).catch(function () { show("#login"); });
  $("#loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("#loginErr"); err.hidden = true;
    fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: $("#pw").value, role: "staff" }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) { if (res.ok) { $("#pw").value = ""; show("#start"); } else { err.textContent = res.d.error || "That didn't work. Please try again."; err.hidden = false; } })
      .catch(function () { err.textContent = "No connection. Please check the Wi-Fi."; err.hidden = false; });
  });

  /* ---------- start of service ---------- */
  $("#startBtn").addEventListener("click", function () {
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (e) { audio = null; }
    keepAwake();
    show("#board"); renderSound(); connect(); setInterval(tick, 15000); tick();
    fetch("/api/bootstrap").then(function (r) { return r.json(); }).then(function (d) { menu = d.menu; }).catch(function () { /* sold-out list loads later */ });
  });
  function keepAwake() {
    if (!("wakeLock" in navigator)) return;
    navigator.wakeLock.request("screen").then(function (l) { wake = l; }).catch(function () { /* not allowed here */ });
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !$("#board").hidden) { keepAwake(); if (!ws || ws.readyState > 1) { retry = 0; connect(); } } });

  function chime() {
    if (!sound || !audio) return;
    try {
      [0, 0.18].forEach(function (d, i) {
        var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + d;
        o.type = "sine"; o.frequency.value = i ? 1046 : 784;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.5);
      });
    } catch (e) { /* audio unavailable */ }
  }
  function renderSound() { var b = $("#soundBtn"); b.setAttribute("aria-pressed", String(sound)); b.textContent = sound ? "Sound on" : "Sound off"; }
  $("#soundBtn").addEventListener("click", function () { sound = !sound; store.set("ff-k-sound", sound); renderSound(); if (sound) chime(); });

  /* ---------- live connection ---------- */
  function setConn(on) {
    live = on;
    var c = $("#conn"); c.classList.toggle("on", on); c.lastElementChild.textContent = on ? "Live" : "Reconnecting…";
    $("#offline").hidden = on;
  }
  function connect() {
    try { ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/kitchen"); } catch (e) { return later(); }
    var ping;
    ws.onopen = function () { setConn(true); retry = 0; flush(); ping = setInterval(function () { try { ws.send("ping"); } catch (e) { /* closed */ } }, 25000); };
    ws.onmessage = function (e) { if (e.data === "pong") return; var m; try { m = JSON.parse(e.data); } catch (err) { return; } handle(m); };
    ws.onclose = function () { clearInterval(ping); setConn(false); later(); };
  }
  function later() {
    // A closed line might mean the sign-in expired.
    fetch("/api/me", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) { if (!d.role) { show("#login"); return; } schedule(); }).catch(schedule);
    function schedule() { retry = Math.min(retry + 1, 5); setTimeout(connect, Math.min(20000, 1000 * Math.pow(2, retry))); }
  }
  window.addEventListener("online", function () { if (!live) { retry = 0; connect(); } });

  function handle(m) {
    if (m.type === "snapshot") {
      var fresh = [];
      var next = {}; m.orders.forEach(function (o) { next[o.id] = o; if (!seen[o.id] && !firstSnapshot && o.status === "new") fresh.push(o.id); seen[o.id] = true; });
      orders = next; recall = m.recall; soldOut = m.soldOut; paused = m.paused;
      if (fresh.length) { chime(); fresh.forEach(function (id) { flashIds[id] = Date.now(); }); }
      firstSnapshot = false;
      // Re-apply taps that haven't reached the server yet.
      queue.forEach(function (q) { if (orders[q.id]) orders[q.id].status = q.status; });
    } else if (m.type === "order") {
      var o = m.order;
      if (!seen[o.id] && o.status === "new") { chime(); flashIds[o.id] = Date.now(); }
      seen[o.id] = true;
      if (o.status === "collected") { delete orders[o.id]; recall = [o].concat(recall.filter(function (r) { return r.id !== o.id; })).slice(0, 10); }
      else if (o.status === "cancelled") { delete orders[o.id]; }
      else { orders[o.id] = o; recall = recall.filter(function (r) { return r.id !== o.id; }); }
    }
    render();
  }

  /* ---------- drawing ---------- */
  var flashIds = {};
  var COLS = { new: "#lNew", preparing: "#lPrep", ready: "#lReady" };
  var NEXT = { new: "preparing", preparing: "ready", ready: "collected" };
  var PREV = { preparing: "new", ready: "preparing" };
  var BTN = { new: "Start", preparing: "Mark ready", ready: "Collected" };

  function timing(o, nowMin) {
    var age = Math.floor((Date.now() - o.created) / 60000);
    if (o.status === "ready") {
      var waited = Math.floor((Date.now() - (o.readyAt || o.updated)) / 60000);
      return { cls: waited >= 20 ? "late" : waited >= 10 ? "warn" : "", text: waited < 1 ? "Just ready" : "Waiting " + waited + " min" };
    }
    if (o.asap) return { cls: age >= 15 ? "late" : age >= 8 ? "warn" : "", text: age < 1 ? "Just in" : age + " min" };
    var due = o.slotMin - nowMin;
    if (due > 20) return { cls: "later", text: "In " + (due >= 60 ? Math.floor(due / 60) + " h " + (due % 60 ? due % 60 + " min" : "") : due + " min") };
    if (due >= 0) return { cls: "", text: due === 0 ? "Due now" : "Due in " + due + " min" };
    return { cls: -due > 5 ? "late" : "warn", text: -due + " min late" };
  }
  function card(o, nowMin) {
    var t = timing(o, nowMin), mine = ticks[o.id] || [];
    var fresh = flashIds[o.id] && Date.now() - flashIds[o.id] < 60000 ? " fresh" : "";
    return '<article class="tk ' + t.cls + fresh + '" data-id="' + o.id + '"><div class="h"><span class="no">' + pad(o.number) + '</span><span class="t">' + t.text + "</span></div>" +
      '<div class="who"><span>' + esc(o.name) + "</span>" + (o.asap ? "<span>As soon as possible</span>" : '<span class="due">For ' + clockLabel(o.slotMin) + "</span>") + "</div>" +
      "<ul>" + o.items.map(function (l, i) { var done = mine.indexOf(i) > -1; return '<li class="' + (done ? "done" : "") + '"><button type="button" data-tick="' + i + '" aria-pressed="' + done + '">' + l.qty + " × " + esc(l.name) + (l.options.length ? "<small>" + esc(l.options.join(", ")) + "</small>" : "") + "</button></li>"; }).join("") + "</ul>" +
      (o.notes ? '<div class="note">Note: ' + esc(o.notes) + "</div>" : "") +
      '<button type="button" class="go' + (o.status === "preparing" ? " ready" : "") + '" data-go="' + NEXT[o.status] + '">' + BTN[o.status] + "</button>" +
      (PREV[o.status] ? '<button type="button" class="back" data-go="' + PREV[o.status] + '">Move back a step</button>' : "") + "</article>";
  }
  function render() {
    var nowMin = londonMin(), lists = { new: [], preparing: [], ready: [] };
    Object.keys(orders).forEach(function (id) { var o = orders[id]; if (lists[o.status]) lists[o.status].push(o); });
    lists.new.sort(function (a, b) { return (a.asap ? 0 : a.slotMin) - (b.asap ? 0 : b.slotMin) || a.created - b.created; });
    lists.preparing.sort(function (a, b) { return a.updated - b.updated; });
    lists.ready.sort(function (a, b) { return (a.readyAt || 0) - (b.readyAt || 0); });
    Object.keys(COLS).forEach(function (s) {
      $(COLS[s]).innerHTML = lists[s].length ? lists[s].map(function (o) { return card(o, nowMin); }).join("") : '<p class="empty">' + (s === "new" ? "No new orders." : s === "preparing" ? "Nothing cooking." : "Nothing waiting for pickup.") + "</p>";
    });
    $("#cNew").textContent = lists.new.length; $("#cPrep").textContent = lists.preparing.length; $("#cReady").textContent = lists.ready.length;
    // "All day": everything still to cook that is due within 30 minutes.
    var counts = {};
    lists.new.concat(lists.preparing).forEach(function (o) { if (!o.asap && o.slotMin - nowMin > 30) return; o.items.forEach(function (l) { counts[l.name] = (counts[l.name] || 0) + l.qty; }); });
    var names = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    $("#allday").innerHTML = names.length ? names.map(function (n) { return "<span><b>" + counts[n] + "</b>" + esc(n) + "</span>"; }).join("") : '<span class="none">Nothing to cook right now</span>';
    $("#paused").hidden = !paused;
  }
  function tick() { $("#clock").textContent = LONDON.format(new Date()); if (!$("#board").hidden) render(); }

  /* ---------- taps ---------- */
  var undoT = null;
  document.querySelector(".cols").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var cardEl = b.closest(".tk"), id = cardEl && cardEl.dataset.id, o = orders[id]; if (!o) return;
    if (b.dataset.tick !== undefined) {
      var i = Number(b.dataset.tick), list = ticks[id] || [];
      ticks[id] = list.indexOf(i) > -1 ? list.filter(function (x) { return x !== i; }) : list.concat(i);
      store.set("ff-k-ticks", ticks); render(); return;
    }
    if (b.dataset.go) move(o, b.dataset.go, true);
  });
  function move(o, to, offerUndo) {
    var from = o.status;
    if (to === "collected") { delete orders[o.id]; recall = [Object.assign({}, o, { status: "collected" })].concat(recall).slice(0, 10); }
    else { o.status = to; o.updated = Date.now(); if (to === "ready") o.readyAt = Date.now(); orders[o.id] = o; }
    render(); send(o.id, to);
    if (offerUndo) {
      var words = { preparing: "started", ready: "marked ready", collected: "collected", new: "moved back to new" };
      $("#undoMsg").textContent = "Order " + pad(o.number) + " " + (words[to] || "updated") + ".";
      $("#undo").hidden = false; clearTimeout(undoT);
      $("#undoBtn").onclick = function () { $("#undo").hidden = true; var back = Object.assign({}, o, { status: to }); if (to === "collected") recall = recall.filter(function (r) { return r.id !== o.id; }); move(back, from, false); };
      undoT = setTimeout(function () { $("#undo").hidden = true; }, 6000);
    }
  }
  function send(id, status) {
    // Keep every tap, in order: "Start" then "Mark ready" must both reach the server.
    queue = queue.concat({ id: id, status: status });
    store.set("ff-k-queue", queue); flush();
  }
  var flushing = false;
  function flush() {
    if (flushing || !queue.length) return;
    flushing = true;
    var q = queue[0];
    fetch("/api/kitchen/orders/" + q.id, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: q.status }) })
      .then(function (r) {
        if (r.status === 401) { show("#login"); throw new Error("signed out"); }
        // Done, or refused because the order already moved on elsewhere: either way drop it.
        queue.shift(); store.set("ff-k-queue", queue);
        if (r.status === 409 && ws && ws.readyState === 1) ws.send("snapshot");
      })
      .then(function () { flushing = false; flush(); })
      .catch(function () { flushing = false; setConn(live && navigator.onLine); setTimeout(flush, 5000); });
  }

  /* ---------- recall, sold out, sign out ---------- */
  $("#recallBtn").addEventListener("click", function () {
    $("#recallList").innerHTML = recall.length ? recall.map(function (o) { return '<div class="rrow"><span><b>' + pad(o.number) + "</b> " + esc(o.name) + " · " + o.items.reduce(function (a, l) { return a + l.qty; }, 0) + ' items</span><button class="kbtn" type="button" data-back="' + o.id + '">Bring back to Ready</button></div>'; }).join("") : '<p class="muted">Nothing collected yet today.</p>';
    openD($("#recall"));
  });
  $("#recallList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-back]"); if (!b) return;
    var o = recall.filter(function (r) { return r.id === b.dataset.back; })[0]; if (!o) return;
    recall = recall.filter(function (r) { return r.id !== o.id; });
    o.status = "ready"; orders[o.id] = o; render(); send(o.id, "ready"); shut($("#recall"));
  });
  $("#soldBtn").addEventListener("click", function () { drawSold(); openD($("#sold")); });
  function drawSold() {
    if (!menu) { $("#soldList").innerHTML = '<p class="muted">Loading the menu…</p>'; return; }
    $("#soldList").innerHTML = menu.map(function (s) { return "<h3>" + esc(s.name) + "</h3>" + s.items.map(function (it) { var on = soldOut.indexOf(it.id) > -1; return '<button type="button" data-item="' + it.id + '" aria-pressed="' + on + '">' + esc(it.name) + (on ? " · sold out" : "") + "</button>"; }).join(""); }).join("");
  }
  $("#soldList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-item]"); if (!b) return;
    var sold = b.getAttribute("aria-pressed") !== "true";
    soldOut = sold ? soldOut.concat(b.dataset.item) : soldOut.filter(function (x) { return x !== b.dataset.item; }); drawSold();
    fetch("/api/kitchen/soldout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item: b.dataset.item, sold: sold }) }).catch(function () { /* the next snapshot corrects it */ });
  });
  document.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", function () { shut(b.closest("dialog")); }); });
  $("#outBtn").addEventListener("click", function () { fetch("/api/logout", { method: "POST" }).then(function () { location.reload(); }); });
})();
