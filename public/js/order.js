/* A guest's own order page. Live over a WebSocket, with a slower check as a backup. */
(function () {
  "use strict";
  var app = document.getElementById("app");
  var token = (location.pathname.split("/")[2] || "").replace(/[^\w-]/g, "");
  var gbp = function (p) { return "£" + (p / 100).toFixed(2); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var ic = function (n) { return '<svg class="i"><use href="#i-' + n + '"/></svg>'; };
  var time = function (ms) {
    if (!ms) return "";
    var p = {}; new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London" }).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return p.hour + ":" + p.minute + String(p.dayPeriod || "").toLowerCase().replace(/\s|\./g, "");
  };
  var last = null, live = false, ws = null, retry = 0, pollT = null;

  var HEAD = {
    new: ["We've got your order", "The kitchen will start on it shortly."],
    preparing: ["Your food is being made", "We're cooking it now."],
    ready: ["Your order is ready", "Come to the counter and give your name. You'll pay when you collect."],
    collected: ["Enjoy your brunch", "Thanks for ordering with us."],
    cancelled: ["This order was cancelled", "If you didn't expect this, please talk to us at the counter."]
  };
  var COLUMN = { new: "New orders", preparing: "In progress", ready: "Ready", collected: "Collected", cancelled: "Cancelled" };

  function render(o) {
    var prev = last; last = o;
    var h = HEAD[o.status] || HEAD.new, rank = { new: 0, preparing: 1, ready: 2, collected: 3, cancelled: -1 }[o.status];
    var sub = h[1];
    if (o.status === "new" || o.status === "preparing") sub += o.asap ? " We expect it around " + esc(o.pickup.replace(/^As soon as possible, around /, "")) + "." : "";
    if ((o.status === "new") && o.ahead > 0) sub += " There " + (o.ahead === 1 ? "is 1 order" : "are " + o.ahead + " orders") + " ahead of yours.";
    var steps = [
      ["Received by the kitchen", "Placed at " + time(o.created)],
      ["Being prepared", rank >= 1 ? "Cooking now" : "Starts soon"],
      ["Ready to collect", o.readyAt ? "Ready at " + time(o.readyAt) : o.pickup]
    ];
    var prog = o.status === "cancelled" ? "" : '<ol class="progress">' + steps.map(function (s, i) {
      var cls = i < rank || (i === 2 && rank >= 2) ? "dn" : i === rank ? "on" : "todo";
      return '<li class="' + cls + '"><span class="dot">' + (cls === "dn" ? ic("check") : "") + "</span><div><b>" + s[0] + "</b><small>" + esc(s[1]) + "</small></div></li>";
    }).join("") + "</ol>";
    app.innerHTML =
      '<div class="ogrid"><section class="ocard">' +
      (o.status === "ready" ? '<div class="ready-banner">' + ic("bell") + "<div><b>Ready at the counter</b>Order " + pad(o.number) + " for " + esc(o.firstName) + "</div></div>" : "") +
      '<div class="ohead"><span class="num">Order ' + pad(o.number) + " for " + esc(o.firstName) + "</span><h1>" + h[0] + "</h1><p>" + sub + "</p></div>" + prog +
      '<p class="conn' + (live ? "" : " off") + '"><i></i>' + (live ? "This page updates by itself." : "Reconnecting. We'll keep checking for updates.") + "</p>" +
      "</section>" +
      '<aside class="ocard"><h2 style="font-size:28px;margin-bottom:14px">Your order</h2><ul class="olist">' +
      o.items.map(function (l) { return "<li><span>" + l.qty + " × " + esc(l.name) + (l.options.length ? "<small>" + esc(l.options.join(", ")) + "</small>" : "") + "</span><span>" + gbp(l.total) + "</span></li>"; }).join("") + "</ul>" +
      '<div class="ometa">' + (o.notes ? "<div><span>Your note</span><span style=\"text-align:right\">" + esc(o.notes) + "</span></div>" : "") +
      "<div><span>Pickup</span><span style=\"text-align:right\">" + esc(o.pickup) + "</span></div>" +
      "<div><span>Pay at the counter</span><b>" + gbp(o.total) + "</b></div>" +
      "<div><span>Where</span><span style=\"text-align:right\">Church Street, Stoke Newington</span></div></div>" +
      (o.status !== "cancelled" && o.status !== "collected" ? '<div class="ticket"><div class="lab">Your ticket on our kitchen screen</div><div class="tk ' + o.status + '"><div class="h"><span class="no">' + pad(o.number) + '</span><span class="col">' + COLUMN[o.status] + "</span></div><div style=\"font-size:14px;color:#AEB8B2;margin-top:4px\">" + esc(o.firstName) + " · " + esc(o.asap ? "As soon as possible" : o.pickup) + "</div><ul>" + o.items.map(function (l) { return "<li>" + l.qty + " × " + esc(l.name) + (l.options.length ? "<small>" + esc(l.options.join(", ")) + "</small>" : "") + "</li>"; }).join("") + "</ul></div></div>" : "") +
      (o.hasEmail && o.status !== "collected" ? '<p class="fine" style="margin-top:14px">We\'ll also email you when it\'s ready.</p>' : "") +
      "</aside></div>";
    document.title = (o.status === "ready" ? "Ready! " : "") + "Order " + pad(o.number) + " · Fieldfare";
    if (prev && prev.status !== "ready" && o.status === "ready") { try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { /* not supported */ } }
  }
  function pad(n) { return String(n).padStart(3, "0"); }

  function notFound() {
    app.innerHTML = '<div class="ocard" style="max-width:560px"><div class="ohead"><h1>We couldn\'t find that order</h1><p>The link may be incomplete. If you placed an order, check the email we sent, or ask us at the counter.</p></div><a class="btn btn-dark" href="/#menu">Go to the menu</a></div>';
  }

  /* backup: check every 10 seconds while the live line is down */
  function poll() {
    clearTimeout(pollT);
    fetch("/api/orders/" + token, { cache: "no-store" }).then(function (r) {
      if (r.status === 404) { notFound(); throw 0; }
      return r.json();
    }).then(function (d) { if (d && d.order) render(d.order); }).catch(function () { /* offline, try again */ })
      .then(function () { if (!live && last && last.status !== "collected" && last.status !== "cancelled") pollT = setTimeout(poll, 10000); });
  }

  function connect() {
    if (!token) return notFound();
    try { ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/order/" + token); } catch (e) { return poll(); }
    var ping;
    ws.onopen = function () { live = true; retry = 0; clearTimeout(pollT); if (last) render(last); ping = setInterval(function () { try { ws.send("ping"); } catch (e) { /* closed */ } }, 25000); };
    ws.onmessage = function (e) { if (e.data === "pong") return; try { var m = JSON.parse(e.data); if (m.type === "order") render(m.order); } catch (err) { /* ignore */ } };
    ws.onclose = function (e) {
      clearInterval(ping); live = false;
      if (e.code === 4404) return notFound();
      if (last) render(last);
      if (last && (last.status === "collected" || last.status === "cancelled")) return;
      poll();
      retry = Math.min(retry + 1, 6);
      setTimeout(connect, Math.min(30000, 1000 * Math.pow(2, retry)));
    };
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && (!ws || ws.readyState > 1)) { retry = 0; connect(); } });
  poll(); connect();
})();
