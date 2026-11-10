// Mixer: one strip per top-level group track, found from the Live Set. Shown in its own
// window, plus a MIDI-mappable mute button per group in the device view. Separate from
// song_jam_router.js, from which it receives only the current scene number. ES5 only.

autowatch = 0;
inlets = 1;
outlets = 1;

var MAX_STRIPS = 12;
// Layout, matching mixer_view() in tools/build_device.py.
var STRIP_PITCH = 92.5, SIDE_MARGIN = 10, STRIP_GAP = 2.5, MIN_COLUMNS = 3;
var designWidth = 1120; // the window's width as built
var fittedCount = -1;
var ICON_PLAYING = [0.36, 0.82, 0.62, 1]; // Live's transport play green
var COLOR_ACTIVE = [1.0, 0.85, 0.0, 1]; // yellow = playing (unmuted), like Live's track activator
var COLOR_OFF = [0.17, 0.17, 0.17, 1];
var TEXT_ON = [0, 0, 0, 1];
var TEXT_OFF = [0.6, 0.6, 0.6, 1];

var api = null;
var tracksWatcher = null;
var strips = []; // { name, track, kids: [track indexes], muted, playing, watcher, muteDirty }
var curScene = 0;
var ready = false;
var tracksDirty = false;
var trackIds = "";
var pollIndex = 0;

function first(v) { return (v && v.length !== undefined && typeof v !== "string") ? v[0] : v; }
function clean(x) { return String(x).replace(/^[\s"]+|[\s"]+$/g, ""); }
function at(path) { api.goto(path); return api; }
function trackPath(t) { return "live_set tracks " + t; }
function box(name) { return this.patcher.getnamed(name); }
// The device view's mute buttons live in the parent patcher, because Live can only MIDI-map
// parameters shown in the device.
function deviceButton(i) {
	var parent = this.patcher.parentpatcher;
	return parent ? parent.getnamed("dmute_" + i) : null;
}

function setStatus(text) { box("status").message("set", text); }

function paint(o, color, text) {
	if (!o) return;
	o.message("activebgcolor", color[0], color[1], color[2], color[3]);
	o.message("activetextcolor", text[0], text[1], text[2], text[3]);
}
function paintPlay(i) {
	paint(box("play_" + i), COLOR_OFF, strips[i].playing ? ICON_PLAYING : TEXT_OFF);
}
function paintMute(i, updateDevice) {
	var muted = strips[i].muted;
	paint(box("mute_" + i), muted ? COLOR_OFF : COLOR_ACTIVE, muted ? TEXT_OFF : TEXT_ON);
	// The device button is an on/off switch whose value is "group active". "set" changes it
	// without output, so mirroring Live's state can't send a command back.
	// Only update the device button when explicitly requested (not from observer callbacks).
	if (updateDevice) {
		var dev = deviceButton(i);
		if (dev) dev.message("set", muted ? 0 : 1);
	}
}

function unwatch() {
	for (var i = 0; i < strips.length; i++) strips[i].watcher.property = "";
	strips = [];
}

function makeMuteCallback(i) {
	return function (args) {
		// Record state only: Live forbids changing the set from a notification.
		// The deferred tick applies the parameter update.
		if (args && args[0] === "mute" && strips[i]) {
			strips[i].muted = !!args[1];
			strips[i].muteDirty = true;
			paintMute(i, false);
		}
	};
}

// Reads every track once. Tracks attach to their outermost group, including through nested groups.
function build() {
	unwatch();
	var count = at("live_set").getcount("tracks");
	var info = [], byId = {}, t;
	for (t = 0; t < count; t++) {
		var tr = at(trackPath(t));
		var parent = tr.get("group_track");
		info.push({
			index: t,
			id: String(tr.id),
			parent: String(parent[1]),
			group: !!first(tr.get("is_foldable")),
			name: clean(tr.getstring("name"))
		});
		byId[info[t].id] = info[t];
	}
	var found = [], stripFor = {};
	for (t = 0; t < count; t++) {
		if (info[t].group && !byId[info[t].parent]) {
			stripFor[info[t].id] = found.length;
			found.push({ name: info[t].name, track: t, kids: [], muted: false, playing: false, watcher: null, muteDirty: false });
		}
	}
	for (t = 0; t < count; t++) {
		if (info[t].group) continue;
		var top = info[t];
		while (byId[top.parent]) top = byId[top.parent];
		if (top !== info[t] && stripFor[top.id] !== undefined) found[stripFor[top.id]].kids.push(t);
	}
	if (found.length > MAX_STRIPS) {
		post("MIXER: " + found.length + " groups, showing the first " + MAX_STRIPS + "\n");
		found = found.slice(0, MAX_STRIPS);
	}
	strips = found;
	trackIds = String(at("live_set").get("tracks"));
	for (var s = 0; s < MAX_STRIPS; s++) {
		var used = s < strips.length;
		var parts = ["name_", "play_", "stop_", "mute_"];
		for (var p = 0; p < parts.length; p++) box(parts[p] + s).hidden = used ? 0 : 1;
		var dev = deviceButton(s);
		if (dev) dev.hidden = used ? 0 : 1;
		if (!used) continue;
		box("name_" + s).message("set", strips[s].name);
		if (dev) {
			dev.message("text", strips[s].name);
			dev.message("texton", strips[s].name);
		}
		strips[s].muted = !!first(at(trackPath(strips[s].track)).get("mute"));
		strips[s].watcher = new LiveAPI(makeMuteCallback(s), trackPath(strips[s].track));
		strips[s].watcher.property = "mute";
		paintPlay(s);
		paintMute(s, true);
	}
	pollIndex = 0;
	setStatus(strips.length ? "" : "No group tracks found");
	fitWindow();
}

// Fits the window to the strips in use, keeping any zoom the user has set by resizing.
// Runs only when the number of strips changes, so a chosen window size otherwise stays.
function fitWindow() {
	var win = this.patcher.wind;
	if (!win || !win.visible) return; // fitted when the window is next opened
	if (strips.length === fittedCount) return;
	fittedCount = strips.length;
	var columns = Math.max(strips.length, MIN_COLUMNS);
	var width = 2 * SIDE_MARGIN + columns * STRIP_PITCH - STRIP_GAP;
	var size = win.size;
	var newWidth = Math.round(width * size[0] / designWidth);
	designWidth = width;
	outlet(0, "design", width);
	win.size = [newWidth, size[1]];
}

function scene(n) { curScene = n; }

// Sent once the device has loaded, so the device's mute buttons work without the window.
function init() {
	if (!api) api = new LiveAPI(function () {}, "live_set");
	if (!tracksWatcher) {
		tracksWatcher = new LiveAPI(function () { tracksDirty = true; }, "live_set");
		tracksWatcher.property = "tracks";
	}
	build();
	tracksDirty = false;
	ready = true;
}

// Sent each time the window is opened, so reopening also picks up renamed tracks.
function opened() {
	init();
	fitWindow();
}

// Rebuilds if tracks were added, removed or moved, so a button never acts on the wrong track.
function refresh() {
	if (!tracksDirty) return;
	tracksDirty = false;
	if (String(at("live_set").get("tracks")) !== trackIds) build();
}

// Runs in a deferred context, even when the window is closed, to apply pending parameter updates.
function tick() {
	if (!ready) return;
	for (var i = 0; i < strips.length; i++) {
		if (strips[i].muteDirty) {
			strips[i].muteDirty = false;
			var dev = deviceButton(i);
			if (dev) dev.message("set", strips[i].muted ? 0 : 1);
		}
	}
}

// Checks one strip per call, and only while the window is visible, to keep the load small.
function poll() {
	if (!ready) return;
	var win = this.patcher.wind;
	if (!win || !win.visible) return;
	refresh();
	if (!strips.length) return;
	pollIndex = (pollIndex + 1) % strips.length;
	var s = strips[pollIndex], playing = false;
	for (var k = 0; k < s.kids.length && !playing; k++) {
		playing = first(at(trackPath(s.kids[k])).get("playing_slot_index")) >= 0;
	}
	if (playing !== s.playing) {
		s.playing = playing;
		paintPlay(pollIndex);
	}
}

// PLAY launches this group's clips from the current section's scene, through Global
// Quantization. Empty slots are skipped, so it can't trigger a stop button.
function play(i) {
	if (!ready) return;
	refresh();
	if (!strips[i]) return;
	if (!curScene) { setStatus("PLAY: no current section. Launch a scene first"); return; }
	var fired = 0;
	for (var k = 0; k < strips[i].kids.length; k++) {
		var slot = trackPath(strips[i].kids[k]) + " clip_slots " + (curScene - 1);
		if (first(at(slot).get("has_clip"))) {
			api.call("fire");
			fired++;
		}
	}
	setStatus(fired ? "" : strips[i].name + " has no clips in this section");
}
function stop(i) {
	if (!ready) return;
	refresh();
	if (!strips[i]) return;
	for (var k = 0; k < strips[i].kids.length; k++) at(trackPath(strips[i].kids[k])).call("stop_all_clips");
}
function mute(i) {
	if (!ready) return;
	refresh();
	if (!strips[i]) return;
	// The display changes when Live's notification confirms the new state.
	at(trackPath(strips[i].track)).set("mute", strips[i].muted ? 0 : 1);
}
// From the device's MIDI-mappable switches: 1 = group playing, 0 = muted. It sets the state
// rather than flipping it, so a repeated or late message can't invert the mute.
function active(i, on) {
	if (!ready) return;
	refresh();
	if (!strips[i]) return;
	var mute = on ? 0 : 1;
	if (mute === (strips[i].muted ? 1 : 0)) return;
	at(trackPath(strips[i].track)).set("mute", mute);
}
function notifydeleted() {
	ready = false;
	unwatch();
	if (tracksWatcher) tracksWatcher.property = "";
}
