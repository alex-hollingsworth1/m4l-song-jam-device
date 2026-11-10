#!/usr/bin/env python3
"""Generate device/SongJamRouter.amxd (a Max MIDI Effect) from the patch description below."""
import json, struct, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "device" / "SongJamRouter.amxd"
WIDTH = 300  # main section; the device is wider, to fit the mute buttons
DEVICE_WIDTH = 436
FONT = "Ableton Sans Medium Regular"  # the font in Ableton's own device template
boxes, lines = [], []


def add(box_id, **attrs):
    boxes.append({"box": {"id": box_id, **attrs}})


def obj(box_id, text, inlets, outlets, x, y, outlettype=None):
    add(
        box_id,
        maxclass="newobj",
        text=text,
        numinlets=inlets,
        numoutlets=outlets,
        outlettype=outlettype or [""] * outlets,
        patching_rect=[x, y, 150, 22],
    )


def sel1(box_id, x, y):
    """Filters button output to pass only press (1), not release (0)."""
    obj(box_id, "sel 1", 1, 1, x, y, ["bang"])


def msg(box_id, text, x, y):
    add(
        box_id,
        maxclass="message",
        text=text,
        numinlets=2,
        numoutlets=1,
        outlettype=[""],
        patching_rect=[x, y, 80, 22],
    )


def wire(src, dst, src_out=0, dst_in=0):
    lines.append(
        {"patchline": {"source": [src, src_out], "destination": [dst, dst_in]}}
    )


def button(
    box_id,
    label,
    longname,
    short,
    rect,
    patch_x,
    fontsize=10.0,
    varname=None,
    mode=0,
    **extra,
):
    add(
        box_id,
        maxclass="live.text",
        text=label,
        texton=label,
        mode=mode,
        numinlets=1,
        numoutlets=2,
        outlettype=["", ""],
        parameter_enable=1,
        fontname=FONT,
        fontsize=fontsize,
        varname=varname or short.lower(),
        patching_rect=[patch_x, 300, 60, 20],
        presentation=1,
        presentation_rect=rect,
        saved_attribute_attributes={
            "valueof": {
                "parameter_enum": ["val1", "val2"],
                "parameter_longname": longname,
                "parameter_mmax": 1,
                "parameter_shortname": short,
                "parameter_type": 2,
            }
        },
        **extra,
    )


def label(box_id, text, rect, y, size=10.0):
    add(
        box_id,
        maxclass="comment",
        text=text,
        numinlets=1,
        numoutlets=0,
        fontname=FONT,
        fontsize=size,
        patching_rect=[500, y, 200, 20],
        presentation=1,
        presentation_rect=rect,
    )


WINDOW_BG = [0.09, 0.09, 0.09, 1.0]
WHITE, GREY = [1.0, 1.0, 1.0, 1.0], [0.6, 0.6, 0.6, 1.0]


def text(box_id, value, rect, y, size, color, **extra):
    add(
        box_id,
        maxclass="comment",
        text=value,
        numinlets=1,
        numoutlets=0,
        fontname=FONT,
        fontsize=size,
        textcolor=color,
        varname=box_id,
        patching_rect=[800, y, 200, 20],
        presentation=1,
        presentation_rect=rect,
        **extra,
    )


def big_button(box_id, value, rect, x, size, m, patch_y=300, **extra):
    add(
        box_id,
        maxclass="live.text",
        text=value,
        texton=value,
        mode=0,
        numinlets=1,
        numoutlets=2,
        outlettype=["", ""],
        parameter_enable=0,
        fontname=FONT,
        fontsize=size,
        varname=box_id,
        patching_rect=[x, patch_y, 80, 20],
        presentation=1,
        presentation_rect=rect,
        **extra,
    )
    sel1("sel_" + box_id, x, patch_y + 25)
    msg("m_" + box_id, m, x, patch_y + 40)
    wire(box_id, "sel_" + box_id)
    wire("sel_" + box_id, "m_" + box_id)
    wire("m_" + box_id, "out")


def icon(svg):
    """live.text attributes that draw an SVG in the button's text colour."""
    return {
        "usepicture": 1,
        "pictures": [svg, svg],
        "remapsvgcolors": 1,
        "usesvgviewbox": 1,
        "activetextcolor": GREY,
        "activetextoncolor": WHITE,
    }


def window_patcher(width, height, x=200.0, y=120.0):
    return {
        "fileversion": 1,
        "appversion": {
            "major": 9,
            "minor": 1,
            "revision": 5,
            "architecture": "x64",
            "modernui": 1,
        },
        "classnamespace": "box",
        "rect": [x, y, float(width), float(height)],
        "openinpresentation": 1,
        "bgcolor": WINDOW_BG,
        "editing_bgcolor": WINDOW_BG,
        "locked_bgcolor": WINDOW_BG,
        "toolbarvisible": 0,
        "statusbarvisible": 0,
        "default_fontsize": 12.0,
        "default_fontname": FONT,
        "boxes": boxes,
        "lines": lines,
    }


def scaling(width, height, names, x):
    """Scales the named objects with the window. Starts when the window is first opened."""
    msg("m_win_on", "1", x, 60)
    obj("win_metro", "metro 150", 2, 1, x, 95, ["bang"])
    obj("win_defer", "deferlow", 1, 1, x, 125)
    msg("m_poll", "poll", x, 155)
    obj("win_js", f"js big_window.js {width} {height} " + " ".join(names), 1, 1, x, 185)
    wire("in_cfg", "m_win_on")
    wire("m_win_on", "win_metro")
    wire("win_metro", "win_defer")
    wire("win_defer", "m_poll")
    wire("m_poll", "win_js")


def mixer_view():
    """The mixer window. mixer.js finds the group tracks and hides any unused strips."""
    global boxes, lines
    outer_boxes, outer_lines = boxes, lines
    boxes, lines = [], []
    width, height, strip_w = 1120, 280, 90
    add(
        "in_pc",
        maxclass="inlet",
        numinlets=0,
        numoutlets=1,
        outlettype=[""],
        patching_rect=[10, 10, 30, 30],
    )
    add(
        "in_cfg",
        maxclass="inlet",
        numinlets=0,
        numoutlets=1,
        outlettype=[""],
        patching_rect=[60, 10, 30, 30],
    )
    add(
        "in_scene",
        maxclass="inlet",
        numinlets=0,
        numoutlets=1,
        outlettype=[""],
        patching_rect=[110, 10, 30, 30],
    )
    add(
        "in_cmd",
        maxclass="inlet",
        numinlets=0,
        numoutlets=1,
        outlettype=[""],
        patching_rect=[160, 10, 30, 30],
    )
    add(
        "out",
        maxclass="outlet",
        numinlets=1,
        numoutlets=0,
        patching_rect=[10, 240, 30, 30],
    )
    msg("m_cfg", 'presentation 1, topmost 1, title "Song Jam Mixer"', 60, 60)
    obj("thispatcher", "thispatcher", 1, 2, 60, 95, ["", ""])
    wire("in_cfg", "m_cfg")
    wire("m_cfg", "thispatcher")

    obj("mix_js", "js mixer.js", 1, 1, 210, 190)
    msg("m_opened", "opened", 210, 60)
    # Deferred tick for parameter updates, runs even when window is closed
    msg("m_tick_on", "1", 380, 60)
    obj("tick_metro", "metro 50", 2, 1, 380, 95, ["bang"])
    obj("tick_defer", "deferlow", 1, 1, 380, 125)
    msg("m_tick", "tick", 380, 155)
    wire("in_cfg", "m_tick_on")
    wire("m_tick_on", "tick_metro")
    wire("tick_metro", "tick_defer")
    wire("tick_defer", "m_tick")
    wire("m_tick", "mix_js")
    # Poll for playing state, runs only when window is visible
    msg("m_mix_on", "1", 300, 60)
    obj("mix_metro", "metro 200", 2, 1, 300, 95, ["bang"])
    obj("mix_defer", "deferlow", 1, 1, 300, 125)
    msg("m_mix_poll", "poll", 300, 155)
    wire("in_cfg", "m_opened")
    wire("m_opened", "mix_js")
    wire("in_cfg", "m_mix_on")
    wire("m_mix_on", "mix_metro")
    wire("mix_metro", "mix_defer")
    wire("mix_defer", "m_mix_poll")
    wire("m_mix_poll", "mix_js")
    wire("in_scene", "mix_js")
    wire("in_cmd", "mix_js")
    # Tells the scaling script the layout width, once scaling() below has created it.

    names = ["status"]
    for i in range(12):
        x = 10 + i * (strip_w + 2.5)
        text(
            f"name_{i}",
            "--",
            [x, 10, strip_w, 40],
            300 + i * 25,
            12.0,
            WHITE,
            textjustification=1,
        )
        big_button(
            f"play_{i}",
            "PLAY",
            [x, 54, strip_w, 58],
            600 + i * 100,
            14.0,
            f"play {i}",
            300,
            **icon("icon_play.svg"),
        )
        big_button(
            f"stop_{i}",
            "STOP",
            [x, 118, strip_w, 58],
            600 + i * 100,
            14.0,
            f"stop {i}",
            400,
            **icon("icon_stop.svg"),
        )
        big_button(
            f"mute_{i}",
            "M",
            [x, 182, strip_w, 58],
            600 + i * 100,
            18.0,
            f"mute {i}",
            500,
        )
        names += [f"name_{i}", f"play_{i}", f"stop_{i}", f"mute_{i}"]
    text("status", "", [10, 246, 420, 26], 280, 13.0, GREY)
    scaling(width, height, names, 400)
    wire("mix_js", "win_js")

    # Buttons reach the script directly rather than through the patcher's outlet.
    lines[:] = [l for l in lines if l["patchline"]["destination"][0] != "out"]
    for b in boxes:
        if b["box"]["id"].startswith("m_") and b["box"]["id"][2:7] in (
            "play_",
            "stop_",
            "mute_",
        ):
            wire(b["box"]["id"], "mix_js")

    sub = window_patcher(width, height, 120.0, 420.0)
    boxes, lines = outer_boxes, outer_lines
    return sub


def big_view():
    """The large window's patcher, built with its own box and line lists."""
    global boxes, lines
    outer_boxes, outer_lines = boxes, lines
    boxes, lines = [], []

    # Inlet order follows x position. Inlet 0 belongs to pcontrol, inlet 1 configures the window.
    add(
        "in_pc",
        maxclass="inlet",
        numinlets=0,
        numoutlets=1,
        outlettype=[""],
        patching_rect=[10, 10, 30, 30],
    )
    add(
        "in_cfg",
        maxclass="inlet",
        numinlets=0,
        numoutlets=1,
        outlettype=[""],
        patching_rect=[60, 10, 30, 30],
    )
    for i in range(7):
        add(
            f"in_{i}",
            maxclass="inlet",
            numinlets=0,
            numoutlets=1,
            outlettype=[""],
            patching_rect=[110 + i * 50, 10, 30, 30],
        )
    add(
        "out",
        maxclass="outlet",
        numinlets=1,
        numoutlets=0,
        patching_rect=[10, 400, 30, 30],
    )
    msg("m_cfg", 'presentation 1, topmost 1, title "Song Jam Router"', 60, 60)
    obj("thispatcher", "thispatcher", 1, 2, 60, 95, ["", ""])
    wire("in_cfg", "m_cfg")
    wire("m_cfg", "thispatcher")

    scaling(
        720,
        505,
        [
            "title",
            "song",
            "jam",
            "cancel",
            "prev",
            "next",
            "cap_0",
            "val_0",
            "cap_2",
            "val_2",
            "cap_3",
            "val_3",
            "val_4",
        ],
        400,
    )

    big_button("song", "SONG", [20, 80, 335, 110], 10, 44.0, "reqsong")
    big_button("jam", "JAM", [365, 80, 335, 110], 100, 44.0, "reqjam")
    big_button("cancel", "CANCEL", [20, 435, 220, 50], 190, 20.0, "cancel")
    big_button("prev", "PREV", [250, 435, 220, 50], 370, 20.0, "prev")
    big_button("next", "NEXT", [480, 435, 220, 50], 280, 20.0, "next")
    obj("route", "route song jam", 3, 3, 110, 95)
    wire("in_5", "route")
    wire("route", "song", 0)
    wire("route", "jam", 1)

    rows = [
        ("Section", 205, 46, 60, 0),
        ("Mode", 0, 0, 0, 1),
        ("Next", 275, 26, 40, 2),
        ("Bars left", 325, 46, 60, 3),
    ]
    for cap, y, size, h, i in rows:
        if (
            cap == "Mode"
        ):  # already shown by the lit lamp; kept wired so all outlets are handled
            continue
        text(f"cap_{i}", cap, [20, y + 8, 110, 24], 40 + i * 25, 16.0, GREY)
        text(f"val_{i}", "--", [130, y, 570, h], 52 + i * 25, size, WHITE)
        wire(f"in_{i}", f"val_{i}")
    text("val_4", "", [20, 395, 680, 30], 170, 15.0, GREY)
    wire("in_4", "val_4")
    text("title", "--", [20, 12, 680, 58], 195, 36.0, WHITE)
    wire("in_6", "title")

    sub = window_patcher(720, 505)
    boxes, lines = outer_boxes, outer_lines
    return sub


# MIDI passes through untouched.
obj("midiin", "midiin", 1, 1, 20, 20, ["int"])
obj("midiout", "midiout", 1, 0, 20, 50)
wire("midiin", "midiout")

# Startup, device on/off and the 50 ms scheduler tick. deferlow moves the tick off the
# high-priority scheduler thread, where the Live API cannot be used.
obj("thisdevice", "live.thisdevice", 1, 3, 200, 20, ["bang", "int", "int"])
msg("m_init", "init", 200, 60)
msg("m_on", "1", 290, 60)
obj("metro", "metro 50", 2, 1, 290, 95, ["bang"])
obj("defer", "deferlow", 1, 1, 290, 125)
msg("m_tick", "tick", 290, 155)
obj("p_enabled", "prepend enabled", 1, 1, 400, 60)
obj("js", "js song_jam_router.js", 1, 8, 200, 230)
wire("thisdevice", "m_init")
wire("thisdevice", "m_on")
wire("m_on", "metro")
wire("metro", "defer")
wire("defer", "m_tick")
wire("m_tick", "js")
wire("m_init", "js")
wire("thisdevice", "p_enabled", 1)
wire("p_enabled", "js")

# Device view. Each button sends a bang on press, which drives a single js message.
button("b_song", "SONG", "Request Song", "Song", [6, 6, 47, 30], 20, 14.0)
button("b_jam", "JAM", "Request Jam", "Jam", [56, 6, 46, 30], 100, 14.0)
button("b_toggle", "TOGGLE", "Song Jam Toggle", "Toggle", [6, 39, 96, 18], 180)
button("b_cancel", "CANCEL", "Cancel Pending", "Cancel", [6, 60, 96, 18], 260)
button("b_prev", "PREV", "Manual Previous", "Prev", [6, 81, 46, 18], 660)
button("b_next", "NEXT", "Manual Next", "Next", [56, 81, 46, 18], 340)
button("b_rescan", "RESCAN", "Rescan Set", "Rescan", [6, 129, 96, 18], 420)
for b, m, x in [
    ("b_song", "reqsong", 20),
    ("b_jam", "reqjam", 100),
    ("b_toggle", "toggle", 180),
    ("b_cancel", "cancel", 260),
    ("b_next", "next", 340),
    ("b_prev", "prev", 660),
    ("b_rescan", "rescan", 420),
]:
    sel1("sel_" + m, x, 315)
    msg("m_" + m, m, x, 340)
    wire(b, "sel_" + m)
    wire("sel_" + m, "m_" + m)
    wire("m_" + m, "js")

# js sends "set <text>" to each value comment, and "song|jam <attr> r g b a" to the lamps.
obj("route", "route song jam", 3, 3, 20, 270)
wire("js", "route", 5)
wire("route", "b_song", 0)
wire("route", "b_jam", 1)

rows = [
    ("Section", 22, 12.0),
    ("Mode", 40, 10.0),
    ("Next", 56, 10.0),
    ("Bars", 72, 10.0),
]
for i, (name, y, size) in enumerate(rows):
    label("cap_" + name, name, [108, y, 44, 18], 20 + i * 25)
    label("val_" + name, "--", [150, y, WIDTH - 154, 18], 20 + i * 25 + 12, size)
    wire("js", "val_" + name, i)
label("val_status", "Loading", [108, 90, WIDTH - 112, 40], 150)
wire("js", "val_status", 4)
label("val_title", "--", [108, 2, WIDTH - 112, 20], 175, 14.0)
wire("js", "val_title", 6)

# Large window: a subpatcher opened by pcontrol. It lives inside the device, so freezing
# needs no extra files. Its buttons have parameter_enable 0, so the mappable controls stay
# the ones in the device view.
button("b_window", "OPEN WINDOW", "Open Window", "Window", [6, 104, 96, 22], 500)
add(
    "big",
    maxclass="newobj",
    text="p BigView",
    numinlets=9,
    numoutlets=1,
    outlettype=[""],
    patching_rect=[20, 400, 300, 22],
    patcher=big_view(),
)
sel1("sel_window", 500, 315)
msg("m_open", "open", 500, 340)
obj("pcontrol", "pcontrol", 1, 1, 500, 370)
obj("t_open", "t b b", 1, 2, 590, 340, ["bang", "bang"])
obj("defer_open", "deferlow", 1, 1, 590, 370)
wire("b_window", "sel_window")
wire("sel_window", "t_open")
wire("t_open", "defer_open", 0)  # right outlet fires first: open, then configure the window
wire("t_open", "m_open", 1)
wire("m_open", "pcontrol")
wire("pcontrol", "big")
wire("defer_open", "big", 0, 1)
for i in range(7):
    wire("js", "big", i, i + 2)
wire("big", "js")

# Mixer window, opened the same way. It stays idle until first opened.
button("b_mixer", "MIXER", "Open Mixer", "Mixer", [6, 149, 96, 18], 740)
add(
    "mixer",
    maxclass="newobj",
    text="p Mixer",
    numinlets=4,
    numoutlets=1,
    outlettype=[""],
    patching_rect=[340, 400, 300, 22],
    patcher=mixer_view(),
)
sel1("sel_mixer", 740, 315)
msg("m_mix_open", "open", 740, 340)
obj("mix_pcontrol", "pcontrol", 1, 1, 740, 370)
obj("t_mix", "t b b", 1, 2, 830, 340, ["bang", "bang"])
obj("defer_mix", "deferlow", 1, 1, 830, 370)
wire("b_mixer", "sel_mixer")
wire("sel_mixer", "t_mix")
wire("t_mix", "defer_mix", 0)
wire("t_mix", "m_mix_open", 1)
wire("m_mix_open", "mix_pcontrol")
wire("mix_pcontrol", "mixer")
wire("defer_mix", "mixer", 0, 1)
wire("js", "mixer", 7, 2)

# MIDI-mappable on/off switches, one per mixer strip: on (yellow) = group playing, off (grey)
# = muted. Live can only map parameters in the device view, and maps notes and buttons onto
# on/off switches natively, so one press is one change. mixer.js names them after the groups,
# hides spares and mirrors Live's mute state. Commands reach it via deferlow, so a
# MIDI-mapped press is never treated as a notification.
YELLOW, OFF_GREY, LIGHT_GREY = (
    [1.0, 0.85, 0.0, 1.0],
    [0.3, 0.3, 0.3, 1.0],
    [0.75, 0.75, 0.75, 1.0],
)
SWITCH_COLORS = {
    "activebgoncolor": YELLOW,
    "bgoncolor": YELLOW,
    "activetextoncolor": [0.0, 0.0, 0.0, 1.0],
    "textcolor": [0.0, 0.0, 0.0, 1.0],
    "activebgcolor": OFF_GREY,
    "bgcolor": OFF_GREY,
    "activetextcolor": LIGHT_GREY,
    "textoffcolor": LIGHT_GREY,
}
obj("mix_cmd_defer", "deferlow", 1, 1, 900, 400)
wire("mix_cmd_defer", "mixer", 0, 3)
msg("m_mix_init", "init", 900, 340)
wire("thisdevice", "m_mix_init")
wire("m_mix_init", "mix_cmd_defer")
for i in range(12):
    col, row = i % 2, i // 2
    button(
        f"b_dmute_{i}",
        "--",
        f"Group {i + 1} Active",
        f"Group {i + 1}",
        [WIDTH + 4 + col * 66, 4 + row * 27, 62, 24],
        900 + i * 70,
        9.0,
        varname=f"dmute_{i}",
        mode=1,
        **SWITCH_COLORS,
    )
    msg(f"m_dmute_{i}", f"active {i} $1", 900 + i * 70, 340)
    wire(f"b_dmute_{i}", f"m_dmute_{i}")
    wire(f"m_dmute_{i}", "mix_cmd_defer")

patcher = {
    "fileversion": 1,
    "appversion": {
        "major": 9,
        "minor": 1,
        "revision": 5,
        "architecture": "x64",
        "modernui": 1,
    },
    "classnamespace": "box",
    "rect": [100.0, 100.0, 760.0, 480.0],
    "openrect": [0.0, 0.0, float(DEVICE_WIDTH), 169.0],
    "openinpresentation": 1,
    "default_fontsize": 10.0,
    "default_fontname": FONT,
    "devicewidth": float(DEVICE_WIDTH),
    "title": "Song Jam Router",
    # Same structure as Ableton's Max MIDI Effect template. Max's freeze and project code
    # expects it, and fails with "a project without a name..." if it's missing.
    "project": {
        "version": 1,
        "creationdate": 3590052786,
        "modificationdate": 3590052786,
        "viewrect": [0.0, 0.0, 300.0, 500.0],
        "autoorganize": 1,
        "hideprojectwindow": 1,
        "showdependencies": 1,
        "autolocalize": 0,
        "contents": {"patchers": {}},
        "layout": {},
        "searchpath": {},
        "detailsvisible": 0,
        "amxdtype": 1835887981,  # "mmmm": MIDI effect
        "readonly": 0,
        "devpathtype": 0,
        "devpath": ".",
        "sortmode": 0,
        "viewmode": 0,
    },
    "boxes": boxes,
    "lines": lines,
    "dependency_cache": [],
    "latency": 0,
    "autosave": 0,
}
body = json.dumps({"patcher": patcher}, indent="\t").encode("utf8") + b"\n\0"
data = (
    b"ampf"
    + struct.pack("<I", 4)
    + b"mmmm"
    + b"meta"
    + struct.pack("<I", 4)
    + struct.pack("<I", 0)
    + b"ptch"
    + struct.pack("<I", len(body))
    + body
)
OUT.write_bytes(data)
print(f"wrote {OUT} ({len(data)} bytes)")
