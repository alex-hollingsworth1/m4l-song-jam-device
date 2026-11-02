# Song/Jam Router (Max for Live)

Quantised SONG/JAM scene router for one live set. **Not performance-ready until the checks below pass in Ableton.** The logic has only been tested against a simulated Live (`node test/simulate.js`). The device has never been loaded in Live.

## Files
- `device/SongJamRouter.amxd`: the device (MIDI effect)
- `device/big_window.js`: scales the large window and mixer contents. It has no Live API access
- `device/mixer.js`: the mixer window's logic
- `device/icon_play.svg`, `device/icon_stop.svg`: the mixer's button icons
- `device/song_jam_router.js`: the router's logic. The scene-name table and bar lengths are at the top
- `tools/build_device.py`: regenerates the `.amxd`. Only needed to change the patch layout
- `test/simulate.js`: logic tests against a fake Live

## How it works
1. Each section's length is in beats, counted from the bar line where it launched.
2. About 1 beat before the boundary (0.5 s minimum), the script calls `Scene.fire`.
3. Global Quantization is held at 1 Bar, so Live launches on the next bar line. Live does the launching, so the timing comes from Live's audio engine and not from Max's timer.
4. `Scene.is_triggered` going 1 then 0 confirms the launch and restarts the bar count.

Nothing touches the current clips until that fire, so a mode change can't restart anything. Live Set changes are only made from a deferred 50 ms tick, never from a notification, which Live forbids.

### What the docs confirm and what they don't
| Item | Status |
|---|---|
| `Scene.fire`, `Scene.is_triggered`, `Song.clip_trigger_quantization`, `Track.playing_slot_index` exist | Documented |
| No Live Set changes from notifications; no Live API on the high-priority thread | Documented |
| LiveAPI needs `live.thisdevice` before use | Documented |
| `Scene.fire` obeys Global Quantization | **Not documented**: test 1 |
| `is_triggered` goes 1 then 0 at the launch | **Assumed from "scene is blinking"**: test 2 |
| Launching a scene while stopped starts the transport and gives a usable state | **Assumed**, with a fallback that reads playing slots: test 3 |
| Song time is in quarter notes in non-4/4 meters | **Assumed**; only matters if you aren't in 4/4 |

### Assumptions that could cause a wrong transition
- **Section length.** With no lengths supplied, each scene uses its longest clip. A long pad or a clip longer than the section gives the wrong length. Check the console table, and set `songBars` / `jamBars` where it's wrong.
- **Clip launch settings.** A clip with its own launch quantization launches off the boundary. The scan warns about this, and about Gate/Toggle/Repeat modes and Legato. It cannot read Follow Actions, so keep those off.
- **One meter for the whole set.** The bar grid assumes one time signature from bar 1. Scene time signatures trigger a warning.
- **Scene names.** The table finds scenes by their exact names. Any change to the scene list disarms the router until you stop and press RESCAN, or undo. Renaming a mapped scene, or giving two scenes the same name, leaves it disarmed and names the problem scene. Update `SECTIONS` if you rename one.

## Install
1. Copy `device/SongJamRouter.amxd`, `device/song_jam_router.js`, `device/big_window.js`, `device/mixer.js`, `device/icon_play.svg` **and** `device/icon_stop.svg` into one folder in your User Library.
2. Drag the device onto a MIDI track. It passes MIDI through unchanged, so any spare MIDI track is fine, but don't put it on a track you might delete.
3. Click the device's Edit button, click **Freeze** in the Max toolbar, and save. This embeds all the JS and icon files, so the device no longer needs them separately.
4. In the Max editor window, open Window > Max Console and read the scan table: `ROUTER song INTRO | scene 4 'INTRO' | 16 bars (auto) | n clips`. Check that every scene name and bar count is right, and clear every `ROUTER WARN`.
5. To change lengths, edit `SECTIONS`, save, then reload the device (or re-freeze if already frozen).

The device sets Global Quantization to 1 Bar on load, and again before any launch if it has changed.

## MIDI mapping
1. Press Cmd+M.
2. Click **TOGGLE**, press your controller button, then press Cmd+M again.
3. Do the same for SONG, JAM, CANCEL, PREV and NEXT if you want them. SONG and JAM select a mode directly, so pressing one twice changes nothing.

TOGGLE is a press-to-trigger button, so the device always holds the true state and a pedal can't drift out of sync with it. Use a **momentary** pedal or a note. A latching pedal only triggers on every second press, because only its "on" value registers.

## Song title
Name any scene `SONG: <title>`, and the device and large window show the title. `SONG: SUPERFLY` shows `SUPERFLY`. It's display only: the router never launches that scene, and a missing title shows `--`. Renaming that scene updates the display straight away. A scene newly given the tag needs a RESCAN. If several scenes have the tag, the first is used and the scan warns. To change the tag, edit `TITLE_TAG` in the JS.

## Lamps and window
- The current mode's lamp is lit solid. A requested mode blinks until it launches, then goes solid and the old one goes dark.
- Lamp colours are the most common scene colour across the song and JAM scenes, read at scan and printed to the Max Console as `ROUTER lamp colours`. To set them by hand, use `SONG_COLOR` / `JAM_COLOR` in the JS.
- **OPEN WINDOW** opens a large always-on-top window with the same information, plus SONG, JAM, CANCEL, PREV and NEXT. MIDI mapping is done on the device's buttons, and these also drive the window.
- **Resizing:** drag the window's edge and the contents scale to fit, including text size. Live fixes the device strip's height, so only the large window resizes.

## Mixer
**MIXER** on the device opens a window with one strip per top-level group track, up to 12. The strips come from the running set through the Live API, so there's nothing to configure. `mixer.js` is separate from the router and receives only the current scene number. It makes no Live API calls until the window is first opened.

| Button | What it does |
|---|---|
| **PLAY** (triangle) | Launches the group's clips from the current section's scene, at the next bar line. Empty slots are skipped. Green while the group is playing |
| **STOP** (square) | Stops the clips on every track in the group |
| **M** | Mutes the group track. Amber while muted |

- **Window:** it sizes itself to the number of groups, and scales when you resize it. A size you've chosen stays until the number of groups changes. Reopening it refreshes track names.
- **Mid-section changes:** use M. PLAY starts clips from their beginning, so a group started mid-section can be out of phase until the next scene launch.
- **STOP is temporary:** the next scene launch brings the group's clips back. The docs don't say whether STOP waits for Global Quantization, so it may cut immediately.
- **M persists:** it stays on through scene changes and is saved with the set, so a forgotten mute silently kills that group.
- **Stopping every group:** the router sees nothing playing at the next boundary and returns to waiting, so you'd need to launch a scene.

## Behaviour decisions
- **Toggle press:** requests the other mode. A second press before the boundary cancels it, as does CANCEL.
- **Too-late presses:** once the launch has fired (last beat or so), it can't be recalled. A toggle press then applies to the incoming section and shows `LOCKED: X, then switch`. A press within 0.15 s of a JAM boundary waits one more loop rather than risk landing a bar late.
- **NEXT:** launches the next green scene at the next bar line. It's ignored if a launch is already locked.
- **PREV:** launches the green scene of the section before the current one at the next bar line, then auto-advance carries on from there. From a JAM section it goes to the section before that JAM's own, so `CHORUS-1-JAM` goes to `VERSE 1`. It's refused on Intro and ignored if a launch is already locked.
- **END:** `OUTRO 2` keeps playing and looping; the router doesn't stop anything. The final stop is yours. SONG is refused from `OUTRO-JAM` because there's no next section, so it stays in JAM.
- **Stop:** clears everything. Nothing fires until a mapped scene is launched. Pressing Play with clips resuming gives a best-guess sync with a warning.
- **Manual launches:** launching a mapped scene is followed. A yellow scene is ignored and the song clock keeps running. Launching individual clips is not tracked.
- **Stop All Clips:** detected at the boundary; the router returns to waiting rather than bringing the band back in.
- **Alternative JAMs:** launch `CHORUS-3-DRUM-AND-BASS` or `INTRO-JAM-1` by hand and it counts as that section's JAM. To make one the default, swap `jamScene` and `jamAltScene` in its row.

## Manual test plan
Use a copy of the set, with a click on or audible clips, and the Max Console open. **Tests 1 and 2 decide whether this design holds. Stop if either fails.**

1. **Quantised launch.** Launch `INTRO`. Let it advance to `VERSE 1`. The launch must land exactly on the bar line that ends the section, with no flam or early entry.
2. **Bar count.** After test 1, watch Bars count down and confirm Section/Next change exactly at the launch. If Next stays on `LOCKED`, or the status says `Launch unconfirmed`, `is_triggered` isn't behaving as assumed.
3. **Start from stopped.** Stop. Launch `INTRO` from stopped and confirm the display follows. Repeat with Play.
4. **SONG > JAM > SONG.** In `CHORUS 1`, press mid-section. It must finish the section, go to `CHORUS-1-JAM`, and loop at least twice with no re-launch. Press again; it must finish the loop and go to `VERSE INTERLUDE`, then auto-advance.
5. **Change of mind.** Press twice, and press then CANCEL. It should carry on as if nothing happened.
6. **Late press.** Press on the last beat of a green section (after `LOCKED`) and confirm the next section follows `then switch`. Press at the very end of a JAM loop.
7. **Manual.** Launch a mapped scene, a yellow scene and `CHORUS-3-DRUM-AND-BASS` by hand during playback. Press NEXT and PREV repeatedly.
8. **Stops.** Stop mid-section, and try Stop All Clips.
9. **Set changes.** Insert a scene (status must show `SCENES CHANGED`), undo, then RESCAN. Also load a different set and reopen this one.
10. **Mapping.** Test your actual pedal: one action per press, including holding it down.
11. **Lamps and window.** Confirm the lamp colours match the clips, that blinking works, and that the window stays on top and clicks work. Resize it small, large, tall and wide, including during playback, and confirm buttons still click and a transition still lands on time. Close and reopen it mid-song and confirm it shows current values and the transition still lands on time.
12. **Mixer.** Open it and confirm one strip per group, centred names, the icons and no blank space on the right. During playback, try M, then STOP (note whether it waits for the bar line), then PLAY (listen for whether it's in time). Confirm a scene launch brings a stopped group back, and that a transition still lands on time with the window open.
13. **Full run.** Play the whole song at gig tempo with your audio interface and any other devices running, using JAM on at least three sections. Then save the set, reopen it, and run it again.

## Limitations
- `OUTRO 2` and `OUTRO-JAM` are 42 beats, or 10.5 bars in 4/4, so the scan warns about them. A switch between them lands on the bar line after the 10.5-bar point.
- The simulator encodes my assumptions about Live, so passing it doesn't prove behaviour in Ableton.
- A launch misses its bar line only if Live's main thread stalls for over 0.5 s (typically 1 beat) around a boundary. The launch then lands one bar late, and the status shows `LATE`. Closing plug-in windows and heavy UI work reduces this risk.
- Saving the device, or a preset load, reinitialises it mid-song. It then guesses the phase from the current bar and warns. Relaunch a scene to resync.
- A launch that has fired can't be cancelled.
