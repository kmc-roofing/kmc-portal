/* KMC Field notifications add-on.
   Self-contained: adds a bell button, an inbox, per-event settings and web-push enrollment on top of the
   compiled app. It only talks to Supabase with the signed-in user's own session, and it never throws
   into the app (everything is wrapped). */
(function () {
  "use strict";
  try {
    var SB = "https://ohucgckgwpadjgkkjpax.supabase.co";
    var ANON = "sb_publishable_jC9euGa_BlDGH5Nd8Srhyg_nk-4YtEz";
    var VAPID_PUB = "BKfubEV7RZJsaQPYYZ-nucTvnAB1enVR-sdOZ6c2Wv7x1RtrJGlAW9X14NjAYy-DtH28CA1HLb-IC1I3wz3159o";
    var APP = "/kmc-portal/app/";
    var state = { me: null, role: null, events: [], prefs: {}, items: [], tab: "inbox", open: false, sub: null, busy: false, msg: "" };
    var root = null, bell = null, badge = null;

    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

    function session() {
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (/^sb-.*-auth-token$/.test(k)) {
            var s = JSON.parse(localStorage.getItem(k));
            if (s && s.access_token && s.user && s.user.id) return s;
          }
        }
      } catch (e) {}
      return null;
    }

    function api(path, opts) {
      var s = session();
      if (!s) return Promise.reject(new Error("not signed in"));
      opts = opts || {};
      var h = { apikey: ANON, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json" };
      for (var k in (opts.headers || {})) h[k] = opts.headers[k];
      return fetch(SB + path, { method: opts.method || "GET", headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(t || r.status); });
        return r.status === 204 ? null : r.text().then(function (t) { return t ? JSON.parse(t) : null; });
      });
    }

    function b64ToU8(b64) {
      var p = "=".repeat((4 - (b64.length % 4)) % 4);
      var raw = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/"));
      var out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    }

    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    var pushOK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

    function ago(iso) {
      var d = (Date.now() - new Date(iso).getTime()) / 1000;
      if (d < 60) return "just now";
      if (d < 3600) return Math.floor(d / 60) + " min ago";
      if (d < 86400) return Math.floor(d / 3600) + " hr ago";
      var dt = new Date(iso);
      return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][dt.getMonth()] + " " + dt.getDate();
    }

    function css() {
      var st = document.createElement("style");
      st.textContent =
        "#kmcn-bell{position:fixed;z-index:2147483000;right:12px;top:calc(env(safe-area-inset-top,0px) + 10px);width:42px;height:42px;border-radius:21px;border:0;background:#1f3a5f;color:#fff;font-size:20px;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer}" +
        "#kmcn-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:#d93025;color:#fff;font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 4px}" +
        "#kmcn-ov{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.45);display:none}" +
        "#kmcn-sheet{position:absolute;right:0;top:0;bottom:0;width:100%;max-width:480px;background:#f4f5f7;display:flex;flex-direction:column;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1f24}" +
        "#kmcn-head{background:#1f3a5f;color:#fff;padding:calc(env(safe-area-inset-top,0px) + 12px) 14px 10px;display:flex;align-items:center;justify-content:space-between;font-size:18px;font-weight:700}" +
        "#kmcn-head button{background:transparent;border:0;color:#fff;font-size:26px;line-height:1;padding:0 6px;cursor:pointer}" +
        "#kmcn-tabs{display:flex;background:#fff;border-bottom:1px solid #e1e4e8}" +
        "#kmcn-tabs button{flex:1;padding:12px;border:0;background:#fff;font-size:15px;font-weight:600;color:#6b7280;border-bottom:3px solid transparent;cursor:pointer}" +
        "#kmcn-tabs button.on{color:#1f3a5f;border-bottom-color:#1f3a5f}" +
        "#kmcn-body{flex:1;overflow:auto;padding:12px 12px calc(env(safe-area-inset-bottom,0px) + 24px)}" +
        ".kmcn-card{background:#fff;border:1px solid #e1e4e8;border-radius:10px;padding:12px;margin-bottom:10px}" +
        ".kmcn-item{display:block;width:100%;text-align:left;background:#fff;border:1px solid #e1e4e8;border-radius:10px;padding:11px 12px;margin-bottom:8px;cursor:pointer}" +
        ".kmcn-item.unread{border-left:4px solid #1f3a5f;background:#f0f5fb}" +
        ".kmcn-item b{display:block;font-size:15px}.kmcn-item span{display:block;font-size:14px;color:#374151;margin-top:2px}.kmcn-item i{display:block;font-size:12px;color:#6b7280;margin-top:4px;font-style:normal}" +
        ".kmcn-btn{background:#1f3a5f;color:#fff;border:0;border-radius:8px;padding:12px 16px;font-size:16px;width:100%;cursor:pointer}" +
        ".kmcn-btn.sec{background:#fff;color:#1f3a5f;border:1px solid #1f3a5f;margin-top:8px}.kmcn-btn:disabled{opacity:.55}" +
        ".kmcn-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #eef0f2}.kmcn-row:last-child{border-bottom:0}" +
        ".kmcn-row b{font-size:15px;display:block}.kmcn-row small{font-size:12.5px;color:#6b7280;display:block;margin-top:1px}" +
        ".kmcn-sw{position:relative;width:48px;height:28px;flex:none}.kmcn-sw input{opacity:0;width:100%;height:100%;position:absolute;margin:0;cursor:pointer;z-index:2}" +
        ".kmcn-sw u{position:absolute;inset:0;background:#c9ced6;border-radius:14px;transition:.15s}.kmcn-sw u:after{content:'';position:absolute;left:3px;top:3px;width:22px;height:22px;background:#fff;border-radius:11px;transition:.15s}" +
        ".kmcn-sw input:checked+u{background:#2ca01c}.kmcn-sw input:checked+u:after{left:23px}" +
        ".kmcn-note{font-size:13px;color:#6b7280;margin:6px 0 0}.kmcn-ok{color:#1a7f37;font-weight:600}.kmcn-warn{color:#b42318}";
      document.head.appendChild(st);
    }

    function build() {
      css();
      bell = document.createElement("button");
      bell.id = "kmcn-bell"; bell.type = "button"; bell.setAttribute("aria-label", "Notifications");
      bell.innerHTML = "&#128276;<span id=\"kmcn-badge\"></span>";
      bell.onclick = function () { openPanel("inbox"); };
      badge = bell.querySelector("#kmcn-badge");
      document.body.appendChild(bell);
      root = document.createElement("div");
      root.id = "kmcn-ov";
      root.onclick = function (e) { if (e.target === root) closePanel(); };
      document.body.appendChild(root);
    }

    function unreadCount() { return state.items.filter(function (n) { return !n.read_at; }).length; }
    function paintBadge() {
      if (!badge) return;
      var n = unreadCount();
      badge.style.display = n ? "flex" : "none";
      badge.textContent = n > 99 ? "99+" : String(n);
    }

    function loadInbox() {
      return api("/rest/v1/notifications?select=id,event_key,title,body,created_at,read_at&order=created_at.desc&limit=40").then(function (rows) {
        state.items = rows || []; paintBadge();
      }).catch(function () {});
    }

    function loadSettings() {
      return Promise.all([
        api("/rest/v1/notification_events?select=key,label,description,audience,default_roles,sort&order=sort.asc"),
        api("/rest/v1/notification_prefs?select=event_key,enabled")
      ]).then(function (r) {
        state.events = (r[0] || []).filter(function (e) { return e.audience.indexOf(state.role) !== -1; });
        state.prefs = {};
        (r[1] || []).forEach(function (p) { state.prefs[p.event_key] = p.enabled; });
      });
    }

    function effective(ev) {
      if (Object.prototype.hasOwnProperty.call(state.prefs, ev.key)) return state.prefs[ev.key];
      return ev.default_roles.indexOf(state.role) !== -1;
    }

    function refreshSub() {
      if (!pushOK) { state.sub = null; return Promise.resolve(); }
      return navigator.serviceWorker.getRegistration(APP).then(function (reg) {
        return reg ? reg.pushManager.getSubscription() : null;
      }).then(function (s) { state.sub = s; }).catch(function () { state.sub = null; });
    }

    function enablePush() {
      state.busy = true; state.msg = ""; render();
      if (!pushOK) { state.busy = false; state.msg = isIOS ? "On iPhone, add KMC Field to your Home Screen first (Share, then Add to Home Screen), then open it from the icon and try again." : "This browser does not support push notifications."; render(); return; }
      Notification.requestPermission().then(function (perm) {
        if (perm !== "granted") throw new Error("Notifications are blocked. Allow them for KMC Field in your phone or browser settings, then try again.");
        return navigator.serviceWorker.register(APP + "sw.js", { scope: APP });
      }).then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
        return reg.pushManager.getSubscription().then(function (s) {
          return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID_PUB) });
        });
      }).then(function (sub) {
        var j = sub.toJSON();
        return api("/rest/v1/rpc/register_push", { method: "POST", body: { p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent } }).then(function () { state.sub = sub; });
      }).then(function () {
        state.msg = "Push notifications are on for this device.";
      }).catch(function (e) {
        state.msg = (e && e.message) ? e.message : "Could not turn on notifications.";
      }).then(function () { state.busy = false; render(); });
    }

    function disablePush() {
      state.busy = true; render();
      var ep = state.sub && state.sub.endpoint;
      (state.sub ? state.sub.unsubscribe() : Promise.resolve()).then(function () {
        return ep ? api("/rest/v1/rpc/unregister_push", { method: "POST", body: { p_endpoint: ep } }) : null;
      }).then(function () { state.sub = null; state.msg = "Push notifications are off for this device."; }).catch(function () {}).then(function () { state.busy = false; render(); });
    }

    function sendTest() {
      state.msg = "Sending a test..."; render();
      api("/rest/v1/rpc/send_test_push", { method: "POST", body: {} }).then(function () {
        state.msg = state.sub ? "Test sent. It should arrive in a few seconds." : "Test added to your inbox. Turn on push for this device to get it as a notification.";
        render(); setTimeout(loadInbox, 2500);
      }).catch(function () { state.msg = "Could not send the test."; render(); });
    }

    function setPref(key, on) {
      state.prefs[key] = on;
      api("/rest/v1/notification_prefs?on_conflict=user_id,event_key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: [{ user_id: state.me, event_key: key, enabled: on }] }).catch(function () { state.msg = "Could not save that setting."; render(); });
    }

    function markRead(id) {
      var it = state.items.filter(function (n) { return n.id === id; })[0];
      if (!it || it.read_at) return;
      it.read_at = new Date().toISOString(); paintBadge(); render();
      api("/rest/v1/notifications?id=eq." + id, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { read_at: it.read_at } }).catch(function () {});
    }
    function markAll() {
      var now = new Date().toISOString();
      state.items.forEach(function (n) { if (!n.read_at) n.read_at = now; });
      paintBadge(); render();
      api("/rest/v1/notifications?read_at=is.null", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { read_at: now } }).catch(function () {});
    }

    function pushCard() {
      var h = '<div class="kmcn-card"><b>Push notifications on this device</b>';
      if (!pushOK) {
        h += '<p class="kmcn-note kmcn-warn">' + (isIOS && !standalone ? "On iPhone, push works from the Home Screen app. Tap Share, then Add to Home Screen, open KMC Field from the new icon, and come back here." : "This browser does not support push notifications.") + "</p>";
      } else if (Notification.permission === "denied") {
        h += '<p class="kmcn-note kmcn-warn">Notifications are blocked for KMC Field. Allow them in your phone or browser settings, then reopen this screen.</p>';
      } else if (state.sub) {
        h += '<p class="kmcn-note kmcn-ok">On for this device.</p><button class="kmcn-btn sec" id="kmcn-test"' + (state.busy ? " disabled" : "") + ">Send a test notification</button>" +
          '<button class="kmcn-btn sec" id="kmcn-off"' + (state.busy ? " disabled" : "") + ">Turn off on this device</button>";
      } else {
        h += '<p class="kmcn-note">Get an alert on this phone when something happens, even when the app is closed.</p><button class="kmcn-btn" id="kmcn-on"' + (state.busy ? " disabled" : "") + ">" + (state.busy ? "Working..." : "Turn on notifications") + "</button>";
      }
      if (state.msg) h += '<p class="kmcn-note">' + esc(state.msg) + "</p>";
      return h + "</div>";
    }

    function render() {
      if (!root) return;
      if (!state.open) { root.style.display = "none"; return; }
      root.style.display = "block";
      var h = '<div id="kmcn-sheet"><div id="kmcn-head"><span>Notifications</span><button id="kmcn-x" aria-label="Close">&times;</button></div>' +
        '<div id="kmcn-tabs"><button data-t="inbox" class="' + (state.tab === "inbox" ? "on" : "") + '">Inbox' + (unreadCount() ? " (" + unreadCount() + ")" : "") + '</button><button data-t="settings" class="' + (state.tab === "settings" ? "on" : "") + '">Settings</button></div><div id="kmcn-body">';
      if (state.tab === "inbox") {
        if (unreadCount()) h += '<button class="kmcn-btn sec" id="kmcn-all" style="margin:0 0 10px">Mark all as read</button>';
        if (!state.items.length) h += '<div class="kmcn-card"><span class="kmcn-note">Nothing yet. You will see signed proposals, payments, inspections and more here.</span></div>';
        state.items.forEach(function (n) {
          h += '<button class="kmcn-item' + (n.read_at ? "" : " unread") + '" data-id="' + esc(n.id) + '"><b>' + esc(n.title) + "</b><span>" + esc(n.body) + "</span><i>" + esc(ago(n.created_at)) + "</i></button>";
        });
      } else {
        h += pushCard() + '<div class="kmcn-card"><b>What to notify me about</b><p class="kmcn-note">You get these for customers and jobs you own' + (state.role === "admin" ? ", plus company-wide alerts for the items you turn on" : "") + ".</p>";
        state.events.forEach(function (ev) {
          h += '<div class="kmcn-row"><div><b>' + esc(ev.label) + "</b><small>" + esc(ev.description) + '</small></div><label class="kmcn-sw"><input type="checkbox" data-k="' + esc(ev.key) + '"' + (effective(ev) ? " checked" : "") + "><u></u></label></div>";
        });
        h += "</div>";
      }
      h += "</div></div>";
      root.innerHTML = h;
      root.querySelector("#kmcn-x").onclick = closePanel;
      Array.prototype.forEach.call(root.querySelectorAll("#kmcn-tabs button"), function (b) { b.onclick = function () { state.tab = b.getAttribute("data-t"); state.msg = ""; if (state.tab === "settings") { Promise.all([loadSettings(), refreshSub()]).then(render); } render(); }; });
      Array.prototype.forEach.call(root.querySelectorAll(".kmcn-item"), function (b) { b.onclick = function () { markRead(b.getAttribute("data-id")); }; });
      Array.prototype.forEach.call(root.querySelectorAll("input[data-k]"), function (c) { c.onchange = function () { setPref(c.getAttribute("data-k"), c.checked); }; });
      var on = root.querySelector("#kmcn-on"); if (on) on.onclick = enablePush;
      var off = root.querySelector("#kmcn-off"); if (off) off.onclick = disablePush;
      var ts = root.querySelector("#kmcn-test"); if (ts) ts.onclick = sendTest;
      var al = root.querySelector("#kmcn-all"); if (al) al.onclick = markAll;
    }

    function openPanel(tab) {
      state.open = true; state.tab = tab || "inbox"; state.msg = ""; render();
      loadInbox().then(render);
      Promise.all([loadSettings(), refreshSub()]).then(render).catch(function () {});
    }
    function closePanel() { state.open = false; render(); }

    function init() {
      var s = session();
      if (!s) { if (bell) bell.style.display = "none"; return; }
      if (state.me === s.user.id && bell) { bell.style.display = "flex"; return; }
      api("/rest/v1/profiles?id=eq." + s.user.id + "&select=role,active").then(function (rows) {
        var p = rows && rows[0];
        if (!p || (p.role !== "admin" && p.role !== "sales") || p.active === false) { if (bell) bell.style.display = "none"; return; }
        state.me = s.user.id; state.role = p.role;
        if (!bell) build();
        bell.style.display = "flex";
        loadInbox();
        if (pushOK && Notification.permission === "granted") { navigator.serviceWorker.register(APP + "sw.js", { scope: APP }).catch(function () {}); }
        if (/[?&]inbox=1/.test(location.search)) openPanel("inbox");
      }).catch(function () {});
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", function (e) { if (e.data && e.data.type === "kmc-open-inbox" && state.me) openPanel("inbox"); });
    }
    setInterval(init, 4000);
    setInterval(function () { if (state.me) loadInbox().then(function () { if (state.open && state.tab === "inbox") render(); }); }, 60000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden && state.me) loadInbox(); });
    init();
  } catch (e) { /* never break the app */ }
})();
