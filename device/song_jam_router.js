// Song/Jam Router - Max for Live [js] logic. ES5 only (Max's classic js engine).
//
// Timing model: Live, not this script, performs the launch. The script calls
// Scene.fire inside the last bar of a section, with Global Quantization at 1 Bar,
// and Live launches on the next bar line. Scene.is_triggered then reports the
// launch, which starts the next section's bar count.
//
// All writes to the Live Set happen from tick() (metro -> deferlow) and init().
// Notification callbacks only record state, because Live forbids changes from
// notifications.

autowatch = 0;
inlets = 1;
outlets = 8; // 0 section, 1 mode, 2 pending, 3 bars, 4 status, 5 lamp colours, 6 song title, 7 current scene
setoutletassist(0, "section text");
setoutletassist(1, "mode text");
setoutletassist(2, "pending text");
setoutletassist(3, "bars text");
setoutletassist(4, "status text");
setoutletassist(5, "lamp colours");
setoutletassist(6, "song title text");
setoutletassist(7, "current scene number, for the mixer");

// ---------------------------- CONFIGURATION ----------------------------------
// Scenes are found by name at load and on RESCAN, so moving them is safe. Matching ignores
// case and outer spaces. A missing or duplicated song or JAM name disarms the router.
// songBars / jamBars: 0 = use the longest clip in the scene, or set explicit bars.
// jamAltScene: an alternative JAM scene. Launch it by hand and the router follows it.
//              To make it the default, swap the values of jamScene and jamAltScene.
var SECTIONS = [
	{ name: "INTRO", jamScene: "INTRO-JAM-2", songScene: "INTRO", jamAltScene: "INTRO-JAM-1", songBars: 0, jamBars: 0 },
	{ name: "VERSE 1", jamScene: "VERSE-1-JAM", songScene: "VERSE 1", jamAltScene: "", songBars: 0, jamBars: 0 },
	{ name: "CHORUS 1", jamScene: "CHORUS-1-JAM", songScene: "CHORUS 1", jamAltScene: "", songBars: 0, jamBars: 0 },
	{ name: "VERSE INTERLUDE", jamScene: "VERSE-INTERLUDE-JAM", songScene: "VERSE INTERLUDE", jamAltScene: "", songBars: 0, jamBars: 0 },
	{ name: "VERSE 2", jamScene: "VERSE-2-JAM", songScene: "VERSE 2", jamAltScene: "", songBars: 0, jamBars: 0 },
	{ name: "CHORUS 2", jamScene: "CHORUS-2-JAM", songScene: "CHORUS 2", jamAltScene: "", songBars: 0, jamBars: 0 },
	{ name: "BREAKDOWN", jamScene: "BREAKDOWN-JAM", songScene: "BREAKDOWN", jamAltScene: "", songBars: 0, jamBars: 0 },
	{ name: "CHORUS 3", jamScene: "CHORUS-3-JAM", songScene: "CHORUS 3", jamAltScene: "CHORUS-3-DRUM-AND-BASS", songBars: 0, jamBars: 0 },
	{ name: "OUTRO 1", jamScene: "OUTRO-1-JAM", songScene: "OUTRO 1", jamAltScene: "", songBars: 0, jamBars: 0 },
	{ name: "OUTRO 2", jamScene: "OUTRO-JAM", songScene: "OUTRO 2", jamAltScene: "", songBars: 0, jamBars: 0 }
];
// A scene named with this tag sets the displayed song title: "SONG: SUPERFLY" shows SUPERFLY.
// It is display only, so the router never launches that scene.
var TITLE_TAG = "SONG:";
var LEAD_SECONDS = 0.5;    // fire at least this long before the boundary (and >= 1 beat)
var MARGIN_SECONDS = 0.15; // a request closer to the boundary than this waits a cycle
var QUANT_1_BAR = 4;       // Song.clip_trigger_quantization value for 1 Bar
var DEBOUNCE_MS = 80;
// Lamp colours. Default "" = the most common scene colour across the song / JAM scenes.
// To override, use a hex string such as "FF39D4".
var SONG_COLOR = "";
var JAM_COLOR = "";
var FALLBACK_COLORS = { song: 0x3DC300, jam: 0xFF39D4 }; // used if no scene colour can be read
var BLINK_MS = 250;
// ------------------------------------------------------------------------------

var api = null;     // re-pointed with goto; never touched from a notification
var songApi = null; // fixed on live_set
var scenesWatcher = null;
var titleWatcher = null;
var observers = [];
var MAP = {}; // scene number -> { sec, kind: "song"|"jam", beats }
var S = {};
var lastOut = [];
var lastLamp = {};
var lastScene = -1;
var tally = { song: {}, jam: {} }; // clip colour counts from the scan
var palette = { song: FALLBACK_COLORS.song, jam: FALLBACK_COLORS.jam };

function freshState() {
	return {
		ready: false, armed: false, enabled: true, wasPlaying: false,
		cur: 0, sec: -1, mode: "", start: 0, len: 0, bar: 4,
		flip: false,         // performer wants the other mode at the next boundary
		commit: null,        // { scene, target }: fired, Live has not launched it yet
		commitFlip: false,   // a press during commit applies to the incoming section
		dueB: null,          // boundary we already intend to act on
		title: "", titleScene: 0, titleDirty: false,
		nextReq: false, prevReq: false, scenesDirty: false, probeAt: 0, lastTime: null,
		lastPress: 0, scanOk: false, ids: "", warnings: 0, status: "", sceneCount: 0, scanRetry: 0, scanRetryCount: 0
	};
}

// ---- helpers ----
function first(v) { return (v && v.length !== undefined && typeof v !== "string") ? v[0] : v; }
function at(path) { api.goto(path); return api; }
function prop(path, name) { return first(at(path).get(name)); }
function nextSong(sec) { return sec + 1 < SECTIONS.length ? SECTIONS[sec + 1].song : 0; }
function previousSong(sec) { return sec > 0 ? SECTIONS[sec - 1].song : 0; }
function sceneLabel(n) {
	var m = MAP[n];
	if (!m) return "scene " + n;
	return SECTIONS[m.sec].name + (m.kind === "jam" ? " JAM" : "");
}
function barBeats() {
	var s = songApi;
	return first(s.get("signature_numerator")) * 4 / first(s.get("signature_denominator"));
}
function warn(msg) { S.warnings++; post("ROUTER WARN: " + msg + "\n"); }
function setStatus(t) { S.status = t; }
function okStatus() {
	return S.warnings ? (S.warnings + " warning(s), see Max Console") : "OK";
}

// ---- pending destination ----
function destination() {
	if (!S.cur) return 0;
	if (S.mode === "song") return S.flip ? SECTIONS[S.sec].jam : nextSong(S.sec);
	return S.flip ? nextSong(S.sec) : 0;
}
function nextBoundary(now) {
	if (S.len <= 0) return null;
	var k = Math.floor((now - S.start) / S.len + 1e-9) + 1;
	return S.start + Math.max(k, 1) * S.len;
}
function resetToWaiting(status) {
	S.cur = 0; S.sec = -1; S.mode = ""; S.len = 0;
	S.flip = false; S.commit = null; S.commitFlip = false; S.dueB = null; S.nextReq = false; S.prevReq = false;
	setStatus(status);
}

// ---- Live Set scan (run at load and on RESCAN) ----
function sceneIds() { return String(songApi.get("scenes")); }

function scanScene(n, trackCount, kind, name, explicitBars, bar) {
	var path = "live_set scenes " + (n - 1);
	if (first(at(path).get("time_signature_numerator")) !== -1) {
		warn(name + ": scene " + n + " has its own time signature; the router assumes one meter");
	}
	var sceneColor = first(at(path).get("color"));
	if (sceneColor > 0) tally[kind][sceneColor] = (tally[kind][sceneColor] || 0) + 1;
	var longest = 0, clips = 0, looped = 0;
	for (var t = 0; t < trackCount; t++) {
		var slot = "live_set tracks " + t + " clip_slots " + (n - 1);
		if (!prop(slot, "has_clip")) continue;
		var c = at(slot + " clip");
		var clipName = name + " track " + (t + 1);
		clips++;
		if (first(c.get("launch_quantization")) !== 0) warn(clipName + ": clip launch quantization is not Global");
		if (first(c.get("launch_mode")) !== 0) warn(clipName + ": clip launch mode is not Trigger");
		if (first(c.get("legato"))) warn(clipName + ": clip has Legato on");
		if (first(c.get("looping"))) looped++;
		if (first(c.get("is_audio_clip")) && !first(c.get("warping"))) {
			warn(clipName + ": unwarped audio, length ignored");
			continue;
		}
		longest = Math.max(longest, first(c.get("length")));
	}
	if (!clips) warn(name + ": scene " + n + " has no clips");
	if (kind === "jam" && clips && looped < clips) warn(name + ": " + (clips - looped) + " JAM clip(s) in scene " + n + " are not looped");

	var beats = explicitBars > 0 ? explicitBars * bar : longest;
	if (explicitBars > 0 && longest > 0 && Math.abs(longest - beats) > 0.01) {
		post("ROUTER note: " + name + " scene " + n + " set to " + explicitBars + " bars, longest clip is " + (longest / bar) + " bars\n");
	}
	if (beats <= 0) warn(name + ": scene " + n + " has no usable length, it will not advance");
	else if (Math.abs(beats / bar - Math.round(beats / bar)) > 0.001) warn(name + ": scene " + n + " length is " + (beats / bar) + " bars, not a whole number");
	post("ROUTER " + kind + " " + name + " | scene " + n + " '" + at(path).getstring("name") + "' | " + (beats / bar) + " bars" + (explicitBars > 0 ? " (set)" : " (auto)") + " | " + clips + " clips\n");
	return beats;
}

function cleanName(x) {
	return String(x).replace(/^[\s"]+|[\s"]+$/g, "");
}
function normName(x) {
	return cleanName(x).toUpperCase();
}
// The title from a scene name, or null if the name doesn't carry the tag.
function titleFrom(name) {
	var c = cleanName(name);
	if (c.substring(0, TITLE_TAG.length).toUpperCase() !== TITLE_TAG.toUpperCase()) return null;
	return cleanName(c.substring(TITLE_TAG.length));
}
function sceneNameIndex() {
	var index = { numbers: {}, dups: {}, titleScene: 0, title: "", titleCount: 0 };
	for (var i = 0; i < S.sceneCount; i++) {
		var raw = at("live_set scenes " + i).getstring("name");
		var key = normName(raw);
		if (!key) continue;
		var t = titleFrom(raw);
		if (t !== null) {
			if (!index.titleCount) { index.titleScene = i + 1; index.title = t; }
			index.titleCount++;
		}
		if (index.numbers[key]) index.dups[key] = true;
		else index.numbers[key] = i + 1;
	}
	return index;
}
function findScene(index, name) {
	var key = normName(name);
	if (index.dups[key]) { warn("scene name '" + name + "' is used more than once"); return 0; }
	if (!index.numbers[key]) { warn("no scene named '" + name + "'"); return 0; }
	return index.numbers[key];
}

function scan() {
	S.warnings = 0;
	MAP = {};
	tally = { song: {}, jam: {} };
	var song = songApi;
	S.sceneCount = song.getcount("scenes");
	var trackCount = song.getcount("tracks");
	var bar = barBeats();
	S.bar = bar;
	if (bar !== 4) post("ROUTER note: meter is " + bar + " quarter notes per bar\n");
	var names = sceneNameIndex();
	S.title = names.title;
	S.titleScene = names.titleScene;
	if (names.titleCount > 1) warn(names.titleCount + " scenes start with " + TITLE_TAG + " using '" + names.title + "'");
	
	// If no scene names were found at all, Live's set data isn't ready yet. Defer and retry
	// up to 5 times (~500ms). After that, proceed with normal scan to show warnings.
	var nameCount = 0;
	for (var k in names.numbers) nameCount++;
	if (S.sceneCount > 0 && nameCount === 0 && S.scanRetryCount < 5) {
		if (S.scanRetryCount === 0) post("ROUTER: Live set scenes not ready yet, retrying in 100ms\n");
		S.scanRetry = Date.now() + 100;
		S.scanRetryCount++;
		return;
	}
	
	var missing = "";
	for (var i = 0; i < SECTIONS.length; i++) {
		var s = SECTIONS[i];
		s.song = findScene(names, s.songScene);
		s.jam = findScene(names, s.jamScene);
		s.jamAlt = s.jamAltScene ? findScene(names, s.jamAltScene) : 0;
		if (!s.song) missing = missing || s.songScene;
		if (!s.jam) missing = missing || s.jamScene;
		var entries = [[s.song, "song", s.songBars], [s.jam, "jam", s.jamBars], [s.jamAlt, "jam", s.jamBars]];
		for (var e = 0; e < entries.length; e++) {
			var n = entries[e][0];
			if (n) MAP[n] = { sec: i, kind: entries[e][1], beats: scanScene(n, trackCount, entries[e][1], s.name, entries[e][2], bar) };
		}
	}
	var ok = !missing;
	applyPalette();
	S.ids = sceneIds();
	S.armed = ok;
	S.scanOk = ok;
	setStatus(ok ? okStatus() : "SCENE NOT FOUND: " + missing);
	post("ROUTER scan done: " + S.warnings + " warning(s), armed=" + ok + "\n");
	S.scanRetry = 0;
	S.scanRetryCount = 0;
}

// ---- observers (record only, never change the Live Set) ----
function makeSceneCallback(n) {
	return function (args) {
		if (args && args[0] === "is_triggered") onTriggered(n, args[1]);
	};
}
function bindObservers() {
	unbindObservers();
	for (var key in MAP) {
		var n = parseInt(key, 10);
		var a = new LiveAPI(makeSceneCallback(n), "live_set scenes " + (n - 1));
		a.property = "is_triggered";
		observers.push(a);
	}
	scenesWatcher = new LiveAPI(function () { S.scenesDirty = true; }, "live_set");
	scenesWatcher.property = "scenes";
	if (S.titleScene) {
		titleWatcher = new LiveAPI(function (args) {
			if (args && args[0] === "name") S.titleDirty = true;
		}, "live_set scenes " + (S.titleScene - 1));
		titleWatcher.property = "name";
	}
}
function unbindObservers() {
	for (var i = 0; i < observers.length; i++) observers[i].property = "";
	observers = [];
	if (scenesWatcher) scenesWatcher.property = "";
	scenesWatcher = null;
	if (titleWatcher) titleWatcher.property = "";
	titleWatcher = null;
}
function onTriggered(n, val) {
	if (!S.ready || !S.armed) return;
	var now = first(songApi.get("current_song_time"));
	if (val) {
		// A mapped scene we did not fire: follow the performer. The latest launch wins.
		if (!S.commit || S.commit.scene !== n) {
			S.commit = { scene: n, target: ceilBar(now) };
			S.commitFlip = false;
			S.dueB = null;
		}
	} else if (S.commit && S.commit.scene === n) {
		adopt(n, Math.round(now / S.bar) * S.bar, S.commitFlip);
		setStatus(okStatus());
	}
}
function ceilBar(t) { return Math.ceil(t / S.bar - 1e-6) * S.bar; }

function adopt(n, start, flip) {
	var m = MAP[n];
	S.cur = n; S.sec = m.sec; S.mode = m.kind;
	S.bar = barBeats();
	S.start = start; S.len = m.beats;
	S.flip = flip && !(m.kind === "jam" && !nextSong(m.sec));
	S.commit = null; S.commitFlip = false; S.dueB = null;
}

// ---- firing ----
function slotVotes() {
	var votes = {};
	var count = songApi.getcount("tracks");
	for (var t = 0; t < count; t++) {
		var idx = prop("live_set tracks " + t, "playing_slot_index");
		if (idx >= 0) votes[idx + 1] = (votes[idx + 1] || 0) + 1;
	}
	return votes;
}
function anyClipPlaying() {
	var v = slotVotes();
	for (var k in v) return true;
	return false;
}
function ensureQuantization() {
	var song = songApi;
	if (first(song.get("clip_trigger_quantization")) !== QUANT_1_BAR) {
		song.set("clip_trigger_quantization", QUANT_1_BAR);
		post("ROUTER: Global Quantization was changed, reset to 1 Bar\n");
	}
}
function fire(n, now) {
	ensureQuantization();
	S.commit = { scene: n, target: ceilBar(now) };
	S.commitFlip = false;
	S.dueB = null;
	at("live_set scenes " + (n - 1)).call("fire");
}

// ---- transport / set safety, then the scheduler; runs every 50 ms ----
function tick() {
	if (!S.ready) return;
	
	// Retry scan if it was deferred due to Live set not being ready
	if (S.scanRetry && Date.now() >= S.scanRetry) {
		S.scanRetry = 0;
		scan();
		if (S.armed) ensureQuantization();
		bindObservers();
	}
	
	var song = songApi;
	var playing = first(song.get("is_playing"));
	var now = first(song.get("current_song_time"));
	var tempo = first(song.get("tempo"));

	if (S.titleDirty) {
		S.titleDirty = false;
		var title = titleFrom(at("live_set scenes " + (S.titleScene - 1)).getstring("name"));
		S.title = title === null ? "" : title;
	}

	if (S.scenesDirty) {
		S.scenesDirty = false;
		var same = sceneIds() === S.ids;
		if (!same && S.armed) {
			S.armed = false;
			resetToWaiting("SCENES CHANGED: stop, check, RESCAN");
		} else if (same && !S.armed && S.scanOk) {
			S.armed = true;
			resetToWaiting("Scenes restored: launch a scene");
		}
	}

	if (!playing) {
		if (S.wasPlaying) resetToWaiting(S.armed ? "Stopped: launch a scene" : S.status);
		S.wasPlaying = false;
		S.lastTime = null;
		render(now);
		return;
	}
	if (!S.wasPlaying) {
		S.wasPlaying = true;
		S.probeAt = Date.now() + 300;
	}

	// Transport jump (arrangement loop, click in the timeline): keep bars remaining.
	if (S.lastTime !== null && S.cur) {
		var delta = now - S.lastTime;
		if (delta < -0.25 || delta > 4 * S.bar) {
			var shift = Math.round(delta / S.bar) * S.bar;
			S.start += shift;
			if (S.commit) S.commit.target += shift;
			if (S.dueB !== null) S.dueB += shift;
			setStatus("Transport jumped: check timing");
		}
	}
	S.lastTime = now;

	if (!S.armed) { render(now); return; }

	// Started by Play, or by a scene launch that gave no is_triggered notification.
	if (!S.cur && !S.commit && S.probeAt && Date.now() >= S.probeAt) {
		S.probeAt = 0;
		probePlayingScene(now);
	}

	// Commit that has not been confirmed by a notification.
	if (S.commit && now > S.commit.target + 0.5) {
		if (first(at("live_set scenes " + (S.commit.scene - 1)).get("is_triggered"))) {
			S.commit.target += S.bar; // Live launches at a later bar line
		} else {
			post("ROUTER: launch of scene " + S.commit.scene + " had no notification, assuming it launched\n");
			adopt(S.commit.scene, S.commit.target, S.commitFlip);
			setStatus("Launch unconfirmed: check section");
		}
	}

	if (S.nextReq) {
		S.nextReq = false;
		if (S.cur && !S.commit) {
			var nx = nextSong(S.sec);
			if (nx) {
				if (S.enabled) fire(nx, now);
			} else {
				setStatus("END: no next song scene");
			}
		}
	}

	if (S.prevReq) {
		S.prevReq = false;
		if (S.cur && !S.commit) {
			var px = previousSong(S.sec);
			if (px) {
				if (S.enabled) fire(px, now);
			} else {
				setStatus("BEGINNING: no previous song scene");
			}
		}
	}

	if (!S.enabled) S.dueB = null;
	else if (S.cur && !S.commit) schedule(now, tempo);
	render(now);
}

function schedule(now, tempo) {
	var dest = destination();
	var B = nextBoundary(now);
	if (!dest || B === null) { S.dueB = null; return; }

	var perSec = tempo / 60;
	var lead = Math.min(Math.max(1, LEAD_SECONDS * perSec), Math.max(S.bar - 0.5, 0.5));
	var margin = MARGIN_SECONDS * perSec;
	var remaining = B - now;

	var missed = S.dueB !== null && now >= S.dueB; // main thread stalled past the boundary
	var due = false;
	if (missed) {
		due = true;
		setStatus("LATE: launching at next bar");
	} else if (remaining <= lead) {
		// A press inside the margin is too close to be safe, so it waits a cycle.
		// A request made earlier is still fired; if it misses, Live launches a bar late.
		due = remaining >= margin || S.dueB === B;
	} else {
		S.dueB = B;
	}
	if (!due) return;

	if (!anyClipPlaying()) { // Stop All Clips or similar: do not bring the band back
		resetToWaiting("Clips stopped: launch a scene");
		return;
	}
	fire(dest, now);
}

function probePlayingScene(now) {
	var votes = slotVotes(), best = 0, bestCount = 0;
	for (var k in votes) {
		var n = parseInt(k, 10);
		if (MAP[n] && votes[k] > bestCount) { best = n; bestCount = votes[k]; }
	}
	if (best) {
		S.bar = barBeats();
		adopt(best, Math.floor(now / S.bar + 1e-6) * S.bar, false);
		setStatus(now < 0.5 ? okStatus() : "Synced mid-play: relaunch for exact timing");
	} else {
		setStatus("Waiting: launch a scene");
	}
}

// ---- lamps ----
function hex(c) { return ("00000" + c.toString(16)).slice(-6).toUpperCase(); }
function mostCommon(counts, fallback) {
	var best = fallback, bestCount = 0;
	for (var k in counts) {
		if (counts[k] > bestCount) { best = parseInt(k, 10); bestCount = counts[k]; }
	}
	return best;
}
function rgba(c) { return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, 1]; }
function textFor(c) { // black on light colours, white on dark ones
	var luma = 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);
	return luma > 110 ? 0x000000 : 0xFFFFFF;
}
function sendColor(name, attr, c) {
	var key = name + attr;
	if (lastLamp[key] === c) return;
	lastLamp[key] = c;
	var v = rgba(c);
	outlet(5, name, attr, v[0], v[1], v[2], v[3]);
}
function applyPalette() {
	palette.song = SONG_COLOR ? parseInt(SONG_COLOR, 16) : mostCommon(tally.song, FALLBACK_COLORS.song);
	palette.jam = JAM_COLOR ? parseInt(JAM_COLOR, 16) : mostCommon(tally.jam, FALLBACK_COLORS.jam);
	post("ROUTER lamp colours: SONG #" + hex(palette.song) + ", JAM #" + hex(palette.jam) + "\n");
	var names = ["song", "jam"];
	for (var i = 0; i < 2; i++) { // colours while the button is physically held
		sendColor(names[i], "activebgoncolor", palette[names[i]]);
		sendColor(names[i], "activetextoncolor", textFor(palette[names[i]]));
	}
}
function otherMode(m) { return m === "song" ? "jam" : "song"; }
function requestedMode() {
	var want = "";
	if (S.commit) {
		var k = MAP[S.commit.scene].kind;
		want = S.commitFlip ? otherMode(k) : k;
	} else if (S.cur && S.flip) {
		want = otherMode(S.mode);
	}
	return want === S.mode ? "" : want;
}
function renderLamp(name, want) {
	var blinkOn = Math.floor(Date.now() / BLINK_MS) % 2 === 0;
	var lit = S.mode === name || (want === name && blinkOn);
	var c = palette[name];
	sendColor(name, "activebgcolor", lit ? c : 0x2B2B2B);
	sendColor(name, "activetextcolor", lit ? textFor(c) : 0x8A8A8A);
}

// ---- display ----
function send(i, text) {
	if (lastOut[i] !== text) {
		lastOut[i] = text;
		outlet(i, "set", text);
	}
}
function render(now) {
	send(6, S.title || "--");
	if (lastScene !== S.cur) { lastScene = S.cur; outlet(7, "scene", S.cur); }
	send(0, S.cur ? SECTIONS[S.sec].name : "--");
	send(1, S.mode === "song" ? "SONG" : (S.mode === "jam" ? "JAM" : "--"));
	var pending, bars = "--";
	if (S.commit) {
		pending = "LOCKED: " + sceneLabel(S.commit.scene);
		if (S.commitFlip) pending += ", then switch";
		bars = "launching";
	} else if (S.cur) {
		var d = destination();
		if (d) pending = sceneLabel(d) + (S.flip ? " (requested)" : "");
		else pending = S.mode === "jam" ? "Loop JAM" : "END: holds";
		var B = nextBoundary(now);
		if (B !== null) bars = String(Math.max(1, Math.ceil((B - now) / S.bar - 1e-6)));
	} else {
		pending = "--";
	}
	send(2, pending);
	send(3, bars);
	send(4, S.enabled ? S.status : "DEVICE OFF: not launching");
	var want = requestedMode();
	renderLamp("song", want);
	renderLamp("jam", want);
}

// ---- messages from the patch ----
function init() {
	var enabledWas = S.enabled !== false;
	if (api) unbindObservers();
	S = freshState();
	S.enabled = enabledWas;
	lastOut = [];
	lastLamp = {};
	lastScene = -1;
	api = new LiveAPI(function () { }, "live_set");
	songApi = new LiveAPI(function () { }, "live_set");
	scan();
	if (S.armed) ensureQuantization();
	bindObservers();
	S.ready = true;
	S.scenesDirty = false;
	S.probeAt = 0;
	render(0);
}
function toggle() {
	if (!S.ready) return;
	var t = Date.now();
	if (t - S.lastPress < DEBOUNCE_MS) return;
	S.lastPress = t;
	if (S.commit) {
		var m = MAP[S.commit.scene];
		if (m.kind === "jam" && !nextSong(m.sec)) { setStatus("END: no next song scene"); return; }
		S.commitFlip = !S.commitFlip;
		return;
	}
	if (!S.cur) { setStatus("Waiting: launch a scene first"); return; }
	if (S.mode === "jam" && !nextSong(S.sec)) { setStatus("END: no next song scene"); return; }
	S.flip = !S.flip;
}
// Direct mode request from the SONG and JAM lamps. Unlike toggle, repeat presses change nothing.
function request(m) {
	if (!S.ready) return;
	if (S.commit) {
		var k = MAP[S.commit.scene];
		if (m === "song" && k.kind === "jam" && !nextSong(k.sec)) { setStatus("END: no next song scene"); return; }
		S.commitFlip = m !== k.kind;
		return;
	}
	if (!S.cur) { setStatus("Waiting: launch a scene first"); return; }
	if (m === "song" && S.mode === "jam" && !nextSong(S.sec)) { setStatus("END: no next song scene"); return; }
	S.flip = m !== S.mode;
}
function reqsong() { request("song"); }
function reqjam() { request("jam"); }
function cancel() {
	if (!S.ready) return;
	S.flip = false;
	S.commitFlip = false;
	S.nextReq = false;
	S.prevReq = false;
	if (S.commit) setStatus("Too late to cancel: already fired");
}
function next() {
	if (S.ready) S.nextReq = true;
}
function prev() {
	if (S.ready) S.prevReq = true;
}
function rescan() {
	if (!S.ready) return;
	if (first(songApi.get("is_playing"))) { setStatus("Stop transport to RESCAN"); return; }
	unbindObservers();
	resetToWaiting("");
	scan();
	if (S.armed) ensureQuantization();
	bindObservers();
	S.scenesDirty = false;
}
function enabled(v) { S.enabled = !!v; }
function notifydeleted() {
	S.ready = false;
	unbindObservers();
}
S = freshState();
