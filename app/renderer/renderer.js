// Renderer: wires the UI to main (browser + agent) and connects LiveKit voice.
const $ = (id) => document.getElementById(id);
const thread = $('thread');
const empty = $('empty');

// ── Address bar ────────────────────────────────────────────────
$('url').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const v = $('url').value.trim();
  if (!v) return;
  // A question goes to the AI; anything else is treated as navigation.
  if (/\s/.test(v) && /[?]$|^(who|what|where|find|search|open|go|show|is|can|how)\b/i.test(v)) {
    ask(v);
  } else {
    window.godmode.nav(v);
  }
});
$('back').onclick = () => window.godmode.back();
$('fwd').onclick = () => window.godmode.forward();
$('reload').onclick = () => window.godmode.reload();

window.godmode.onViewState((s) => {
  if (document.activeElement !== $('url')) $('url').value = s.url === 'about:blank' ? '' : s.url;
  $('back').disabled = !s.canGoBack;
  $('fwd').disabled = !s.canGoForward;
});

// ── Transcript ─────────────────────────────────────────────────
function addMsg(kind, html, who) {
  if (empty) empty.remove();
  const el = document.createElement('div');
  el.className = `msg ${kind}`;
  el.innerHTML = `${who ? `<div class="who">${who}</div>` : ''}<div class="bubble">${html}</div>`;
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
  return el;
}
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

window.godmode.onAgentEvent((evt) => {
  if (evt.type === 'assistant') addMsg('ai', esc(evt.text), 'GOD MODE');
  else if (evt.type === 'tool') addMsg('tool', `<b>${esc(evt.name)}</b> ${esc(JSON.stringify(evt.input))}`);
  else if (evt.type === 'error') addMsg('ai', `⚠ ${esc(evt.text)}`, 'GOD MODE');
});

// ── Composer / ask ─────────────────────────────────────────────
async function ask(text) {
  const msg = (text ?? $('ask').value).trim();
  if (!msg) return;
  $('ask').value = '';
  addMsg('user', esc(msg), 'You');
  const res = await window.godmode.ask(msg);
  if (!res.ok) addMsg('ai', `⚠ ${esc(res.error)}`, 'GOD MODE');
}
$('send').onclick = () => ask();
$('ask').addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });

// ── Voice (LiveKit) ────────────────────────────────────────────
let room = null;
const orb = $('orb');
const vstatus = $('vstatus');
function setVoice(state, text) {
  vstatus.className = `status ${state}`;
  vstatus.textContent = text;
  orb.classList.toggle('live', state === 'on');
}

orb.onclick = async () => {
  if (room) { await room.disconnect(); room = null; setVoice('off', 'Voice offline'); return; }
  setVoice('', 'Connecting…');
  let LiveKit;
  try { LiveKit = await import('../node_modules/livekit-client/dist/livekit-client.esm.mjs'); }
  catch { setVoice('off', 'Run npm install'); return; }

  const cfg = await window.godmode.voiceConfig();
  if (!cfg.configured) { setVoice('off', 'Set LIVEKIT_URL + Living Labs token'); return; }

  try {
    room = new LiveKit.Room({ adaptiveStream: true });
    room.on(LiveKit.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === 'audio') track.attach(); // play the agent's voice
    });
    room.on(LiveKit.RoomEvent.DataReceived, (payload) => {
      try {
        const d = JSON.parse(new TextDecoder().decode(payload));
        if (d.text) addMsg(d.role === 'user' ? 'user' : 'ai', esc(d.text), d.role === 'user' ? 'You' : 'GOD MODE');
      } catch {}
    });
    room.on(LiveKit.RoomEvent.Disconnected, () => { room = null; setVoice('off', 'Voice offline'); });
    await room.connect(cfg.url, cfg.token);
    await room.localParticipant.setMicrophoneEnabled(true);
    setVoice('on', 'Listening');
  } catch (err) {
    room = null;
    setVoice('off', 'Voice error');
  }
};
