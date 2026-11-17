/* Fieldfare home page: menu, dish pop-up, order, checkout. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var gbp = function (p) { return "£" + (p / 100).toFixed(2); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var ic = function (n) { return '<svg class="i"><use href="#i-' + n + '"/></svg>'; };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  var openD = function (d) { if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", ""); };
  var shut = function (d) { if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); };
  var toastT;
  function toast(msg) { var t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 2600); }

  var DATA = null, ITEMS = {}, SOLD = {}, OPTS = {};
  var order = store.get("ff-order", []);
  var info = store.get("ff-details", { name: "", phone: "", email: "" });
  info.notes = "";

  /* ---------- load menu and today's status ---------- */
  function load() {
    fetch("/api/bootstrap", { headers: { accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { DATA = d; render(); })
      .catch(function () {
        $("#screens").innerHTML = '<div class="notice err">' + ic("alert") + '<span>We couldn\'t load the menu just now. Please check your connection and <a href="" style="text-decoration:underline">try again</a>.</span></div>';
        $("#heroStatus").innerHTML = "<span>Opening hours are below.</span>";
      });
  }

  function render() {
    OPTS = DATA.options;
    DATA.menu.forEach(function (s) { s.items.forEach(function (it) { ITEMS[it.id] = it; }); });
    SOLD = {}; DATA.soldOut.forEach(function (id) { SOLD[id] = true; });
    renderStatus(DATA.status);
    renderMenu();
    renderSpecials();
    renderNums(DATA.status);
    loadQuickSlots();
    // Drop anything from a saved order that has since sold out or left the menu.
    var before = order.length;
    order = order.filter(function (l) { return ITEMS[l.id] && !SOLD[l.id]; });
    if (order.length !== before) { save(); toast("Something in your saved order has sold out, so we removed it."); }
    bar();
  }

  function renderStatus(st) {
    var h = $("#heroStatus");
    if (st.paused) h.innerHTML = '<span><span class="closed"></span>' + esc(st.label) + "</span>";
    else if (st.asapOpen) h.innerHTML = '<span><span class="live"></span>Open now, food ready in about ' + st.waitMin + " minutes</span><span>" + ic("clock") + "Today until " + esc(st.closesAt) + "</span>";
    else h.innerHTML = '<span><span class="closed"></span>' + esc(st.label) + "</span>" + (st.orderDay ? "<span>" + ic("clock") + "You can order ahead for " + esc(st.orderDay.label) + "</span>" : "");
    $("#stripWait").textContent = st.asapOpen ? "Ready in about " + st.waitMin + " minutes" : "Order ahead";
    $("#stripWaitSub").textContent = st.asapOpen ? "Or choose a later time" : "Pick a time that suits you";
    $("#hours").innerHTML = st.hours.map(function (d) { return '<li class="' + (d.today ? "today " : "") + (d.hours === "Closed" ? "closed" : "") + '"><span>' + esc(d.day) + (d.today ? " (today)" : "") + "</span><span>" + esc(d.hours) + "</span></li>"; }).join("");
    $("#lastOrder").textContent = st.lastOrderNote;
    $("#menuNotice").innerHTML = st.paused ? '<div class="notice" style="margin-bottom:20px">' + ic("alert") + "<span>" + esc(st.label) + " You can still look through the menu.</span></div>" : "";
    $("#fHours").innerHTML = st.hours.map(function (d) { return "<li>" + esc(d.day) + ", " + esc(d.hours === "Closed" ? "closed" : d.hours) + "</li>"; }).join("");
  }

  /* ---------- today's specials ---------- */
  var SPECIALS = ["garlic-mushrooms", "french-toast", "turkish-eggs", "hash-brown-stack"];
  function renderSpecials() {
    $("#spList").innerHTML = SPECIALS.filter(function (id) { return ITEMS[id]; }).map(function (id) {
      var it = ITEMS[id], sold = !!SOLD[id];
      return '<li class="' + (sold ? "sold" : "") + '"><button type="button" data-id="' + id + '"' + (sold ? ' aria-disabled="true"' : "") + '><span class="n">' + esc(it.name) + '</span><span class="p">' + (sold ? "Sold out" : gbp(it.price)) + '</span><span class="d">' + esc(it.desc) + "</span></button></li>";
    }).join("");
  }
  $("#spList").addEventListener("click", function (e) { var b = e.target.closest("[data-id]"); if (b && !SOLD[b.dataset.id]) openDish(ITEMS[b.dataset.id]); });

  /* ---------- live numbers (real figures only) ---------- */
  function renderNums(st) {
    var n = 0; Object.keys(ITEMS).forEach(function (id) { if (!SOLD[id]) n++; });
    $("#nDishes").textContent = n;
    $("#nWait").textContent = st.asapOpen ? "About " + st.waitMin + " min" : st.paused ? "Paused" : "Closed now";
    if (st.closesAt) { $("#nOpen").textContent = "Until " + st.closesAt; $("#nOpenLabel").textContent = "Open today"; }
    else {
      var next = st.hours.filter(function (d) { return d.hours !== "Closed"; });
      $("#nOpen").textContent = st.orderDay ? cap(st.orderDay.label) : "Soon";
      $("#nOpenLabel").textContent = "We open next" + (next.length ? ", " + next[0].hours.split(" to ")[0] : "");
    }
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- quick pickup times in the order-ahead band ---------- */
  var preferred = store.get("ff-when", null);
  function loadQuickSlots() {
    fetch("/api/slots").then(function (r) { return r.json(); }).then(function (s) {
      var box = $("#bandSlots");
      var firstFree = (s.slots || []).filter(function (x) { return !x.full; })[0];
      $("#nSlot").textContent = s.asap ? "Right now" : firstFree ? (s.day.label === "today" ? "" : cap(s.day.label) + " ") + firstFree.label : "None left";
      if (s.paused || (!s.asap && !s.slots.length)) { box.innerHTML = '<p class="fine">' + esc(s.message || "There are no pickup times left right now.") + "</p>"; return; }
      var open = s.slots.filter(function (x) { return !x.full; }).slice(0, 6);
      box.innerHTML = (s.asap ? '<button type="button" class="qslot asap" data-asap="1">As soon as possible, about ' + s.asap.waitMin + " min</button>" : "") +
        (s.day.label !== "today" || !s.asap ? '<p class="qday">' + esc(cap(s.day.label)) + "</p>" : "") +
        open.map(function (x) { return '<button type="button" class="qslot" data-day="' + s.day.date + '" data-min="' + x.min + '">' + x.label + "</button>"; }).join("");
      markQuick();
    }).catch(function () { $("#bandSlots").innerHTML = '<p class="fine">Pickup times will show at checkout.</p>'; });
  }
  function markQuick() {
    document.querySelectorAll(".qslot").forEach(function (b) {
      var on = !!preferred && (preferred.asap ? !!b.dataset.asap : b.dataset.day === preferred.day && Number(b.dataset.min) === preferred.min);
      b.setAttribute("aria-pressed", String(on));
    });
  }
  $("#bandSlots").addEventListener("click", function (e) {
    var b = e.target.closest(".qslot"); if (!b) return;
    preferred = b.dataset.asap ? { asap: true } : { day: b.dataset.day, min: Number(b.dataset.min) };
    store.set("ff-when", preferred); markQuick();
    $("#bandNote").textContent = "Saved. Now choose your food below, and we'll use this time at checkout.";
  });

  /* ---------- photo card shortcut to a menu section ---------- */
  document.querySelector(".trio").addEventListener("click", function (e) {
    var c = e.target.closest("[data-tab]"); if (!c) return;
    var t = document.getElementById("tab-" + c.dataset.tab); if (!t) return;
    $("#menu").scrollIntoView({ behavior: "smooth" });
    setTimeout(function () { selectTab(t); }, 450);
  });

  /* ---------- mailing list ---------- */
  $("#nl").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("#nlMsg"), email = $("#nlEmail").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = "Please check your email address."; return; }
    msg.textContent = "Adding you…";
    fetch("/api/newsletter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.ok) { msg.textContent = "Thanks, you're on the list."; $("#nlEmail").value = ""; } else msg.textContent = d.error || "That didn't work. Please try again."; })
      .catch(function () { msg.textContent = "No connection. Please try again."; });
  });

  /* ---------- menu screens ---------- */
  var tabs = $("#tabs"), screens = $("#screens");
  function tagHtml(t, flag) { return (flag ? '<span class="tag flag">' + esc(flag) + "</span>" : "") + t.map(function (x) { return '<span class="tag' + (x === "Spicy" ? " hot" : "") + '">' + esc(x) + "</span>"; }).join(""); }
  function renderMenu() {
    tabs.innerHTML = ""; var html = "";
    DATA.menu.forEach(function (sec, si) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "tab"; b.id = "tab-" + sec.id; b.setAttribute("role", "tab"); b.setAttribute("aria-controls", "scr-" + sec.id);
      b.setAttribute("aria-selected", si === 0 ? "true" : "false"); b.tabIndex = si === 0 ? 0 : -1;
      b.innerHTML = esc(sec.name) + "<small>" + sec.items.length + "</small>"; tabs.appendChild(b);
      html += '<div class="screen" id="scr-' + sec.id + '" role="tabpanel" aria-labelledby="tab-' + sec.id + '"' + (si ? " hidden" : "") + '><div class="cover"><img src="' + sec.cover + '" alt="" loading="lazy"><div class="tx"><span class="when">' + esc(sec.when) + "</span><h3>" + esc(sec.name) + "</h3><p>" + esc(sec.blurb) + '</p></div></div><div class="cards">';
      sec.items.forEach(function (it) {
        var sold = !!SOLD[it.id], ref = 'data-id="' + it.id + '"';
        html += '<article class="card' + (sold ? " sold" : "") + '"><button type="button" class="ph" ' + ref + ' aria-label="See details for ' + esc(it.name) + '"' + (sold ? " disabled" : "") + '><img src="' + it.img + '" alt="" loading="lazy"></button><div class="bd"><div class="top"><button type="button" class="nm" ' + ref + (sold ? " disabled" : "") + ">" + esc(it.name) + '</button><span class="price">' + gbp(it.price) + '</span></div><p class="ds">' + esc(it.desc) + '</p><div class="ft"><div class="tags">' + (sold ? '<span class="soldtag">Sold out for today</span>' : tagHtml(it.tags, it.flag)) + "</div>" + (sold ? "" : '<button type="button" class="add" ' + ref + ' aria-label="Add ' + esc(it.name) + '">' + ic("plus") + "Add</button>") + "</div></div></article>";
      });
      html += "</div></div>";
    });
    screens.innerHTML = html;
  }
  function selectTab(btn, focus) {
    tabs.querySelectorAll(".tab").forEach(function (t) { var on = t === btn; t.setAttribute("aria-selected", on ? "true" : "false"); t.tabIndex = on ? 0 : -1; document.getElementById(t.getAttribute("aria-controls")).hidden = !on; });
    if (focus) btn.focus();
    btn.scrollIntoView({ block: "nearest", inline: "nearest" });
    var head = $(".site-head").offsetHeight, tb = $(".tabbar");
    if (tb.getBoundingClientRect().top <= head + 1) window.scrollTo({ top: window.scrollY + screens.getBoundingClientRect().top - head - tb.offsetHeight - 8, behavior: "smooth" });
  }
  tabs.addEventListener("click", function (e) { var b = e.target.closest(".tab"); if (b) selectTab(b); });
  tabs.addEventListener("keydown", function (e) {
    var all = [].slice.call(tabs.querySelectorAll(".tab")), i = all.indexOf(document.activeElement); if (i < 0) return;
    if (e.key === "ArrowRight") { e.preventDefault(); selectTab(all[(i + 1) % all.length], true); }
    if (e.key === "ArrowLeft") { e.preventDefault(); selectTab(all[(i - 1 + all.length) % all.length], true); }
  });

  /* ---------- dish pop-up ---------- */
  var dlg = $("#dish"), cur = null, qty = 1;
  function groups(it) { return it.options.map(function (gid) { return OPTS[gid]; }); }
  function chosen() {
    var out = {}, extra = 0, labels = [];
    dlg.querySelectorAll("#dOpts input:checked").forEach(function (i) {
      var g = i.dataset.g; (out[g] = out[g] || []).push(i.value); extra += Number(i.dataset.p) || 0;
      if (i.dataset.def !== "1") labels.push(i.dataset.l);
    });
    return { options: out, extra: extra, labels: labels };
  }
  function refresh() { var c = chosen(); $("#qOut").textContent = qty; $("#dTotal").textContent = gbp((cur.price + c.extra) * qty); $("#qMinus").disabled = qty <= 1; $("#qPlus").disabled = qty >= 10; }
  function openDish(it) {
    if (!it || SOLD[it.id]) return;
    cur = it; qty = 1;
    var im = $("#dImg"); im.src = it.img; im.alt = it.name;
    $("#dTitle").textContent = it.name; $("#dDesc").textContent = it.desc;
    $("#dTags").innerHTML = tagHtml(it.tags, it.flag);
    $("#dAll").innerHTML = "<b>Allergens:</b> contains " + esc(it.allergens) + ".";
    $("#dOpts").innerHTML = groups(it).map(function (g, gi) {
      return '<fieldset class="opt"><legend>' + esc(g.legend) + (g.hint ? "<small>" + esc(g.hint) + "</small>" : "") + "</legend>" + g.choices.map(function (c, ci) {
        var id = "o" + gi + "_" + ci, one = g.type === "one";
        return '<label class="choice" for="' + id + '"><input id="' + id + '" type="' + (one ? "radio" : "checkbox") + '" name="g' + gi + '" value="' + c.id + '" data-g="' + g.id + '" data-p="' + c.price + '" data-l="' + esc(c.label) + '" data-def="' + (one && ci === 0 ? 1 : 0) + '"' + (one && ci === 0 ? " checked" : "") + ">" + esc(c.label) + '<span class="ex">' + (c.price ? "+" + gbp(c.price) : "") + "</span></label>";
      }).join("") + "</fieldset>";
    }).join("");
    refresh(); openD(dlg); $(".dbody", dlg).scrollTop = 0;
  }
  screens.addEventListener("click", function (e) { var b = e.target.closest("[data-id]"); if (b && !b.disabled) openDish(ITEMS[b.dataset.id]); });
  $("#dOpts").addEventListener("change", refresh);
  $("#qPlus").addEventListener("click", function () { if (qty < 10) { qty++; refresh(); } });
  $("#qMinus").addEventListener("click", function () { if (qty > 1) { qty--; refresh(); } });
  $("#dClose").addEventListener("click", function () { shut(dlg); });
  dlg.addEventListener("click", function (e) { if (e.target === dlg) shut(dlg); });
  $("#dAdd").addEventListener("click", function () {
    var c = chosen();
    order.push({ id: cur.id, qty: qty, options: c.options, labels: c.labels, unit: cur.price + c.extra });
    save(); shut(dlg); bar(); toast(qty + " × " + cur.name + " added to your order");
  });

  /* ---------- order panel ---------- */
  var panel = $("#panel"), pn = $("#pn"), step = "order", slots = null, when = null, busy = false, whenMsg = "", showAll = false;
  function save() { store.set("ff-order", order); }
  var count = function () { return order.reduce(function (a, l) { return a + l.qty; }, 0); };
  var total = function () { return order.reduce(function (a, l) { return a + l.unit * l.qty; }, 0); };
  function bar() {
    var n = count();
    $("#oItems").textContent = n + (n === 1 ? " item" : " items"); $("#oTotal").textContent = gbp(total()); $("#navCount").textContent = n;
    $("#obar").classList.toggle("show", n > 0 && !panel.open);
  }
  function stepper(k) { var s = ["Your order", "Your details", "Confirmed"], ix = { order: 0, details: 1 }[k]; return '<div class="stepper">' + s.map(function (t, i) { return '<span class="' + (i <= ix ? "on" : "") + '">' + t + "</span>"; }).join("") + "</div>"; }
  function head(title, back) { return "<header>" + (back ? '<button type="button" class="back" data-go="' + back + '">' + ic("arrow") + "Back</button>" : '<h3 id="pTitle">' + title + "</h3>") + '<button class="x" type="button" data-close aria-label="Close">' + ic("x") + "</button></header>" + (back ? '<h3 id="pTitle">' + title + "</h3>" : ""); }
  function draw() {
    var n = count();
    if (step === "order") {
      pn.innerHTML = head("Your order") + stepper("order") + (n ? '<ul class="lines">' + order.map(function (l, i) { var it = ITEMS[l.id]; return '<li><img src="' + it.img + '" alt=""><div><b>' + l.qty + " × " + esc(it.name) + "</b><small>" + esc(l.labels.join(", ") || "As it comes") + '</small><button class="rm" type="button" data-rm="' + i + '">Remove</button></div><span class="price">' + gbp(l.unit * l.qty) + "</span></li>"; }).join("") + "</ul>" : '<div class="empty">Your order is empty.<br>Add something from the menu to get started.</div>') +
        '<div class="tot"><span>Total to pay at pickup</span><b>' + gbp(total()) + "</b></div>" +
        (n ? '<button class="btn btn-primary wide" type="button" data-go="details">Continue ' + ic("arrow") + "</button>" : '<button class="btn btn-dark wide" type="button" data-close>Browse the menu</button>');
      return;
    }
    // details
    var slotHtml;
    if (!slots) slotHtml = '<p class="loading">Finding pickup times…</p>';
    else if (slots.paused || (!slots.asap && !slots.slots.length)) slotHtml = '<div class="notice">' + ic("alert") + "<span>" + esc(slots.message || "There are no pickup times left right now. Please check back later.") + "</span></div>";
    else {
      var dayName = slots.day.label === "today" ? "Later today" : slots.day.label.charAt(0).toUpperCase() + slots.day.label.slice(1);
      slotHtml = '<div class="slots" role="group" aria-label="Pickup time">' +
        (slots.asap ? '<button type="button" class="slot slot-asap" data-asap="1" aria-pressed="' + (when && when.asap ? "true" : "false") + '">As soon as possible<small>about ' + slots.asap.waitMin + " minutes</small></button>" : "") +
        '</div><p class="slothead">' + esc(dayName) + '</p><div class="slots" role="group" aria-label="' + esc(dayName) + '">' +
        slots.slots.map(function (s, i) {
          var tooSmall = !s.full && s.left < n, on = when && !when.asap && when.min === s.min;
          // Show the first nine times; the rest sit behind "Show later times" (unless one of them is chosen).
          var hide = !showAll && i >= 9 && !on;
          return '<button type="button" class="slot" data-min="' + s.min + '" aria-pressed="' + on + '"' + (s.full || tooSmall ? " disabled" : "") + (hide ? " hidden" : "") + ">" + s.label + "<small>" + (s.full ? "Fully booked" : tooSmall ? "Not enough room" : s.left <= 4 ? "Almost full" : "") + "</small></button>";
        }).join("") + "</div>" +
        (!showAll && slots.slots.length > 9 ? '<button type="button" class="back" data-more="1" style="margin-top:4px">Show later times</button>' : "");
    }
    pn.innerHTML = head("Your details", "order") + stepper("details") +
      '<div class="field"><span style="font-weight:600;font-size:14.5px">When would you like to collect?</span>' + slotHtml + '<p class="err" id="eWhen"' + (whenMsg ? "" : " hidden") + ">" + esc(whenMsg) + "</p></div>" +
      '<div class="field"><label for="fName">Your name</label><input id="fName" autocomplete="given-name" maxlength="60" value="' + esc(info.name) + '" placeholder="We\'ll call this out when it\'s ready"><p class="err" id="eName" hidden></p></div>' +
      '<div class="field"><label for="fPhone">Phone number</label><input id="fPhone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="' + esc(info.phone) + '" placeholder="07123 456789"><p class="err" id="ePhone" hidden></p></div>' +
      '<div class="field"><label for="fEmail">Email <small>(optional, for updates and your receipt)</small></label><input id="fEmail" type="email" autocomplete="email" maxlength="120" value="' + esc(info.email) + '"><p class="err" id="eEmail" hidden></p></div>' +
      '<div class="field"><label for="fNotes">Notes for the kitchen <small>(optional)</small></label><textarea id="fNotes" maxlength="300" placeholder="Allergies or anything else we should know">' + esc(info.notes) + "</textarea></div>" +
      '<div class="tot"><span>' + n + (n === 1 ? " item" : " items") + ", pay at pickup</span><b>" + gbp(total()) + "</b></div>" +
      '<p class="notice err form-error" id="eForm" hidden></p>' +
      '<button class="btn btn-primary wide" type="button" id="place"' + (busy ? " disabled" : "") + ">" + (busy ? "Sending your order…" : "Place order") + '</button><p class="fine">By placing your order you agree to collect and pay for it at the counter. We use your details only for this order. <a href="/privacy" target="_blank" style="text-decoration:underline">Privacy</a></p>';
  }
  function loadSlots() {
    slots = null; draw();
    fetch("/api/slots").then(function (r) { return r.json(); }).then(function (s) {
      slots = s;
      if (when && when.asap && !s.asap) when = null;
      if (when && !when.asap && !(s.day && s.day.date === when.day && s.slots.some(function (x) { return x.min === when.min && !x.full && x.left >= count(); }))) when = null;
      // Use the time picked in the order-ahead band, if it is still free and big enough.
      if (!when && preferred) {
        if (preferred.asap && s.asap) when = { asap: true };
        else if (!preferred.asap && s.day && s.day.date === preferred.day && s.slots.some(function (x) { return x.min === preferred.min && !x.full && x.left >= count(); })) {
          when = { day: preferred.day, min: preferred.min };
          showAll = showAll || s.slots.findIndex(function (x) { return x.min === preferred.min; }) >= 9;
        }
      }
      if (!when && s.asap) when = { asap: true };
      if (step === "details") draw();
    }).catch(function () { slots = { paused: true, message: "We couldn't load pickup times. Please check your connection and try again.", slots: [] }; if (step === "details") draw(); });
  }
  function saveInfo() { ["Name", "Phone", "Email", "Notes"].forEach(function (k) { var el = document.getElementById("f" + k); if (el) info[k.toLowerCase()] = el.value; }); store.set("ff-details", { name: info.name, phone: info.phone, email: info.email }); }
  function showErr(field, msg) {
    var map = { name: ["eName", "fName"], phone: ["ePhone", "fPhone"], email: ["eEmail", "fEmail"], when: ["eWhen"] };
    ["eName", "ePhone", "eEmail", "eWhen", "eForm"].forEach(function (id) { var e = document.getElementById(id); if (e) e.hidden = true; });
    ["fName", "fPhone", "fEmail"].forEach(function (id) { var e = document.getElementById(id); if (e) e.removeAttribute("aria-invalid"); });
    var m = map[field] || ["eForm"], e = document.getElementById(m[0]);
    e.textContent = msg; e.hidden = false;
    if (m[1]) { var inp = document.getElementById(m[1]); inp.setAttribute("aria-invalid", "true"); inp.focus(); } else e.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function place() {
    saveInfo();
    if (!info.name.trim()) return showErr("name", "Please add your name so we know whose order it is.");
    if (!/^(\+44\s?|0)\d[\d\s]{8,12}$/.test(info.phone.trim())) return showErr("phone", "Please add a UK phone number, in case we need to reach you.");
    if (info.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(info.email.trim())) return showErr("email", "That email address doesn't look quite right.");
    if (!when) return showErr("when", "Please choose when you'd like to collect.");
    busy = true; $("#place").disabled = true; $("#place").textContent = "Sending your order…";
    var payload = { name: info.name, phone: info.phone, email: info.email, notes: info.notes, when: when.asap ? { asap: true } : { day: when.day, min: when.min }, lines: order.map(function (l) { return { id: l.id, qty: l.qty, options: l.options }; }) };
    fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        busy = false;
        if (res.ok && res.d.token) {
          var mine = store.get("ff-mine", []); mine.unshift({ token: res.d.token, number: res.d.number, at: Date.now() }); store.set("ff-mine", mine.slice(0, 5));
          order = []; save(); location.href = "/order/" + res.d.token; return;
        }
        $("#place").disabled = false; $("#place").textContent = "Place order";
        // A slot can fill up while you check out. Keep the message on screen while fresh times load.
        if (res.d.field === "when") { whenMsg = res.d.error + " We've refreshed the times below."; when = null; saveInfo(); loadSlots(); return; }
        showErr(res.d.field, res.d.error || "Something went wrong. Please try again.");
      })
      .catch(function () { busy = false; $("#place").disabled = false; $("#place").textContent = "Place order"; showErr(null, "We couldn't send your order. Please check your connection and try again."); });
  }
  function openPanel() { step = "order"; whenMsg = ""; showAll = false; draw(); openD(panel); $("#obar").classList.remove("show"); }
  $("#oOpen").addEventListener("click", openPanel);
  $("#navOrder").addEventListener("click", openPanel);
  panel.addEventListener("close", bar);
  // Clear a field's error as soon as the guest starts fixing it.
  panel.addEventListener("input", function (e) {
    var el = e.target; if (!el.id || el.getAttribute("aria-invalid") !== "true") return;
    el.removeAttribute("aria-invalid");
    var err = document.getElementById("e" + el.id.slice(1)); if (err) err.hidden = true;
  });
  panel.addEventListener("click", function (e) {
    if (e.target === panel) { saveInfo(); shut(panel); return; }
    var t = e.target.closest("button"); if (!t || t.disabled) return;
    if (t.hasAttribute("data-close")) { if (step === "details") saveInfo(); shut(panel); if (!count()) $("#menu").scrollIntoView({ behavior: "smooth" }); return; }
    if (t.dataset.rm !== undefined) { order.splice(+t.dataset.rm, 1); save(); draw(); bar(); return; }
    if (t.dataset.go) { if (step === "details") saveInfo(); step = t.dataset.go; if (step === "details") loadSlots(); else draw(); pn.scrollTop = 0; return; }
    if (t.dataset.more) { saveInfo(); showAll = true; draw(); return; }
    if (t.dataset.asap) { saveInfo(); when = { asap: true }; whenMsg = ""; draw(); return; }
    if (t.dataset.min) { saveInfo(); when = { day: slots.day.date, min: Number(t.dataset.min) }; whenMsg = ""; draw(); return; }
    if (t.id === "place") place();
  });

  /* ---------- header link highlight ---------- */
  var links = [].slice.call(document.querySelectorAll(".links a"));
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) links.forEach(function (a) { a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id); }); }); }, { rootMargin: "-40% 0px -55% 0px" });
    links.forEach(function (a) { var el = document.getElementById(a.getAttribute("href").slice(1)); if (el) io.observe(el); });
  }

  bar(); load();
})();
