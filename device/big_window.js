// Scales a window's contents to fit the window. Used by the large window and the mixer.
// Arguments: design width, design height, then the varnames of the objects to scale.
// No Live API access and no shared state with song_jam_router.js, so a layout problem here
// cannot affect scene launching.
// Called about 7 times a second once the window has been opened. It does nothing unless
// the window is visible and its size has changed. ES5 only.

autowatch = 0;
inlets = 1;
outlets = 1;

var DESIGN_W = jsarguments[1], DESIGN_H = jsarguments[2]; // must match the patcher's "rect"
var MIN_FONT = 8;
var NAMES = [];
for (var a = 3; a < jsarguments.length; a++) NAMES.push(jsarguments[a]);

var base = null; // varname -> { obj, rect, font }, read once from the patch
var lastW = 0, lastH = 0;
var failed = false;

function capture(patcher) {
	var result = {};
	for (var i = 0; i < NAMES.length; i++) {
		var o = patcher.getnamed(NAMES[i]);
		if (!o) throw new Error("no object named " + NAMES[i]);
		var r = o.getboxattr("presentation_rect");
		var f = o.getattr("fontsize");
		result[NAMES[i]] = { obj: o, rect: [r[0], r[1], r[2], r[3]], font: f instanceof Array ? f[0] : f };
	}
	return result;
}

function layout(w, h) {
	var sx = w / DESIGN_W, sy = h / DESIGN_H;
	var fontScale = Math.min(sx, sy); // text must fit both ways, so it follows the tighter axis
	for (var i = 0; i < NAMES.length; i++) {
		var b = base[NAMES[i]];
		b.obj.setboxattr("presentation_rect", [
			Math.round(b.rect[0] * sx), Math.round(b.rect[1] * sy),
			Math.round(b.rect[2] * sx), Math.round(b.rect[3] * sy)
		]);
		b.obj.setattr("fontsize", Math.max(MIN_FONT, Math.round(b.font * fontScale)));
	}
}

// Changes the width the layout treats as full size, and redraws on the next poll.
function design(width) {
	DESIGN_W = width;
	lastW = 0;
}

function poll() {
	if (failed) return;
	try {
		var win = this.patcher.wind;
		if (!win || !win.visible) return;
		var size = win.size;
		if (size[0] === lastW && size[1] === lastH) return;
		if (!base) base = capture(this.patcher);
		layout(size[0], size[1]);
		lastW = size[0];
		lastH = size[1];
	} catch (e) {
		failed = true; // stop retrying; the window keeps its last layout
		post("ROUTER window resize disabled: " + e.message + "\n");
	}
}
