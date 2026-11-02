// Mixer window: one strip per top-level group track, found from the Live Set.
// Separate from song_jam_router.js. It receives only the current scene number, and does
// nothing until the window is first opened. ES5 only.

autowatch = 0;
inlets = 1;
outlets = 1;

var MAX_STRIPS = 12;
// Layout, matching mixer_view() in tools/build_device.py.
var STRIP_PITCH = 92.5, SIDE_MARGIN = 10, STRIP_GAP = 2.5, MIN_COLUMNS = 3;
var designWidth = 1120; // the window's width as built
var fittedCount = -1;
var ICON_PLAYING = [0.36, 0.82, 0.62, 1]; // Live's transport play green
var COLOR_MUTED = [1.0, 0.69, 0.0, 1];
var COLOR_OFF = [0.17, 0.17, 0.17, 1];
var TEXT_ON = [0, 0, 0, 1];
var TEXT_OFF = [0.6, 0.6, 0.6, 1];

var api = null;
var tracksWatcher = null;
var strips = []; // { name, track, kids: [track indexes], muted, playing, watcher }
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

function setStatus(text) { box("status").message("set", text); }

function paint(name, color, text) {
	var o = box(name);
	o.message("activebgcolor", color[0], color[1], color[2], color[3]);
	o.message("activetextcolor", text[0], text[1], text[2], text[3]);
}
function paintPlay(i) {
	paint("play_" + i, COLOR_OFF, strips[i].playing ? ICON_PLAYING : TEXT_OFF);
}
function paintMute(i) {
	paint("mute_" + i, strips[i].muted ? COLOR_MUTED : COLOR_OFF, strips[i].muted ? TEXT_ON : TEXT_OFF);
}

function unwatch() {
	for (var i = 0; i < strips.length; i++) strips[i].watcher.property = "";
	strips = [];
}

function makeMuteCallback(i) {
	return function (args) {
		// A UI update only: Live forbids changing the set from a notification.
		if (args && args[0] === "mute" && strips[i]) {
			strips[i].muted = !!args[1];
			paintMute(i);
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
			found.push({ name: info[t].name, track: t, kids: [], muted: false, playing: false, watcher: null });
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
		if (!used) continue;
		box("name_" + s).message("set", strips[s].name);
		strips[s].muted = !!first(at(trackPath(strips[s].track)).get("mute"));
		strips[s].watcher = new LiveAPI(makeMuteCallback(s), trackPath(strips[s].track));
		strips[s].watcher.property = "mute";
		paintPlay(s);
		paintMute(s);
	}
	pollIndex = 0;
	setStatus(strips.length ? "" : "No group tracks found");
	fitWindow();
}

// Fits the window to the strips in use, keeping any zoom the user has set by resizing.
// Runs only when the number of strips changes, so a chosen window size otherwise stays.
function fitWindow() {
	if (strips.length === fittedCount) return;
	fittedCount = strips.length;
	var win = this.patcher.wind;
	if (!win) return;
	var columns = Math.max(strips.length, MIN_COLUMNS);
	var width = 2 * SIDE_MARGIN + columns * STRIP_PITCH - STRIP_GAP;
	var size = win.size;
	var newWidth = Math.round(width * size[0] / designWidth);
	designWidth = width;
	outlet(0, "design", width);
	win.size = [newWidth, size[1]];
}

function scene(n) { curScene = n; }

// Sent each time the window is opened, so reopening also picks up renamed tracks.
function opened() {
	if (!api) api = new LiveAPI(function () {}, "live_set");
	if (!tracksWatcher) {
		tracksWatcher = new LiveAPI(function () { tracksDirty = true; }, "live_set");
		tracksWatcher.property = "tracks";
	}
	build();
	tracksDirty = false;
	ready = true;
}

// Checks one strip per call, and only while the window is visible, to keep the load small.
function poll() {
	if (!ready) return;
	var win = this.patcher.wind;
	if (!win || !win.visible) return;
	if (tracksDirty) {
		tracksDirty = false;
		if (String(at("live_set").get("tracks")) !== trackIds) build();
	}
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
	if (!ready || !strips[i]) return;
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
	if (!ready || !strips[i]) return;
	for (var k = 0; k < strips[i].kids.length; k++) at(trackPath(strips[i].kids[k])).call("stop_all_clips");
}
function mute(i) {
	if (!ready || !strips[i]) return;
	// The display changes when Live's notification confirms the new state.
	at(trackPath(strips[i].track)).set("mute", strips[i].muted ? 0 : 1);
}
function notifydeleted() {
	ready = false;
	unwatch();
	if (tracksWatcher) tracksWatcher.property = "";
}
