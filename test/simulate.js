// Runs song_jam_router.js against a simulated Live: bar-quantised launches, is_triggered
// notifications, transport. This tests the router's logic only, not Ableton's behaviour.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const SRC = fs.readFileSync(path.join(__dirname, '../device/song_jam_router.js'), 'utf8');
const NAMES = { 3:'INTRO-JAM-1',5:'INTRO-JAM-2',6:'INTRO',8:'VERSE-1-JAM',10:'VERSE 1',12:'CHORUS-1-JAM',14:'CHORUS 1',16:'VERSE-INTERLUDE-JAM',17:'VERSE INTERLUDE',19:'VERSE-2-JAM',20:'VERSE 2',22:'CHORUS-2-JAM',23:'CHORUS 2',25:'BREAKDOWN-JAM',26:'BREAKDOWN',28:'CHORUS-3-JAM',29:'CHORUS-3-DRUM-AND-BASS',30:'CHORUS 3',32:'OUTRO-1-JAM',33:'OUTRO 1',35:'OUTRO-JAM',36:'OUTRO 2',7:'VERSE-1-VOX-SAMPLES' };
const MAPPED = [3,5,6,8,10,12,14,16,17,19,20,22,23,25,26,28,29,30,32,33,35,36];

function makeLive(opts = {}) {
  const L = { time: 0, playing: 0, tempo: 120, quant: 4, num: 4, den: 4, ms: 1000, nTracks: 3,
    log: [], slots: {}, trig: {}, pend: null, obs: [], order: [], fires: 0, warnings: [], out: [] };
  const lens = opts.lens || {};
  for (let i = 0; i < 40; i++) { L.order.push(1000 + i); }
  if (opts.removeFirst) L.order.splice(0, opts.removeFirst);
  L.names = Object.assign({}, NAMES, opts.names || {});
  const clipAt = s => (MAPPED.includes(s) || s === 7) ? { length: lens[s] || 32, looping: 1, lq: (opts.badQuant === s) ? 1 : 0 } : null;
  L.playingSlot = [-1, -1, -1];
  L.sceneColor = n => ([3,5,8,12,16,19,22,25,28,29,32,35].includes(n) ? 0xE040C0 : 0x12AB34);
  L.lamp = { song: {}, jam: {} };
  const sceneNumAt = i => L.order[i] - 999;
  const launch = n => {
    L.log.push([n, L.time]); L.playingSlot = L.playingSlot.map(() => n - 1);
    if (L.trig[n]) { L.trig[n] = 0; notify(n, 0); }
    L.pend = null;
  };
  const notify = (n, v) => L.obs.filter(o => o.scene === n && o.property === 'is_triggered').forEach(o => o.cb(['is_triggered', v]));
  L.fireScene = (n, byUser) => {
    L.fires++;
    if (!byUser) L.routerFires = (L.routerFires || 0) + 1;
    if (L.pend && L.pend !== n && L.trig[L.pend]) { L.trig[L.pend] = 0; notify(L.pend, 0); }
    if (!L.playing) { L.playing = 1; L.time = 0; if (!opts.noTrigWhenStopped) { L.trig[n] = 1; notify(n, 1); } launch(n); return; }
    if (L.quant === 0) { L.log.push([n, L.time, 'IMMEDIATE']); L.playingSlot = L.playingSlot.map(() => n - 1); return; }
    L.pend = n; L.pendAt = Math.ceil(L.time / 4 - 1e-9) * 4; L.trig[n] = 1; notify(n, 1);
  };
  L.adv = (beats, tick) => {
    const end = L.time + beats, step = L.tempo / 60 * 0.05;
    while (L.time < end - 1e-9) {
      L.ms += 50;
      if (L.playing) { L.time = Math.min(end, L.time + step);
        if (L.pend && L.time >= L.pendAt - 1e-9) { const n = L.pend, t = L.pendAt, keep = L.time; L.time = t + 0.001; launch(n); L.time = keep; L.log[L.log.length - 1][1] = t; } }
      if (tick !== false) ctx.tick();
    }
  };
  L.stopAll = () => { L.playingSlot = [-1, -1, -1]; };
  L.stop = () => { L.playing = 0; L.pend = null; L.playingSlot = [-1, -1, -1]; ctx.tick(); };
  L.insertScene = () => { L.order.splice(2, 0, 9999); L.obs.filter(o => o.property === 'scenes').forEach(o => o.cb(['scenes'])); };

  class LiveAPI {
    constructor(cb, p) { this.cb = cb; this.goto(p); this._prop = ''; }
    goto(p) { this.path = p; const m = /^live_set scenes (\d+)/.exec(p); this.scene = m ? +m[1] + 1 : 0; }
    set property(v) { this._prop = v; this.propertyName = v; if (v) { L.obs.push(this); } else { L.obs = L.obs.filter(o => o !== this); } }
    get property() { return this._prop; }
    getcount(c) { return c === 'scenes' ? L.order.length : L.nTracks; }
    get(n) {
      const p = this.path;
      if (p === 'live_set') return [{ is_playing: L.playing, current_song_time: L.time, tempo: L.tempo, signature_numerator: L.num,
        signature_denominator: L.den, clip_trigger_quantization: L.quant }[n] ?? (n === 'scenes' ? L.order.flatMap(i => ['id', i]) : 0)].flat();
      let m;
      if ((m = /^live_set scenes (\d+)$/.exec(p))) {
        if (n === 'is_triggered') return [L.trig[+m[1] + 1] || 0];
        if (n === 'color') return [L.sceneColor(sceneNumAt(+m[1]))];
        return [-1];
      }
      if ((m = /^live_set tracks (\d+)$/.exec(p))) return [L.playingSlot[+m[1]]];
      if ((m = /^live_set tracks \d+ clip_slots (\d+)$/.exec(p))) return [clipAt(sceneNumAt(+m[1])) ? 1 : 0];
      if ((m = /^live_set tracks \d+ clip_slots (\d+) clip$/.exec(p))) { const c = clipAt(sceneNumAt(+m[1]));
        return [{ color: 0xFF8000, length: c.length, looping: c.looping, launch_quantization: c.lq, launch_mode: 0, legato: 0, is_audio_clip: 0, warping: 1 }[n]]; }
      throw new Error('get ' + p + ' ' + n);
    }
    getstring() { const m = /^live_set scenes (\d+)$/.exec(this.path); const nm = L.names[sceneNumAt(+m[1])] || ''; return nm.includes(' ') ? '"' + nm + '"' : nm; }
    set(n, v) { if (n === 'clip_trigger_quantization') L.quant = v; }
    call(f) { if (f === 'fire') L.fireScene(this.scene); }
  }
  const ctx = vm.createContext({ LiveAPI, Math, String, parseInt, setoutletassist() {},
    post: s => { if (s.includes('WARN')) L.warnings.push(s); },
    outlet: (i, a, b, ...rest) => { if (i === 5) L.lamp[a][b] = rest.map(v => Math.round(v * 255)).join(','); else L.out[i] = b; },
    Date: { now: () => L.ms } });
  vm.runInContext(SRC, ctx);
  ctx.init();
  L.ctx = ctx;
  return L;
}
const seq = L => L.log.map(e => e[0]);
const test = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; } };
const start = (L, n) => { L.fireScene(n, true); L.ctx.tick(); };

test('SONG auto-advances through green scenes on boundaries, skipping pink and yellow', () => {
  const L = makeLive({ lens: { 6: 16, 10: 32 } }); start(L, 6);
  L.adv(16 + 32 + 32 * 8 + 10);
  assert.deepStrictEqual(seq(L), [6,10,14,17,20,23,26,30,33,36]);
  assert.deepStrictEqual(L.log.slice(0, 3).map(e => e[1]), [0, 16, 48]);
  assert.strictEqual(L.routerFires, 9);
});
test('Outro 2 holds at END with no further launches', () => {
  const L = makeLive(); start(L, 36); L.adv(200);
  assert.deepStrictEqual(seq(L), [36]); assert.strictEqual(L.out[2], 'END: holds');
});
test('CHORUS 1 > JAM > VERSE INTERLUDE, with different green and pink lengths', () => {
  const L = makeLive({ lens: { 14: 32, 12: 16 } }); start(L, 14);
  L.adv(10); L.ctx.toggle(); L.adv(22 + 16 * 3 + 5);
  assert.deepStrictEqual(seq(L), [14, 12]);
  assert.strictEqual(L.log[1][1], 32);
  assert.strictEqual(L.routerFires, 1, 'JAM must loop without re-firing');
  L.ctx.toggle(); L.adv(16);
  assert.deepStrictEqual(seq(L), [14, 12, 17]);
  assert.strictEqual(L.log[2][1], 32 + 16 * 4);
  L.adv(40); assert.deepStrictEqual(seq(L), [14, 12, 17, 20]);
});
test('Request halfway through waits for the full section, not the next bar', () => {
  const L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(16); L.ctx.toggle(); L.adv(8);
  assert.deepStrictEqual(seq(L), [14]); assert.strictEqual(L.out[3], '2');
});
test('Second press and CANCEL both remove the request', () => {
  let L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(4); L.ctx.toggle(); L.adv(1); L.ctx.toggle(); L.adv(28);
  assert.deepStrictEqual(seq(L), [14, 17]);
  L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(4); L.ctx.toggle(); L.adv(1); L.ctx.cancel(); L.adv(28);
  assert.deepStrictEqual(seq(L), [14, 17]);
});
test('Double message within debounce counts as one press', () => {
  const L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(1); L.ctx.toggle(); L.ctx.toggle(); L.adv(32);
  assert.deepStrictEqual(seq(L), [14, 12]);
});
test('Press after commit applies to the incoming section, without a second launch', () => {
  const L = makeLive({ lens: { 14: 32, 17: 32 } }); start(L, 14); L.adv(31.5);
  assert.strictEqual(L.routerFires, 1); L.ctx.toggle(); L.adv(1);
  assert.deepStrictEqual(seq(L), [14, 17]); assert.strictEqual(L.routerFires, 1);
  L.adv(32); assert.deepStrictEqual(seq(L), [14, 17, 16]);
});
test('Press inside the safety margin of a JAM boundary waits one more cycle', () => {
  const L = makeLive({ lens: { 12: 16 } }); start(L, 12); L.adv(15.9, true); L.ctx.toggle(); L.adv(1);
  assert.deepStrictEqual(seq(L), [12]); L.adv(15.5);
  assert.deepStrictEqual(seq(L), [12, 17]); assert.strictEqual(L.log[1][1], 32);
});
test('Press in the lead window but outside margin still catches the JAM boundary', () => {
  const L = makeLive({ lens: { 12: 16 } }); start(L, 12); L.adv(15.5); L.ctx.toggle(); L.adv(1);
  assert.deepStrictEqual(seq(L), [12, 17]); assert.strictEqual(L.log[1][1], 16);
});
test('Stalled main thread: launches one bar late, once, and counts from the real launch', () => {
  const L = makeLive({ lens: { 14: 32, 17: 32 } }); start(L, 14); L.adv(30.5);
  L.adv(2, false); L.adv(4);
  assert.deepStrictEqual(seq(L), [14, 17]); assert.strictEqual(L.log[1][1], 36); assert.strictEqual(L.routerFires, 1);
  L.adv(32); assert.strictEqual(L.log[2][1], 68);
});
test('Manual launch of a mapped scene is followed; mode and counting update', () => {
  const L = makeLive({ lens: { 6: 32, 23: 16 } }); start(L, 6); L.adv(5); L.fireScene(23, true); L.adv(4);
  assert.deepStrictEqual(seq(L), [6, 23]); assert.strictEqual(L.out[0], 'CHORUS 2');
  L.adv(16); assert.deepStrictEqual(seq(L), [6, 23, 26]); assert.strictEqual(L.log[2][1], 24);
});
test('Manual launch replaces a committed router launch', () => {
  const L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(31.5); L.fireScene(5, true); L.adv(1);
  assert.deepStrictEqual(seq(L), [14, 5]); assert.strictEqual(L.out[0], 'INTRO'); assert.strictEqual(L.out[1], 'JAM');
});
test('Yellow scene launch is ignored and the song clock continues', () => {
  const L = makeLive({ lens: { 6: 32 } }); start(L, 6); L.adv(4); L.fireScene(7, true); L.adv(5);
  assert.strictEqual(L.out[0], 'INTRO'); L.adv(25); assert.deepStrictEqual(seq(L), [6, 7, 10]); assert.strictEqual(L.log[2][1], 32);
});
test('Stop clears everything and nothing fires until a new launch', () => {
  const L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(4); L.ctx.toggle(); L.stop();
  assert.strictEqual(L.out[0], '--'); L.playing = 1; L.adv(100);
  assert.deepStrictEqual(seq(L), [14]); assert.strictEqual(L.routerFires, undefined);
});
test('Scene launched from stopped transport without a notification is found by the probe', () => {
  const L = makeLive({ lens: { 6: 16 }, noTrigWhenStopped: true }); L.fireScene(6, true); L.adv(2);
  assert.strictEqual(L.out[0], 'INTRO'); L.adv(15); assert.deepStrictEqual(seq(L), [6, 10]); assert.strictEqual(L.log[1][1], 16);
});
test('Stop All Clips does not bring the band back at the boundary', () => {
  const L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(4); L.stopAll(); L.adv(40);
  assert.deepStrictEqual(seq(L), [14]); assert.strictEqual(L.out[0], '--');
});
test('Inserting a scene disarms the router', () => {
  const L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(4); L.insertScene(); L.adv(40);
  assert.deepStrictEqual(seq(L), [14]); assert.ok(L.out[4].startsWith('SCENES CHANGED'));
});
test('NEXT launches at the next bar, once; repeated presses do not double-advance', () => {
  const L = makeLive({ lens: { 6: 32 } }); start(L, 6); L.adv(5.2); L.ctx.next(); L.adv(0.2); L.ctx.next(); L.adv(3);
  assert.deepStrictEqual(seq(L), [6, 10]); assert.strictEqual(L.log[1][1], 8);
});
test('Global Quantization None is reset before firing, never launching immediately', () => {
  const L = makeLive({ lens: { 6: 16 } }); start(L, 6); L.quant = 0; L.adv(16);
  assert.strictEqual(L.quant, 4); assert.deepStrictEqual(seq(L), [6, 10]); assert.strictEqual(L.log[1][1], 16);
});
test('Arrangement loop jump keeps bars remaining', () => {
  const L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(16); L.time -= 8; L.adv(16);
  assert.deepStrictEqual(seq(L), [14, 17]); assert.strictEqual(L.log[1][1], 24);
});
test('JAM 35 refuses SONG because the table says END', () => {
  const L = makeLive(); start(L, 35); L.adv(1); L.ctx.toggle(); L.adv(100);
  assert.deepStrictEqual(seq(L), [35]); assert.ok(L.out[4].includes('END'));
});
test('Device off: no launches; requests held for when it returns', () => {
  const L = makeLive({ lens: { 6: 8 } }); start(L, 6); L.ctx.enabled(0); L.adv(20);
  assert.deepStrictEqual(seq(L), [6]); L.ctx.enabled(1); L.adv(8); assert.deepStrictEqual(seq(L), [6, 10]); assert.strictEqual(L.log[1][1], 24);
});
test('Scan warns about a clip whose launch quantization is not Global', () => {
  const L = makeLive({ badQuant: 14 });
  assert.ok(L.warnings.some(w => w.includes('launch quantization')));
});
test('Re-init after a device save does not fire anything', () => {
  const L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(4); L.ctx.init(); L.adv(2);
  assert.deepStrictEqual(seq(L), [14]);
});
const GREEN = '18,171,52,255', PINK = '224,64,192,255', DARK = '43,43,43,255';
test('Lamps use the scene colours, not clip colours', () => {
  const L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(1);
  assert.strictEqual(L.lamp.song.activebgcolor, GREEN);
  assert.strictEqual(L.lamp.jam.activebgcolor, DARK);
  assert.strictEqual(L.lamp.jam.activebgoncolor, PINK);
});
test('Clicked JAM blinks while pending, then is solid and SONG goes dark', () => {
  const L = makeLive({ lens: { 14: 32, 12: 16 } }); start(L, 14); L.adv(1); L.ctx.reqjam();
  const seen = new Set(); for (let i = 0; i < 20; i++) { L.adv(0.1); seen.add(L.lamp.jam.activebgcolor); assert.strictEqual(L.lamp.song.activebgcolor, GREEN); }
  assert.deepStrictEqual([...seen].sort(), [DARK, PINK].sort());
  L.adv(32); assert.strictEqual(L.lamp.jam.activebgcolor, PINK); assert.strictEqual(L.lamp.song.activebgcolor, DARK);
  assert.deepStrictEqual(seq(L), [14, 12]);
});
test('SONG / JAM lamps are direct: repeat JAM keeps the request, SONG withdraws it', () => {
  let L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(1); L.ctx.reqjam(); L.adv(1); L.ctx.reqjam(); L.adv(32);
  assert.deepStrictEqual(seq(L), [14, 12]);
  L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(1); L.ctx.reqjam(); L.adv(1); L.ctx.reqsong(); L.adv(32);
  assert.deepStrictEqual(seq(L), [14, 17]);
});
test('Lamp requests after commit apply to the incoming section and refuse END', () => {
  let L = makeLive({ lens: { 14: 32, 17: 32 } }); start(L, 14); L.adv(31.5); L.ctx.reqjam(); L.adv(33);
  assert.deepStrictEqual(seq(L), [14, 17, 16]);
  L = makeLive(); start(L, 35); L.adv(1); L.ctx.reqsong(); L.adv(100);
  assert.deepStrictEqual(seq(L), [35]); assert.ok(L.out[4].includes('END'));
});
test('PREV launches the previous green scene at the next bar, once, then auto-advances', () => {
  const L = makeLive({ lens: { 14: 32, 10: 16 } }); start(L, 14); L.adv(5.2); L.ctx.prev(); L.adv(0.2); L.ctx.prev(); L.adv(3);
  assert.deepStrictEqual(seq(L), [14, 10]); assert.strictEqual(L.log[1][1], 8); assert.strictEqual(L.out[0], 'VERSE 1');
  L.adv(16); assert.deepStrictEqual(seq(L), [14, 10, 14]); assert.strictEqual(L.log[2][1], 24);
});
test('PREV from a JAM section goes to the section before it, and clears the JAM request', () => {
  const L = makeLive({ lens: { 12: 16, 10: 32 } }); start(L, 12); L.adv(1); L.ctx.reqsong(); L.ctx.prev(); L.adv(4);
  assert.deepStrictEqual(seq(L), [12, 10]); assert.strictEqual(L.out[1], 'SONG');
});
test('PREV on Intro is refused without an error, and the song carries on', () => {
  for (const scene of [6, 5]) {
    const L = makeLive({ lens: { 6: 16, 5: 16 } }); start(L, scene); L.adv(1); L.ctx.prev(); L.adv(1);
    assert.deepStrictEqual(seq(L), [scene]); assert.ok(L.out[4].startsWith('BEGINNING'));
  }
});
test('CANCEL and Stop both clear a waiting PREV', () => {
  let L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(1); L.ctx.prev(); L.ctx.cancel(); L.adv(4);
  assert.deepStrictEqual(seq(L), [14]);
  L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(1); L.ctx.prev(); L.stop(); L.playing = 1; L.adv(4);
  assert.deepStrictEqual(seq(L), [14]);
});
test('PREV while a launch is locked is ignored', () => {
  const L = makeLive({ lens: { 14: 32, 17: 32 } }); start(L, 14); L.adv(31.5); L.ctx.prev(); L.adv(1);
  assert.deepStrictEqual(seq(L), [14, 17]); assert.strictEqual(L.routerFires, 1);
});
test('Moved scenes are found by name: your 2-scene shift launches the right scenes', () => {
  const L = makeLive({ lens: { 6: 16, 10: 32, 14: 32, 12: 16 }, removeFirst: 2 }); assert.strictEqual(L.ctx.S.armed, true);
  start(L, 4); L.adv(1); assert.strictEqual(L.out[0], 'INTRO'); L.adv(15);
  assert.deepStrictEqual(seq(L), [4, 8]); L.adv(32);
  assert.deepStrictEqual(seq(L), [4, 8, 12]); L.adv(1); L.ctx.toggle(); L.adv(31);
  assert.deepStrictEqual(seq(L), [4, 8, 12, 10]);
});
test('Scene names match despite case and spaces', () => {
  const L = makeLive({ names: { 14: ' chorus 1 ' } }); assert.strictEqual(L.ctx.S.armed, true); start(L, 14); L.adv(1);
  assert.strictEqual(L.out[0], 'CHORUS 1');
});
test('A missing song scene name disarms and names the scene; nothing launches', () => {
  const L = makeLive({ names: { 14: 'CHORUS ONE' } }); assert.strictEqual(L.ctx.S.armed, false);
  L.ctx.tick(); assert.strictEqual(L.out[4], 'SCENE NOT FOUND: CHORUS 1');
  start(L, 6); L.adv(100); assert.deepStrictEqual(seq(L), [6]);
});
test('A duplicated scene name disarms', () => {
  const L = makeLive({ names: { 2: 'VERSE 1' } }); assert.strictEqual(L.ctx.S.armed, false);
});
test('A missing alternative JAM only warns', () => {
  const L = makeLive({ names: { 29: 'OTHER' } }); assert.strictEqual(L.ctx.S.armed, true);
  assert.ok(L.warnings.some(w => w.includes('CHORUS-3-DRUM-AND-BASS')));
});
test('The alternative JAM is followed as JAM of its section', () => {
  const L = makeLive({ lens: { 3: 16 } }); start(L, 3); L.adv(1);
  assert.strictEqual(L.out[0], 'INTRO'); assert.strictEqual(L.out[1], 'JAM');
});
test('Insert a scene, then RESCAN when stopped: scenes are found at their new numbers', () => {
  const L = makeLive({ lens: { 6: 16 } }); L.names[9999 - 999] = ''; L.insertScene(); L.ctx.tick();
  assert.ok(L.out[4].startsWith('SCENES CHANGED')); L.ctx.rescan(); assert.strictEqual(L.ctx.S.armed, true);
  start(L, 7); L.adv(16); assert.deepStrictEqual(seq(L), [7, 11]);
});

// ---- big_window.js ----
function makeWindow(size, opts = {}) {
  const objs = {};
  const add = (n, rect, font) => { objs[n] = { rect, font, rectCalls: 0,
    getboxattr: () => objs[n].rect, getattr: () => objs[n].font,
    setboxattr(_a, r) { assert.ok(Array.isArray(r) || r.length === 4); objs[n].rect = Array.from(r); objs[n].rectCalls++; }, setattr(_a, f) { objs[n].font = f; } }; };
  add('song', [20, 20, 335, 110], 44); add('jam', [365, 20, 335, 110], 44);
  for (const [i, n] of ['cancel', 'prev', 'next'].entries()) add(n, [20 + i * 230, 375, 220, 50], 20);
  for (const n of ['title', 'cap_0', 'val_0', 'cap_2', 'val_2', 'cap_3', 'val_3', 'val_4']) add(n, [130, 145, 570, 60], 46);
  if (opts.missing) delete objs[opts.missing];
  const logs = [];
  const wind = { visible: opts.visible !== false, size };
  const ctx = vm.createContext({ jsarguments: ['big_window.js', 720, 505, 'title', 'song', 'jam', 'cancel', 'prev', 'next', 'cap_0', 'val_0', 'cap_2', 'val_2', 'cap_3', 'val_3', 'val_4'], Math, Error, Array: Array, post: s => logs.push(s),
    patcher: { wind, getnamed: n => objs[n] || null } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../device/big_window.js'), 'utf8'), ctx);
  return { ctx, objs, wind, logs };
}
test('Window: contents scale with the window, and font follows the tighter axis', () => {
  const W = makeWindow([1440, 1010]); W.ctx.poll();
  assert.deepStrictEqual(W.objs.jam.rect, [730, 40, 670, 220]); assert.strictEqual(W.objs.jam.font, 88);
  W.wind.size = [1440, 505]; W.ctx.poll();
  assert.deepStrictEqual(W.objs.jam.rect, [730, 20, 670, 110]); assert.strictEqual(W.objs.jam.font, 44);
});
test('Window: repeat scaling works from the original layout, without drift', () => {
  const W = makeWindow([333, 211]); W.ctx.poll(); W.wind.size = [720, 505]; W.ctx.poll();
  assert.deepStrictEqual(W.objs.next.rect, [480, 375, 220, 50]); assert.strictEqual(W.objs.next.font, 20);
});
test('Window: text has a minimum size', () => {
  const W = makeWindow([100, 60]); W.ctx.poll(); assert.strictEqual(W.objs.cancel.font, 8);
});
test('Window: no work when the size is unchanged or the window is hidden', () => {
  const W = makeWindow([900, 500]); W.ctx.poll(); W.ctx.poll(); assert.strictEqual(W.objs.song.rectCalls, 1);
  W.wind.visible = false; W.wind.size = [800, 500]; W.ctx.poll(); assert.strictEqual(W.objs.song.rectCalls, 1);
});
test('Window: a failure disables resizing once, without throwing', () => {
  const W = makeWindow([900, 500], { missing: 'val_4' }); W.ctx.poll(); W.ctx.poll();
  assert.strictEqual(W.logs.length, 1); assert.ok(W.logs[0].includes('val_4'));
});

// ---- song title ----
const TITLED = { names: { 2: 'SONG: SUPERFLY' } };
const rename = (L, n, name) => { L.names[n] = name; L.obs.filter(o => o.scene === n && o.property === 'name').forEach(o => o.cb(['name', name])); L.ctx.tick(); };
test('Title: comes from the tagged scene, without the tag', () => {
  const L = makeLive(TITLED); assert.strictEqual(L.out[6], 'SUPERFLY'); assert.strictEqual(L.ctx.S.armed, true);
  assert.strictEqual(makeLive({ names: { 2: 'song:  Other Song ' } }).out[6], 'Other Song');
});
test('Title: a scene that merely starts with SONG is not a title', () => {
  assert.strictEqual(makeLive({ names: { 2: 'SONGBIRD' } }).out[6], '--');
});
test('Title: no tagged scene shows -- and stays armed, with no warning', () => {
  const L = makeLive(); assert.strictEqual(L.out[6], '--'); assert.strictEqual(L.ctx.S.armed, true);
  assert.ok(!L.warnings.some(w => w.includes('SONG:')));
});
test('Title: renaming updates the display, and removing the tag clears it, without disarming', () => {
  const L = makeLive(TITLED); start(L, 14); L.adv(1); rename(L, 2, 'SONG: NEW NAME');
  assert.strictEqual(L.out[6], 'NEW NAME'); rename(L, 2, 'NOTES'); assert.strictEqual(L.out[6], '--');
  assert.strictEqual(L.ctx.S.armed, true); L.adv(32); assert.deepStrictEqual(seq(L), [14, 17]);
});
test('Title: several tagged scenes use the first and warn', () => {
  const L = makeLive({ names: { 1: 'SONG: FIRST', 2: 'SONG: SECOND' } });
  assert.strictEqual(L.out[6], 'FIRST'); assert.ok(L.warnings.some(w => w.includes("2 scenes start with SONG:")));
});
test('Title: moved by a scene change, it is found again on RESCAN', () => {
  const L = makeLive({ names: { 4: 'SONG: SUPERFLY' } }); assert.strictEqual(L.ctx.S.titleScene, 4); L.insertScene(); L.ctx.tick(); L.ctx.rescan(); L.ctx.tick();
  assert.strictEqual(L.out[6], 'SUPERFLY'); assert.strictEqual(L.ctx.S.titleScene, 5);
});
test('Title: never part of the song, so PREV from Intro is still refused', () => {
  const L = makeLive({ names: { 2: 'SONG: SUPERFLY' }, lens: { 6: 16 } }); start(L, 6); L.adv(1); L.ctx.prev(); L.adv(1);
  assert.deepStrictEqual(seq(L), [6]); assert.ok(L.out[4].startsWith('BEGINNING'));
});

// ---- mixer.js ----
function makeMixer(tracks, opts = {}) {
  const log = [], objs = {}, posts = [];
  const obj = n => objs[n] || (objs[n] = { hidden: 0, msgs: {}, message(m, ...a) { this.msgs[m] = a; } });
  const devObjs = {};
  const devObj = n => devObjs[n] || (devObjs[n] = { hidden: 0, msgs: {}, message(m, ...a) { this.msgs[m] = a; } });
  const watchers = [];
  const ok = /^live_set tracks (\d+)$/, slot = /^live_set tracks (\d+) clip_slots (\d+)$/;
  class LiveAPI {
    constructor(cb, p) { this.cb = cb; this.goto(p); }
    goto(p) { this.path = p; const m = ok.exec(p); this.id = m ? 100 + +m[1] : 1; }
    set property(v) { this._p = v; if (v) watchers.push(this); else watchers.splice(watchers.indexOf(this), 1); }
    get property() { return this._p; }
    getcount() { return tracks.length; }
    getstring() { return tracks[+ok.exec(this.path)[1]].name; }
    get(n) {
      let m;
      if (this.path === 'live_set') return tracks.flatMap((t, i) => ['id', t.id || 100 + i]);
      if ((m = slot.exec(this.path))) return [(tracks[+m[1]].clips || []).includes(+m[2]) ? 1 : 0];
      const t = tracks[+ok.exec(this.path)[1]];
      if (n === 'group_track') return ['id', t.parent === undefined ? 0 : 100 + t.parent];
      if (n === 'is_foldable') return [t.group ? 1 : 0];
      if (n === 'mute') return [t.mute ? 1 : 0];
      if (n === 'playing_slot_index') return [t.playing ? 0 : -1];
      throw new Error('get ' + n);
    }
    set(n, v) { const i = +ok.exec(this.path)[1]; tracks[i].mute = v; log.push(['mute', i, v]);
      watchers.filter(w => w._p === 'mute' && w.path === this.path).forEach(w => w.cb(['mute', v])); }
    call(f) { log.push([f, this.path]); }
  }
  const sent = [];
  const ctx = vm.createContext({ LiveAPI, Math, String, post: s => posts.push(s), outlet: (...a) => sent.push(a), patcher: { getnamed: obj, parentpatcher: { getnamed: devObj }, wind: { visible: opts.visible !== false, size: [1120, 280] } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../device/mixer.js'), 'utf8'), ctx);
  return { ctx, log, obj, devObj, posts, tracks, watchers, sent };
}
const SET = () => [{ name: 'DRUMS', group: 1 }, { name: 'KICK', parent: 0, clips: [3, 7] }, { name: 'SNARE', parent: 0, clips: [7] },
  { name: 'BASS', group: 1, mute: 1 }, { name: 'SUB', parent: 3, clips: [3] }, { name: 'LOOSE', clips: [3] }, { name: 'SONG-JAM' }];
const YELLOW = '1,0.85,0,1', OFFC = '0.17,0.17,0.17,1';
test('Mixer: makes strips from group tracks only, and hides spares', () => {
  const M = makeMixer(SET()); M.ctx.opened();
  assert.deepStrictEqual(M.obj('name_0').msgs.set, ['DRUMS']); assert.deepStrictEqual(M.obj('name_1').msgs.set, ['BASS']);
  assert.strictEqual(M.obj('play_1').hidden, 0); assert.strictEqual(M.obj('play_2').hidden, 1);
});
test('Mixer: does nothing to Live before the device has loaded', () => {
  const M = makeMixer(SET()); M.ctx.scene(4); M.ctx.play(0); M.ctx.stop(0); M.ctx.mute(0); M.ctx.poll();
  assert.deepStrictEqual(M.log, []); assert.strictEqual(M.watchers.length, 0);
});
test('Mixer: PLAY fires only clips of this group in the current scene, skipping empty slots', () => {
  const M = makeMixer(SET()); M.ctx.opened(); M.ctx.scene(4); M.ctx.play(0);
  assert.deepStrictEqual(M.log, [['fire', 'live_set tracks 1 clip_slots 3']]);
});
test('Mixer: PLAY with no current section launches nothing, and says so', () => {
  const M = makeMixer(SET()); M.ctx.opened(); M.ctx.scene(0); M.ctx.play(0);
  assert.deepStrictEqual(M.log, []); assert.ok(M.obj('status').msgs.set[0].startsWith('PLAY:'));
});
test('Mixer: STOP stops each track in the group and no others', () => {
  const M = makeMixer(SET()); M.ctx.opened(); M.ctx.stop(0);
  assert.deepStrictEqual(M.log, [['stop_all_clips', 'live_set tracks 1'], ['stop_all_clips', 'live_set tracks 2']]);
});
test('Mixer: M toggles the group track, and the lamp follows Live: yellow playing, grey muted', () => {
  const M = makeMixer(SET()); M.ctx.opened();
  assert.strictEqual(M.obj('mute_1').msgs.activebgcolor.join(), OFFC); assert.strictEqual(M.obj('mute_0').msgs.activebgcolor.join(), YELLOW);
  M.ctx.mute(0); assert.deepStrictEqual(M.log, [['mute', 0, 1]]); assert.strictEqual(M.obj('mute_0').msgs.activebgcolor.join(), OFFC);
  M.ctx.mute(0); assert.strictEqual(M.obj('mute_0').msgs.activebgcolor.join(), YELLOW);
});
test('Mixer: PLAY lamp follows playing tracks, and polling stops when the window is closed', () => {
  const M = makeMixer(SET()); M.ctx.opened(); M.tracks[2].playing = 1;
  M.ctx.poll(); M.ctx.poll(); assert.strictEqual(M.obj('play_0').msgs.activetextcolor.join(), '0.36,0.82,0.62,1');
  const C = makeMixer(SET()); C.ctx.opened(); C.tracks[2].playing = 1; C.ctx.patcher.wind.visible = false; C.ctx.poll(); C.ctx.poll();
  assert.strictEqual(C.obj('play_0').msgs.activetextcolor.join(), '0.6,0.6,0.6,1');
});
test('Mixer: nested groups belong to the outermost group', () => {
  const M = makeMixer([{ name: 'ALL', group: 1 }, { name: 'SUB', group: 1, parent: 0 }, { name: 'A', parent: 1, clips: [0] }]);
  M.ctx.opened(); assert.strictEqual(M.obj('play_1').hidden, 1); M.ctx.stop(0); assert.deepStrictEqual(M.log, [['stop_all_clips', 'live_set tracks 2']]);
});
test('Mixer: more than 12 groups shows the first 12 and logs it', () => {
  const M = makeMixer(Array.from({ length: 14 }, (_, i) => ({ name: 'G' + i, group: 1 }))); M.ctx.opened();
  assert.deepStrictEqual(M.obj('name_11').msgs.set, ['G11']); assert.ok(M.posts[0].includes('14 groups'));
});
test('Router: sends the current scene to the mixer, once per change', () => {
  const L = makeLive({ lens: { 14: 32 } }); start(L, 14); L.adv(1); assert.strictEqual(L.out[7], 14);
  L.adv(32); assert.strictEqual(L.out[7], 17); L.stop(); assert.strictEqual(L.out[7], 0);
});
const GROUPS = n => Array.from({ length: n }, (_, i) => ({ name: 'G' + i, group: 1 }));
test('Mixer window: fits the number of groups, with no blank space', () => {
  const M = makeMixer(GROUPS(9)); M.ctx.opened();
  assert.deepStrictEqual(Array.from(M.ctx.patcher.wind.size), [850, 280]); assert.deepStrictEqual(M.sent[0], [0, 'design', 850]);
});
test('Mixer window: last strip ends one margin from the edge', () => {
  const M = makeMixer(GROUPS(9)); M.ctx.opened();
  assert.strictEqual(10 + 8 * 92.5 + 90 + 10, M.ctx.patcher.wind.size[0]);
});
test('Mixer window: reopening keeps a size the user chose', () => {
  const M = makeMixer(GROUPS(9)); M.ctx.opened(); M.ctx.patcher.wind.size = [1700, 560]; M.ctx.opened();
  assert.deepStrictEqual(Array.from(M.ctx.patcher.wind.size), [1700, 560]); assert.strictEqual(M.sent.length, 1);
});
test('Mixer window: a change in groups keeps the zoom', () => {
  const tracks = GROUPS(9); const M = makeMixer(tracks); M.ctx.opened(); M.ctx.patcher.wind.size = [1700, 560];
  tracks.pop(); M.ctx.opened();
  assert.deepStrictEqual(Array.from(M.ctx.patcher.wind.size), [1515, 560]);
});
test('Mixer window: stays wide enough for its status text with few groups', () => {
  const M = makeMixer(GROUPS(1)); M.ctx.opened(); assert.strictEqual(M.ctx.patcher.wind.size[0], 295);
});
test('Window scaling: a new design width fills the window without stretching', () => {
  const W = makeWindow([850, 505]); W.ctx.design(850); W.ctx.poll();
  assert.deepStrictEqual(W.objs.jam.rect, [365, 20, 335, 110]); assert.strictEqual(W.objs.jam.font, 44);
});
test('Device mutes: named after the groups, spares hidden, and they work without opening the window', () => {
  const M = makeMixer(SET(), { visible: false }); M.ctx.init();
  assert.deepStrictEqual(M.devObj('dmute_0').msgs.text, ['DRUMS']); assert.strictEqual(M.devObj('dmute_2').hidden, 1);
  assert.deepStrictEqual(M.devObj('dmute_1').msgs.set, [0]); assert.deepStrictEqual(M.devObj('dmute_0').msgs.set, [1]);
  M.ctx.active(0, 0); assert.deepStrictEqual(M.log, [['mute', 0, 1]]);
  M.ctx.tick();
  assert.deepStrictEqual(M.devObj('dmute_0').msgs.set, [0]); assert.strictEqual(M.obj('mute_0').msgs.activebgcolor.join(), OFFC);
});
test('Device mutes: the window is not resized while closed, then fits when opened', () => {
  const M = makeMixer(GROUPS(9), { visible: false }); M.ctx.init();
  assert.deepStrictEqual(Array.from(M.ctx.patcher.wind.size), [1120, 280]);
  M.ctx.patcher.wind.visible = true; M.ctx.opened(); assert.deepStrictEqual(Array.from(M.ctx.patcher.wind.size), [850, 280]);
});
test('Device mutes: after tracks move, a press acts on the right group track', () => {
  const tracks = SET(); const M = makeMixer(tracks, { visible: false }); M.ctx.init();
  tracks.unshift({ name: 'NEW', id: 999 }); tracks.forEach(t => { if (t.parent !== undefined) t.parent += 1; });
  M.watchers.filter(w => w._p === 'tracks').forEach(w => w.cb(['tracks']));
  M.ctx.active(0, 0); assert.deepStrictEqual(M.log, [['mute', 1, 1]]);
});
test('Device switches: set the state rather than flip it, so repeats are harmless', () => {
  const M = makeMixer(SET(), { visible: false }); M.ctx.init();
  M.ctx.active(0, 1); M.ctx.active(1, 0); assert.deepStrictEqual(M.log, [], 'already in that state');
  M.ctx.active(1, 1); M.ctx.active(1, 1); assert.deepStrictEqual(M.log, [['mute', 3, 0]]);
});
test('Device switches: the window M and the device switch stay in sync both ways', () => {
  const M = makeMixer(SET()); M.ctx.opened();
  M.ctx.mute(0); M.ctx.tick(); assert.deepStrictEqual(M.devObj('dmute_0').msgs.set, [0]);
  M.ctx.active(0, 1); M.ctx.tick(); assert.strictEqual(M.obj('mute_0').msgs.activebgcolor.join(), YELLOW);
});
test('Device switches: ignored before the device has loaded, e.g. Live restoring saved values', () => {
  const M = makeMixer(SET()); M.ctx.active(0, 0); assert.deepStrictEqual(M.log, []);
});
test('Mute notification does not set dmute_N synchronously, only after deferred tick', () => {
  const M = makeMixer(SET()); M.ctx.opened();
  const initialSet = M.devObj('dmute_0').msgs.set;
  M.tracks[0].mute = 1;
  M.watchers.filter(w => w._p === 'mute' && w.path === 'live_set tracks 0').forEach(w => w.cb(['mute', 1]));
  assert.deepStrictEqual(M.devObj('dmute_0').msgs.set, initialSet, 'dmute_0 must not be set synchronously in notification');
  assert.strictEqual(M.ctx.strips[0].muted, true, 'muted state must be recorded');
  M.ctx.tick();
  assert.deepStrictEqual(M.devObj('dmute_0').msgs.set, [0], 'dmute_0 must be set after deferred tick');
});

// ---- patcher structure checks ----
function loadPatcher() {
  const data = fs.readFileSync(path.join(__dirname, '../device/SongJamRouter.amxd'));
  const idx = data.indexOf(Buffer.from('ptch'));
  if (idx < 0) throw new Error('ptch not found');
  const len = data.readUInt32LE(idx + 4);
  const json = data.slice(idx + 8, idx + 8 + len).toString('utf8').replace(/\0+$/, '');
  return JSON.parse(json).patcher;
}
function boxById(patcher, id) {
  return patcher.boxes.find(b => b.box.id === id)?.box;
}
function wiresBySource(patcher, srcId) {
  return patcher.lines.filter(l => l.patchline.source[0] === srcId);
}
test('Patcher: each command button wires directly to its message', () => {
  const P = loadPatcher();
  const buttons = [
    ['b_song', 'm_reqsong'], ['b_jam', 'm_reqjam'], ['b_toggle', 'm_toggle'],
    ['b_cancel', 'm_cancel'], ['b_next', 'm_next'], ['b_prev', 'm_prev'], ['b_rescan', 'm_rescan']
  ];
  for (const [btn, msg] of buttons) {
    const wires = wiresBySource(P, btn);
    assert.ok(wires.length > 0, btn + ' must have outgoing wires');
    const targets = wires.map(w => boxById(P, w.patchline.destination[0]));
    const hasMessage = targets.some(t => t && t.id === msg);
    assert.ok(hasMessage, btn + ' must wire directly to ' + msg + ' (live.text mode 0 outputs bang, not 1/0)');
  }
});
test('Patcher: window buttons wire to trigger or message', () => {
  const P = loadPatcher();
  const big = boxById(P, 'big');
  const bigP = big.patcher;
  const buttons = [['song', 'm_song'], ['jam', 'm_jam'], ['cancel', 'm_cancel'], ['prev', 'm_prev'], ['next', 'm_next']];
  for (const [btn, msg] of buttons) {
    const wires = wiresBySource(bigP, btn);
    assert.ok(wires.length > 0, 'big window ' + btn + ' must have outgoing wires');
    const targets = wires.map(w => boxById(bigP, w.patchline.destination[0]));
    const hasMessage = targets.some(t => t && t.id === msg);
    assert.ok(hasMessage, 'big window ' + btn + ' must wire to ' + msg);
  }
});
test('Patcher: group on/off switches (dmute_N) are mode 1 and not gated', () => {
  const P = loadPatcher();
  for (let i = 0; i < 12; i++) {
    const btn = boxById(P, 'b_dmute_' + i);
    assert.strictEqual(btn.mode, 1, 'dmute_' + i + ' must be mode 1 (toggle)');
    const wires = wiresBySource(P, 'b_dmute_' + i);
    const targets = wires.map(w => boxById(P, w.patchline.destination[0]));
    const hasSel1 = targets.some(t => t && t.text && t.text.startsWith('sel 1'));
    assert.ok(!hasSel1, 'dmute_' + i + ' must NOT feed sel 1 (toggles need both values)');
  }
});
test('Patcher: mixer PLAY, STOP, M buttons wire directly to messages', () => {
  const P = loadPatcher();
  const mixer = boxById(P, 'mixer');
  const mixP = mixer.patcher;
  for (let i = 0; i < 12; i++) {
    for (const [btn, msg] of [['play_' + i, 'm_play_' + i], ['stop_' + i, 'm_stop_' + i], ['mute_' + i, 'm_mute_' + i]]) {
      const wires = wiresBySource(mixP, btn);
      if (!wires.length) continue; // hidden strip
      const targets = wires.map(w => boxById(mixP, w.patchline.destination[0]));
      const hasMessage = targets.some(t => t && t.id === msg);
      assert.ok(hasMessage, 'mixer ' + btn + ' must wire directly to ' + msg);
    }
  }
});
test('Patcher: mixer tick runs from loadbang, not from window open', () => {
  const P = loadPatcher();
  const mixer = boxById(P, 'mixer');
  const mixP = mixer.patcher;
  const tickLoad = boxById(mixP, 'tick_load');
  assert.ok(tickLoad, 'mixer must have tick_load loadbang');
  assert.strictEqual(tickLoad.maxclass, 'loadbang', 'tick_load must be a loadbang');
  // Verify complete chain: tick_load -> m_tick_on -> tick_metro -> tick_defer -> m_tick -> mix_js
  const chain = [
    ['tick_load', 'm_tick_on'],
    ['m_tick_on', 'tick_metro'],
    ['tick_metro', 'tick_defer'],
    ['tick_defer', 'm_tick'],
    ['m_tick', 'mix_js']
  ];
  for (const [src, dst] of chain) {
    const wires = wiresBySource(mixP, src);
    assert.ok(wires.length > 0, src + ' must have outgoing wires');
    const targets = wires.map(w => w.patchline.destination[0]);
    assert.ok(targets.includes(dst), src + ' must wire to ' + dst + ', found: ' + targets.join(', '));
  }
});
