# ULT Freezer Sensor Node Enclosure

Parametric CadQuery enclosure for the ESP32-S3 Supermini + PT1000/MAX31865
freezer sensor node. Two printed parts (base + lid) plus a fit coupon. 21 identical
units, magnet-mounted on the **outside** side wall of a -80 °C ULT freezer.
Only the PT1000 probe goes inside the freezer, so the enclosure itself lives
at room temperature and needs no insulation.

```
python enclosure.py
```

Regenerates every file in `exports/`. All parameters are in **inches** at the
top of `enclosure.py`; all exported STEP and STL files are in **millimetres**,
because slicers assume mm.

## What comes out

| File | Size (mm) | Size (in) |
|---|---|---|
| `exports/base.step` / `.stl` | 104.14 × 67.31 × 29.54 | 4.100 × 2.650 × 1.163 |
| `exports/lid.step` / `.stl` | 104.14 × 67.31 × 21.59 | 4.100 × 2.650 × 0.850 |
| `exports/fit_coupon.step` / `.stl` | 34.29 × 34.29 × 29.54 | 1.350 × 1.350 × 1.163 |

Plus SVG views: `base_top`, `base_side` (USB notch end), `lid_top`,
`lid_underside`, and `assembly_section` — a section through a corner showing
PCB, corner block, hold-down post, and lid in contact.

**All three solids are exported already in print orientation.** The base and
coupon sit floor-down. The lid is *modelled* in the assembled position but
*exported* flipped, so its flat top face is on z = 0 and the lip and posts
point up. Drop them straight into the slicer.

Key derived numbers (printed by the script on every run):

| | inches | mm |
|---|---|---|
| Internal cavity | 3.600 × 2.150 | 91.44 × 54.61 |
| Outer box | 3.800 × 2.350 | 96.52 × 59.69 |
| Footprint incl. screw towers | 4.100 × 2.650 | 104.14 × 67.31 |
| Wall height | 1.163 | 29.54 |
| Closed height | 1.263 | 32.08 |
| PCB top surface, above floor bottom | 0.413 | 10.49 |
| Hold-down post length | 0.750 | 19.05 |
| USB-C port height | 0.743 | 18.87 |
| USB notch floor / depth | 0.683 / 0.480 | 17.35 / 12.19 |
| PT1000 cable hole | 0.257 | 6.53 |

**Antenna standoff.** With the magnets flush against the freezer steel, the
ESP32 module's own PCB sits 0.743 in (18.9 mm) off the steel — floor + corner
block + perma-proto + header stack. That clears the 0.7 in target, and no metal
appears anywhere in the design, so nothing detunes or shadows the antenna.

## Print settings

- **Material:** PETG. (No metal anywhere in the design.)
- **Walls:** 3 perimeters. **Infill:** 30 %. **Layer height:** 0.2 mm.
- **Supports:** none needed, and none should be used.
- **Orientation:** exactly as exported.
  - `base.stl` — floor down on the plate. Magnet pockets open at the plate and
    bridge closed after ~3 mm.
  - `lid.stl` — top face down on the plate. The label pocket opens at the plate;
    the lip and the four hold-down posts print upward as free-standing pillars.
  - `fit_coupon.stl` — floor down, same as the base.
- **Print the fit coupon first.** One coupon, ~15 minutes. Check before you
  commit to 21 full units:
  - a 10 mm magnet press-fits into the pocket and sits flush with the bottom;
  - an M3 self-tapping screw bites in the pilot hole without splitting the tower;
  - the PT1000 cable passes through the cable hole with a little slack;
  - a zip tie threads through both tie holes.
  Adjust `MAG_D`, `PILOT_D`, `CABLE_D`/`CABLE_CLEAR`, or `TIE_HOLE_D` and re-run
  before printing the real parts.

Rough consumption per unit: ~55 g PETG for base + lid.

## Parts per unit

| Qty | Part |
|---|---|
| 4 | M3 × 12 mm self-tapping screws (plastic-forming, not machine thread) |
| 4 | 10 × 3 mm neodymium disc magnets |
| 2 | small zip ties, max ~3.5 mm wide |
| 1 | freezer ID label, ≤ 1.00 × 0.50 in, for the recessed pocket |
| — | velcro (optional), for the 2.50 × 0.75 in flat zone on the lid top |

## Assembly

1. **Magnets.** Press or glue one magnet into each of the four floor pockets.
   Put **all four in with the same polarity facing out** — mixed polarity halves
   the holding force and makes the unit want to walk on the steel. They should
   end flush with the bottom face so they touch the freezer wall directly.
2. **PCB.** Set the perma-proto board on the four corner blocks, with the
   ESP32's USB-C connector facing the notched short wall. The board should drop
   in with about 0.05 in of slack per side and sit flat with no rocking.
3. **USB cable.** Drop the USB-C cable into the notch from above (the notch
   reaches below the port, so this works with the lid off), plug it in
   horizontally, then loop a zip tie through the two tie holes below the notch
   and cinch it around the cable *outside* the wall. All pull goes into the
   enclosure wall, not the connector.
4. **PT1000.** Thread the probe cable's **bare-wire end through the lid hole
   before you solder it** to the board — the hole is far smaller than a
   terminated probe head. Then solder, and zip-tie the cable to the lid through
   the two tie holes flanking the cable hole, on the outside face.
5. **Close up.** Set the lid on; the alignment lip drops into the cavity and the
   four hold-down posts land on the PCB corners, clamping the board onto the
   corner blocks. Drive the four M3 screws through the counterbored holes into
   the towers. Snug only — they are self-tapping into PETG.
6. **Label.** Apply the freezer ID sticker in the recessed pocket on the lid top.
7. **Mount.** Stick it on the freezer's outside side wall, route the probe into
   the freezer through the port or door gasket.

### Soldering rule

**Keep the outer 0.5 in corners of the PCB free of solder joints.** Those four
corners are the only places the board is supported and clamped: they rest on the
corner blocks and are pressed by the lid posts. A proud joint or a clipped lead
in a corner will make the board rock, tilt it under the posts, or dent it when
the lid is screwed down. Clip all leads flush in those zones.

## Changing parameters

Every dimension lives in the parameter block at the top of `enclosure.py`, in
inches. Nothing dimensional is hardcoded below it. Edit, save, re-run.

**After measuring the real prototype, the two you will most likely change:**

```python
CABLE_D          = 0.157   # <- measured PT1000 cable OD, in inches
USB_NOTCH_OFFSET = 0.0     # <- shift the notch along the wall; 0 = centered,
                           #    + moves toward +Y, - toward -Y
```

Measure the PT1000 cable jacket with calipers at a few spots and use the
largest reading. Put that in `CABLE_D`; the hole is always `CABLE_D +
CABLE_CLEAR`, and the two tie holes automatically move apart so they keep
`TIE_EDGE_MARGIN` of material from the bigger hole. Then:

```
python enclosure.py
```

For `USB_NOTCH_OFFSET`, dry-fit the board on the corner blocks and measure from
the centre of the short wall to the centre of the USB-C connector. Positive
moves the notch toward +Y. The USB tie holes and the lid's lip relief follow the
notch automatically. If you push it too far the script stops with
`USB notch runs into a screw tower` rather than emitting a broken model.

Other frequently-touched ones: `HEADER_H` (sets how deep the USB notch cuts),
`MAG_D`/`MAG_H` (magnet pocket fit), `PILOT_D` (screw bite), `PCB_CLEAR`
(board slack), `LABEL_L`/`LABEL_W` (sticker size).

The script validates before it builds, and refuses to export a model that
violates a constraint — minimum feature thickness, the cavity being exactly
PCB + clearance, features colliding on the lid top, tie holes breaking into the
notch, and so on. Errors name the parameter to change.

### Known warning with the stock defaults

On a default run the script prints:

```
~ lid rim outside the counterbore is only 0.030 in; raise TOWER_D to 0.320 in
```

With `TOWER_D = 0.30` and `CBORE_D = 0.24` the ring of lid material outside each
M3 counterbore is 0.030 in, just under the 0.040 in minimum feature. It prints
(3 perimeters at 0.4 mm nozzle ≈ 0.76 mm of material) but it is the weakest spot
in the lid — over-torquing a screw can chip that rim. Set `TOWER_D = 0.32` if you
would rather have full-thickness material there; the towers grow 0.01 in outward
per side and nothing else changes. Left at 0.30 by default as specified.

## Design notes

- The cavity is cut **after** the screw towers are unioned in, so the towers can
  never intrude on the board space no matter what `TOWER_D` becomes. The script
  proves this every run by intersecting the finished base with the cavity volume
  and checking the result is exactly the four corner blocks.
- The towers are centred on the outer box corners, so they bulge 0.15 in past
  each face. That pushes the overall footprint to 4.10 × 2.65 in — allow for
  that when spacing units on a freezer.
- Zip-tie hole pairs are not placed at a fixed spacing. `TIE_HOLE_GAP` is a
  *minimum*; each pair is widened as needed to straddle whatever it flanks (the
  cable hole, the USB notch) while keeping `TIE_EDGE_MARGIN` of material. This
  is what lets `CABLE_D` change on its own without producing holes that break
  into each other.
- The lid's alignment lip is relieved where the USB cable enters, so the lip
  never pinches the cable when the lid closes.
- Both build-plate faces are fully flat: the base floor bottom has no feet, and
  the lid top carries no raised features — only the recessed label pocket and
  through holes, all of which open toward the plate.
