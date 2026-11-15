/* Fieldfare owner page. */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var gbp = function (p) { return "£" + (p / 100).toFixed(2); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var STATUS = { new: "New", preparing: "Cooking", ready: "Ready", collected: "Collected", cancelled: "Cancelled" };
  var toastT;
  function toast(m) { var t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 2400); }
  function api(path, body) {
    return fetch(path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { if (r.status === 401) { gate(); throw new Error("signed out"); } return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Something went wrong."); return d; }); });
  }
  function gate() { $("#gate").hidden = false; $("#app").hidden = true; $("#out").hidden = true; }

  fetch("/api/me", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) { if (d.role === "owner") start(); else gate(); }).catch(gate);
  $("#loginForm").addEventListener("submit", function (e) {
    e.preventDefault(); $("#loginErr").hidden = true;
    fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: $("#pw").value, role: "owner" }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) { if (res.ok) { $("#pw").value = ""; start(); } else { $("#loginErr").textContent = res.d.error; $("#loginErr").hidden = false; } });
  });
  $("#out").addEventListener("click", function () { fetch("/api/logout", { method: "POST" }).then(function () { location.reload(); }); });

  function start() {
    $("#gate").hidden = true; $("#app").hidden = false; $("#out").hidden = false;
    loadSettings(); loadReport(); setInterval(loadReport, 30000);
  }
  function loadReport() {
    api("/api/owner/report").then(function (r) {
      $("#dayLabel").textContent = new Date(r.day + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
      $("#sOrders").textContent = r.orders; $("#sTakings").textContent = gbp(r.takings); $("#sExpected").textContent = gbp(r.expected); $("#sWaiting").textContent = r.notCollected;
      $("#best").innerHTML = r.bestSellers.length ? r.bestSellers.map(function (b) { return "<li>" + esc(b.name) + " <span class=\"fine\">× " + b.qty + "</span></li>"; }).join("") : '<li style="list-style:none;margin-left:-20px" class="fine">No orders yet today.</li>';
      $("#rows").innerHTML = r.list.length ? r.list.map(function (o) {
        return "<tr><td>" + String(o.number).padStart(3, "0") + "</td><td>" + esc(o.name) + "</td><td>" + esc(o.pickup) + "</td><td>" + o.items + '</td><td class="r">' + gbp(o.total) + '</td><td><span class="pill ' + o.status + '">' + STATUS[o.status] + "</span></td><td>" + (o.status === "new" || o.status === "preparing" ? '<button class="linkbtn" type="button" data-cancel="' + o.id + '" data-n="' + o.number + '">Cancel</button>' : "") + "</td></tr>";
      }).join("") : '<tr><td colspan="7" class="fine">No orders yet today.</td></tr>';
    }).catch(function () { /* shown on next refresh */ });
  }
  var confirmId = null;
  $("#rows").addEventListener("click", function (e) {
    var b = e.target.closest("[data-cancel]"); if (!b) return;
    if (confirmId !== b.dataset.cancel) { confirmId = b.dataset.cancel; b.textContent = "Tap again to cancel"; setTimeout(function () { if (confirmId === b.dataset.cancel) { confirmId = null; b.textContent = "Cancel"; } }, 4000); return; }
    confirmId = null;
    api("/api/owner/orders/" + b.dataset.cancel + "/cancel", {}).then(function () { toast("Order " + String(b.dataset.n).padStart(3, "0") + " cancelled"); loadReport(); });
  });

  function loadSettings() {
    api("/api/owner/settings").then(function (s) {
      $("#pauseOn").checked = s.pause.on; $("#pauseMsg").value = s.pause.message;
      $("#sold").innerHTML = s.menu.map(function (sec) { return "<h3>" + esc(sec.name) + "</h3>" + sec.items.map(function (it) { return '<label><input type="checkbox" data-item="' + it.id + '"' + (s.soldOut.indexOf(it.id) > -1 ? " checked" : "") + "> " + esc(it.name) + "</label>"; }).join(""); }).join("");
      $("#hours").innerHTML = [1, 2, 3, 4, 5, 6, 0].map(function (d) {
        var h = s.hours[String(d)], on = !!h;
        return '<div class="hrow2" data-d="' + d + '"><span>' + DAYS[d] + '</span><label class="switch" style="font-weight:500"><input type="checkbox" class="open"' + (on ? " checked" : "") + "> Open</label>" +
          '<span class="times"><input type="time" class="a" value="' + (on ? hm(h[0]) : "08:00") + '"' + (on ? "" : " disabled") + ' aria-label="' + DAYS[d] + ' opens"> to <input type="time" class="b" value="' + (on ? hm(h[1]) : "15:00") + '"' + (on ? "" : " disabled") + ' aria-label="' + DAYS[d] + ' closes"></span></div>';
      }).join("");
    });
  }
  function hm(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
  function mins(v) { var p = v.split(":"); return Number(p[0]) * 60 + Number(p[1]); }

  $("#pauseSave").addEventListener("click", function () {
    api("/api/owner/pause", { on: $("#pauseOn").checked, message: $("#pauseMsg").value }).then(function (st) { $("#pauseNote").textContent = st.paused ? "Online orders are paused. Guests see your message." : "Online orders are open."; toast("Saved"); });
  });
  $("#sold").addEventListener("change", function (e) {
    var c = e.target.closest("[data-item]"); if (!c) return;
    api("/api/owner/soldout", { item: c.dataset.item, sold: c.checked }).then(function () { toast(c.checked ? "Marked sold out" : "Back on the menu"); });
  });
  $("#hours").addEventListener("change", function (e) {
    if (!e.target.classList.contains("open")) return;
    var row = e.target.closest(".hrow2"); row.querySelectorAll("input[type=time]").forEach(function (i) { i.disabled = !e.target.checked; });
  });
  $("#hoursSave").addEventListener("click", function () {
    var out = {}; $("#hoursErr").hidden = true;
    document.querySelectorAll(".hrow2").forEach(function (r) { out[r.dataset.d] = r.querySelector(".open").checked ? [mins(r.querySelector(".a").value), mins(r.querySelector(".b").value)] : null; });
    api("/api/owner/hours", out).then(function () { $("#hoursNote").textContent = "Opening hours saved. The website shows them straight away."; toast("Saved"); })
      .catch(function (err) { $("#hoursErr").textContent = err.message; $("#hoursErr").hidden = false; });
  });
})();
