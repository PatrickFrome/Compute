// ME2 extension «mirror-digest» — образец расширения exthost (R60, канон VS Code
// extension host: расширение видит только API-поверхность, не ядро). У нас
// API-поверхность = ТОЛЬКО stdio (newline-delimited JSON):
//   хост → расширение: {"op":"initialize","proto":1,...}   → ack {"ok":true,...}
//                      {"op":"ping"}                       → {"ok":true,"pong":true}
//                      {"op":"run","caps":{...}}           → {"ok":true,"result":{...}}
// Правила изоляции (проверяются eval'ом): НИКАКИХ require/import, НИКАКОЙ сети —
// данные доставляет хост по caps-медиации ("mirror.feed.read"). Процесс гоняется
// под prlimit (--as=1GiB --nofile=256 --core=0) с env-белым-списком.
"use strict";
var buf = "";
function reply(o) { process.stdout.write(JSON.stringify(o) + "\n"); }

function digest(caps) {
  var feed = (caps || {})["mirror.feed.read"] || {};
  var rows = Array.isArray(feed.rows) ? feed.rows : [];
  var byType = {};
  var lastSeq = null;
  rows.forEach(function (r) {
    var t = String((r && r.type) || "?");
    byType[t] = (byType[t] || 0) + 1;
    if (typeof (r && r.seq) === "number" && (lastSeq === null || r.seq > lastSeq)) lastSeq = r.seq;
  });
  var top = Object.keys(byType)
    .map(function (k) { return [k, byType[k]]; })
    .sort(function (a, b) { return b[1] - a[1]; })
    .slice(0, 5)
    .map(function (p) { return p[0] + ":" + p[1]; })
    .join(" ");
  return {
    feed_ok: feed.ok === true,
    rows: rows.length,
    last_seq: lastSeq,
    by_type: byType,
    top: top,
    mirror_state: (feed && feed.state) || null,
    feed_error: (feed && feed.error) || null
  };
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", function (d) {
  buf += d;
  var i;
  while ((i = buf.indexOf("\n")) >= 0) {
    var line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    var msg = null;
    try { msg = JSON.parse(line); } catch (e) { reply({ ok: false, error: "bad_json" }); continue; }
    if (msg.op === "initialize") reply({ ok: true, proto: 1, ext: "mirror-digest", caps: ["mirror.feed.read"] });
    else if (msg.op === "ping") reply({ ok: true, pong: true });
    else if (msg.op === "run") {
      try { reply({ ok: true, result: digest(msg.caps) }); }
      catch (e) { reply({ ok: false, error: String((e && e.message) || e) }); }
    } else reply({ ok: false, error: "unknown_op" });
  }
});
process.stdin.on("end", function () { process.exit(0); });
