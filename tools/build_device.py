#!/usr/bin/env python3
"""Generate device/SongJamRouter.amxd (a Max MIDI Effect) from the patch description below."""
import json, struct, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "device" / "SongJamRouter.amxd"
WIDTH = 300
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


def button(box_id, label, longname, short, rect, patch_x, fontsize=10.0):
    add(
        box_id,
        maxclass="live.text",
        text=label,
        texton=label,
        mode=0,
        numinlets=1,
        numoutlets=2,
        outlettype=["", ""],
        parameter_enable=1,
        fontname=FONT,
        fontsize=fontsize,
        varname=short.lower(),
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


def big_view():
    """The large window's patcher, built with its own box and line lists."""
    global boxes, lines
    outer_boxes, outer_lines = boxes, lines
    boxes, lines = [], []
    bg, white, grey = [0.09, 0.09, 0.09, 1.0], [1.0, 1.0, 1.0, 1.0], [0.6, 0.6, 0.6, 1.0]

    def text(box_id, value, rect, y, size, color):
        add(box_id, maxclass="comment", text=value, numinlets=1, numoutlets=0, fontname=FONT, fontsize=size,
            textcolor=color, varname=box_id, patching_rect=[800, y, 200, 20],
            presentation=1, presentation_rect=rect)

    def big_button(box_id, value, rect, x, size, m):
        add(box_id, maxclass="live.text", text=value, texton=value, mode=0, numinlets=1, numoutlets=2,
            outlettype=["", ""], parameter_enable=0, fontname=FONT, fontsize=size, varname=box_id, patching_rect=[x, 300, 80, 20],
            presentation=1, presentation_rect=rect)
        msg("m_" + box_id, m, x, 340)
        wire(box_id, "m_" + box_id)
        wire("m_" + box_id, "out")

    # Inlet order follows x position. Inlet 0 belongs to pcontrol, inlet 1 configures the window.
    add("in_pc", maxclass="inlet", numinlets=0, numoutlets=1, outlettype=[""], patching_rect=[10, 10, 30, 30])
    add("in_cfg", maxclass="inlet", numinlets=0, numoutlets=1, outlettype=[""], patching_rect=[60, 10, 30, 30])
    for i in range(7):
        add(f"in_{i}", maxclass="inlet", numinlets=0, numoutlets=1, outlettype=[""],
            patching_rect=[110 + i * 50, 10, 30, 30])
    add("out", maxclass="outlet", numinlets=1, numoutlets=0, patching_rect=[10, 400, 30, 30])
    msg("m_cfg", 'presentation 1, topmost 1, title "Song Jam Router"', 60, 60)
    obj("thispatcher", "thispatcher", 1, 2, 60, 95, ["", ""])
    wire("in_cfg", "m_cfg")
    wire("m_cfg", "thispatcher")

    # Layout scaling, separate from the router. Starts when the window is first opened.
    msg("m_win_on", "1", 400, 60)
    obj("win_metro", "metro 150", 2, 1, 400, 95, ["bang"])
    obj("win_defer", "deferlow", 1, 1, 400, 125)
    msg("m_poll", "poll", 400, 155)
    obj("win_js", "js big_window.js", 1, 1, 400, 185)
    wire("in_cfg", "m_win_on")
    wire("m_win_on", "win_metro")
    wire("win_metro", "win_defer")
    wire("win_defer", "m_poll")
    wire("m_poll", "win_js")

    big_button("song", "SONG", [20, 80, 335, 110], 10, 44.0, "reqsong")
    big_button("jam", "JAM", [365, 80, 335, 110], 100, 44.0, "reqjam")
    big_button("cancel", "CANCEL", [20, 435, 220, 50], 190, 20.0, "cancel")
    big_button("prev", "PREV", [250, 435, 220, 50], 370, 20.0, "prev")
    big_button("next", "NEXT", [480, 435, 220, 50], 280, 20.0, "next")
    obj("route", "route song jam", 3, 3, 110, 95)
    wire("in_5", "route")
    wire("route", "song", 0)
    wire("route", "jam", 1)

    rows = [("Section", 205, 46, 60, 0), ("Mode", 0, 0, 0, 1), ("Next", 275, 26, 40, 2), ("Bars left", 325, 46, 60, 3)]
    for cap, y, size, h, i in rows:
        if cap == "Mode":   # already shown by the lit lamp; kept wired so all outlets are handled
            continue
        text(f"cap_{i}", cap, [20, y + 8, 110, 24], 40 + i * 25, 16.0, grey)
        text(f"val_{i}", "--", [130, y, 570, h], 52 + i * 25, size, white)
        wire(f"in_{i}", f"val_{i}")
    text("val_4", "", [20, 395, 680, 30], 170, 15.0, grey)
    wire("in_4", "val_4")
    text("title", "--", [20, 12, 680, 58], 195, 36.0, white)
    wire("in_6", "title")

    sub = {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
        "classnamespace": "box",
        "rect": [200.0, 120.0, 720.0, 505.0],
        "openinpresentation": 1,
        "bgcolor": bg, "editing_bgcolor": bg, "locked_bgcolor": bg,
        "toolbarvisible": 0, "statusbarvisible": 0,
        "default_fontsize": 12.0,
        "default_fontname": FONT,
        "boxes": boxes,
        "lines": lines,
    }
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
obj("js", "js song_jam_router.js", 1, 7, 200, 230)
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
for b, m, x in [("b_song", "reqsong", 20), ("b_jam", "reqjam", 100), ("b_toggle", "toggle", 180),
                ("b_cancel", "cancel", 260), ("b_next", "next", 340), ("b_prev", "prev", 660), ("b_rescan", "rescan", 420)]:
    msg("m_" + m, m, x, 340)
    wire(b, "m_" + m)
    wire("m_" + m, "js")

# js sends "set <text>" to each value comment, and "song|jam <attr> r g b a" to the lamps.
obj("route", "route song jam", 3, 3, 20, 270)
wire("js", "route", 5)
wire("route", "b_song", 0)
wire("route", "b_jam", 1)

rows = [("Section", 22, 12.0), ("Mode", 40, 10.0), ("Next", 56, 10.0), ("Bars", 72, 10.0)]
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
add("big", maxclass="newobj", text="p BigView", numinlets=9, numoutlets=1, outlettype=[""],
    patching_rect=[20, 400, 300, 22], patcher=big_view())
msg("m_open", "open", 500, 340)
obj("pcontrol", "pcontrol", 1, 1, 500, 370)
obj("t_open", "t b b", 1, 2, 590, 340, ["bang", "bang"])
obj("defer_open", "deferlow", 1, 1, 590, 370)
wire("b_window", "t_open")
wire("t_open", "defer_open", 0)     # right outlet fires first: open, then configure the window
wire("t_open", "m_open", 1)
wire("m_open", "pcontrol")
wire("pcontrol", "big")
wire("defer_open", "big", 0, 1)
for i in range(7):
    wire("js", "big", i, i + 2)
wire("big", "js")

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
    "openrect": [0.0, 0.0, float(WIDTH), 169.0],
    "openinpresentation": 1,
    "default_fontsize": 10.0,
    "default_fontname": FONT,
    "devicewidth": float(WIDTH),
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
