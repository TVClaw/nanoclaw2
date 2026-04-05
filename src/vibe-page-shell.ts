const PHONE_REMOTE_MARK = '<!-- nanoclaw:phone-remote -->';

export function shouldWrapVibePage(html: string): boolean {
  const t = html.trimStart();
  if (t.startsWith('<!-- nanoclaw:no-vibe-shell -->')) return false;
  return t.startsWith(PHONE_REMOTE_MARK);
}

export function wrapVibePageHtml(innerHtml: string): string {
  let embed = innerHtml.trimStart();
  if (embed.startsWith(PHONE_REMOTE_MARK)) {
    embed = embed.slice(PHONE_REMOTE_MARK.length).trimStart();
  }
  const embedLiteral = JSON.stringify(embed).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TVClaw</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; background: #06070d; }
#vibeGateC {
  position: fixed;
  inset: 0;
  z-index: 2;
  display: block;
  width: 100vw;
  height: 100vh;
  background: #06070d;
}
#vibeFrame { position: fixed; inset: 0; z-index: 1; border: 0; width: 100%; height: 100%; visibility: hidden; }
#vibeFrame.show { z-index: 3; visibility: visible; }
</style>
</head>
<body>
<canvas id="vibeGateC" tabindex="0" aria-label="Scan QR for phone remote"></canvas>
<iframe id="vibeFrame" title="Game" sandbox="allow-scripts allow-same-origin"></iframe>
<script>
(function () {
  var EMBED = ${embedLiteral};
  var gateEl = document.getElementById('vibeGateC');
  var ctx = gateEl.getContext('2d');
  var frame = document.getElementById('vibeFrame');
  var started = false;

  function sizeGate() {
    gateEl.width = innerWidth;
    gateEl.height = innerHeight;
  }
  sizeGate();
  addEventListener('resize', sizeGate);

  var remoteUrl = location.protocol + '//' + location.host + '/keypad';
  var qrImg = new Image();
  qrImg.crossOrigin = 'anonymous';
  qrImg.src =
    'https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=' +
    encodeURIComponent(remoteUrl);

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function dismissGate() {
    if (started) return;
    started = true;
    gateEl.style.display = 'none';
    frame.srcdoc = EMBED;
    frame.classList.add('show');
    try {
      frame.focus();
    } catch (e) {}
  }

  function onRemoteCmd(cmd) {
    if (cmd === 'start' || cmd === 'ok' || cmd === 'a') dismissGate();
  }

  function connectSse() {
    var es = new EventSource(
      location.protocol + '//' + location.host + '/vibe-key-sse',
    );
    es.onerror = function () {
      try {
        es.close();
      } catch (e) {}
      setTimeout(connectSse, 2000);
    };
    es.onmessage = function (e) {
      onRemoteCmd(String(e.data || '').trim().toLowerCase());
    };
  }
  connectSse();

  addEventListener(
    'keydown',
    function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        dismissGate();
      }
    },
    true,
  );

  function drawGate() {
    if (started) return;
    var W = gateEl.width;
    var H = gateEl.height;
    ctx.fillStyle = '#06070d';
    ctx.fillRect(0, 0, W, H);
    var qrSize = Math.max(180, Math.min(300, Math.floor(Math.min(W, H) * 0.27)));
    var qrX = W / 2 - qrSize / 2;
    var qrY = H / 2 - 50 - qrSize / 2;
    ctx.fillStyle = 'rgba(10,14,28,0.9)';
    roundRect(qrX - 18, qrY - 18, qrSize + 36, qrSize + 36, 18);
    ctx.fillStyle = '#ffffff';
    roundRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16, 12);
    if (qrImg.complete && qrImg.naturalWidth > 0) {
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#00d4ff';
    ctx.shadowBlur = 28;
    ctx.font = 'bold 56px monospace';
    ctx.fillStyle = '#00d4ff';
    ctx.fillText('TVClaw', W / 2, qrY - 52);
    ctx.shadowBlur = 0;
    ctx.font = '26px monospace';
    ctx.fillStyle = 'rgba(160,180,255,0.75)';
    ctx.fillText('Scan to open gamepad on phone', W / 2, qrY + qrSize + 42);
    ctx.font = '18px monospace';
    ctx.fillStyle = 'rgba(140,165,245,0.65)';
    ctx.fillText(remoteUrl, W / 2, qrY + qrSize + 74);
    ctx.font = '22px monospace';
    ctx.fillStyle = 'rgba(180,200,255,0.78)';
    ctx.fillText('Then press START on the gamepad', W / 2, qrY + qrSize + 106);
    requestAnimationFrame(drawGate);
  }
  requestAnimationFrame(drawGate);
})();
</script>
</body>
</html>
`;
}
