#!/usr/bin/env python3
"""
ULT freezer sensor node enclosure - parametric CadQuery model.

Two-part PETG enclosure (base + lid) for an ESP32-S3 Supermini + PT1000/MAX31865 node
soldered to a 3.5" x 2.05" perma-proto board.  Magnet-mounted on the OUTSIDE
side wall of a -80 C freezer; only the PT1000 probe goes inside the freezer,
so the enclosure itself needs no insulation.

    python enclosure.py

writes exports/{base,lid,fit_coupon}.{step,stl} plus SVG views.

UNITS
-----
Every parameter below is in INCHES.  They are converted to millimetres exactly
once, in the DERIVED DIMENSIONS section (IN = 25.4).  All geometry is built in
mm, so every exported STEP and STL is in mm, which is what slicers assume.
Nothing dimensional is hardcoded below the parameter block.
"""

from __future__ import annotations

import math
import os
import sys

import cadquery as cq
from cadquery import exporters

# ============================================================================
# UNITS
# ============================================================================
IN = 25.4  # millimetres per inch

# ============================================================================
# PARAMETERS - ALL VALUES IN INCHES
# ============================================================================

# ---- PCB -------------------------------------------------------------------
PCB_L     = 3.50    # board length
PCB_W     = 2.05    # board width
PCB_T     = 0.063   # board thickness
PCB_CLEAR = 0.05    # clearance PER SIDE around the board

# ---- Shell -----------------------------------------------------------------
WALL     = 0.10     # side wall thickness
FLOOR    = 0.10     # base floor thickness
LID_T    = 0.10     # lid plate thickness
HEADROOM = 0.75     # clearance above PCB top surface (ESP32 on headers + cap)

# ---- Corner blocks (PCB supports) ------------------------------------------
BLOCK   = 0.50      # square footprint, one in each inside corner of the cavity
BLOCK_H = 0.25      # height above floor, PCB rests on top

# ---- PT1000 cable (through the lid) ----------------------------------------
CABLE_D     = 0.157  # 4 mm cable - put the MEASURED value here
CABLE_CLEAR = 0.10   # added to diameter
RTD_HOLE_X  = -1.20  # lid position, toward the end opposite the USB notch
RTD_HOLE_Y  = 0.00

# ---- USB power cable notch (U-notch from top edge of a short wall) ---------
USB_WALL         = "short_end_A"  # "short_end_A" = +X end, "short_end_B" = -X
USB_NOTCH_W      = 0.55           # fits a USB-C plug overmold
USB_NOTCH_OFFSET = 0.0            # position along the wall, 0 = centered
HEADER_H         = 0.33           # ESP32 pin header height above PCB
USB_NOTCH_MARGIN = 0.06           # extra notch depth BELOW the USB-C port

# ---- Lid screws (M3) -------------------------------------------------------
TOWER_D     = 0.30   # screw tower diameter, centered on outer shell corners
PILOT_D     = 0.098  # 2.5 mm pilot for M3 self-tapping
PILOT_DEPTH = 0.50   # pilot depth from the top of the tower
CLEAR_D     = 0.134  # 3.4 mm clearance hole in lid
CBORE_D     = 0.24   # counterbore for M3 head
CBORE_DEPTH = 0.06

# ---- Lid hold-down posts ---------------------------------------------------
POST_D = 0.20        # press the PCB corners down onto the corner blocks

# ---- Magnets (flush pockets in the floor, under the corner blocks) ---------
MAG_D = 0.402        # 10.2 mm pocket for 10 mm disc magnet
MAG_H = 0.118        # 3.0 mm deep so magnets sit flush with the floor bottom

# ---- Lid top features ------------------------------------------------------
VELCRO_L    = 2.50   # flat feature-free zone
VELCRO_W    = 0.75
VELCRO_X    = 0.55   # zone center on the lid
VELCRO_Y    = 0.00
LABEL_L     = 1.00
LABEL_W     = 0.50
LABEL_DEPTH = 0.02   # recessed pocket for a freezer ID sticker
LABEL_X     = 0.55   # pocket center on the lid
LABEL_Y     = -0.80

# ---- Strain relief (zip tie passes through two small holes) ----------------
TIE_HOLE_D      = 0.14  # hole diameter for a small zip tie
TIE_HOLE_GAP    = 0.30  # MINIMUM center-to-center spacing; the real spacing is
                        # widened automatically so the pair straddles the cable
                        # hole / USB notch without breaking into it
TIE_EDGE_MARGIN = 0.05  # material between a tie hole and the feature it flanks
TIE_BELOW_NOTCH = 0.05  # material between USB notch floor and tie hole top

# ---- Lid alignment lip -----------------------------------------------------
LIP_H            = 0.10  # how far the lip drops inside the cavity walls
LIP_W            = 0.08  # lip wall thickness
LIP_CLEAR        = 0.01  # clearance per side against the cavity wall
LIP_NOTCH_RELIEF = 0.02  # extra lip cutback each side of the USB notch

# ---- Cosmetic / manufacturing ---------------------------------------------
FILLET_R    = 0.04   # light break on outer vertical edges
MIN_FEATURE = 0.04   # minimum printable feature thickness
EPS         = 0.002  # boolean overshoot so cuts break surfaces cleanly

# ---- Fit coupon ------------------------------------------------------------
COUPON_SIZE     = 1.20  # square corner cut out of the base for tolerance test
COUPON_CORNER_X = -1    # which corner: -1/+1 in X ...
COUPON_CORNER_Y = 1     # ... and -1/+1 in Y (default = away from USB notch)

# ---- Export ----------------------------------------------------------------
EXPORT_DIR  = "exports"
STL_TOL     = 0.0004    # STL linear deflection, inches
STL_ANG_TOL = 0.1       # STL angular deflection, radians (not a length)
SVG_W       = 900       # SVG canvas, pixels (not a length)
SVG_H       = 650

# ============================================================================
# DERIVED DIMENSIONS - everything below is millimetres
# ============================================================================


def mm(v: float) -> float:
    """Inches -> millimetres."""
    return v * IN


# PCB / cavity
pcb_l, pcb_w, pcb_t = mm(PCB_L), mm(PCB_W), mm(PCB_T)
pcb_clear = mm(PCB_CLEAR)
cav_l = pcb_l + 2 * pcb_clear
cav_w = pcb_w + 2 * pcb_clear

# Shell
wall, floor_t, lid_t, headroom = mm(WALL), mm(FLOOR), mm(LID_T), mm(HEADROOM)
out_l = cav_l + 2 * wall
out_w = cav_w + 2 * wall

# Corner blocks
block, block_h = mm(BLOCK), mm(BLOCK_H)

# Z stack, measured from the bottom of the floor
pcb_bot_z = floor_t + block_h
pcb_top_z = pcb_bot_z + pcb_t
shell_h = floor_t + block_h + pcb_t + headroom   # wall / tower height
lid_z0 = shell_h                                  # lid underside
lid_z1 = shell_h + lid_t                          # lid top face

# Cable hole
rtd_hole_d = mm(CABLE_D) + mm(CABLE_CLEAR)
rtd_x, rtd_y = mm(RTD_HOLE_X), mm(RTD_HOLE_Y)

# USB notch
usb_sign = 1.0 if USB_WALL == "short_end_A" else -1.0
usb_notch_w = mm(USB_NOTCH_W)
usb_notch_off = mm(USB_NOTCH_OFFSET)
header_h = mm(HEADER_H)
usb_port_z = floor_t + block_h + pcb_t + header_h        # bottom of USB-C shell
notch_bot_z = usb_port_z - mm(USB_NOTCH_MARGIN)          # notch floor
usb_notch_depth = shell_h - notch_bot_z                  # depth from wall top

# Screws
tower_d, pilot_d, pilot_depth = mm(TOWER_D), mm(PILOT_D), mm(PILOT_DEPTH)
clear_d, cbore_d, cbore_depth = mm(CLEAR_D), mm(CBORE_D), mm(CBORE_DEPTH)

# Posts
post_d = mm(POST_D)
post_h = lid_z0 - pcb_top_z          # ends exactly at the PCB top surface

# Magnets
mag_d, mag_h = mm(MAG_D), mm(MAG_H)

# Lid top features
velcro_l, velcro_w = mm(VELCRO_L), mm(VELCRO_W)
velcro_x, velcro_y = mm(VELCRO_X), mm(VELCRO_Y)
label_l, label_w = mm(LABEL_L), mm(LABEL_W)
label_depth = mm(LABEL_DEPTH)
label_x, label_y = mm(LABEL_X), mm(LABEL_Y)

# Strain relief
tie_hole_d = mm(TIE_HOLE_D)
tie_gap_min = mm(TIE_HOLE_GAP)
tie_edge_margin = mm(TIE_EDGE_MARGIN)
tie_below_notch = mm(TIE_BELOW_NOTCH)

# Tie pairs straddle a feature, so the span is driven by that feature's width.
lid_tie_span = max(tie_gap_min, rtd_hole_d + tie_hole_d + 2 * tie_edge_margin)
usb_tie_span = max(tie_gap_min, usb_notch_w + tie_hole_d + 2 * tie_edge_margin)
usb_tie_z = notch_bot_z - (tie_hole_d / 2 + tie_below_notch)

# Lid lip
lip_h, lip_w, lip_clear = mm(LIP_H), mm(LIP_W), mm(LIP_CLEAR)
lip_relief = mm(LIP_NOTCH_RELIEF)
lip_out_l = cav_l - 2 * lip_clear
lip_out_w = cav_w - 2 * lip_clear

# Misc
fillet_r, min_feature, eps = mm(FILLET_R), mm(MIN_FEATURE), mm(EPS)

# Coupon
coupon_size = mm(COUPON_SIZE)

# Corner sign pairs, used everywhere
CORNERS = ((1, 1), (1, -1), (-1, 1), (-1, -1))


def tower_center(sx: int, sy: int):
    """Screw tower axis - on the outer corner of the shell box."""
    return sx * out_l / 2, sy * out_w / 2


def block_center(sx: int, sy: int):
    """Corner block / magnet / hold-down post axis."""
    return sx * (cav_l / 2 - block / 2), sy * (cav_w / 2 - block / 2)


WARNINGS = []

# ============================================================================
# GEOMETRY HELPERS
# ============================================================================


def _box(x0, x1, y0, y1, z0, z1):
    """Axis-aligned box from an explicit min/max bound in each axis."""
    xa, xb = min(x0, x1), max(x0, x1)
    ya, yb = min(y0, y1), max(y0, y1)
    za, zb = min(z0, z1), max(z0, z1)
    return (
        cq.Workplane("XY")
        .workplane(offset=za)
        .center((xa + xb) / 2, (ya + yb) / 2)
        .box(xb - xa, yb - ya, zb - za, centered=(True, True, False))
    )


def _cyl(radius, height, origin, direction=(0, 0, 1)):
    """Cylinder from a base point along a direction."""
    return cq.Solid.makeCylinder(
        radius, height, cq.Vector(*origin), cq.Vector(*direction)
    )


def _shell_outline(height):
    """Outer shell footprint: the box unioned with the four screw towers.

    The towers are centered ON the box corners, so they bulge outward by
    TOWER_D/2 and leave a re-entrant vertical edge where each cylinder meets a
    box face.  Those are the only outer vertical edges in the part.
    """
    s = cq.Workplane("XY").box(out_l, out_w, height, centered=(True, True, False))
    for sx, sy in CORNERS:
        tx, ty = tower_center(sx, sy)
        s = s.union(cq.Workplane(obj=_cyl(tower_d / 2, height, (tx, ty, 0.0))))
    return s


def _break_vertical_edges(solid, tag):
    """Light break on the outer vertical edges.

    Only the tower/box junction edges qualify; the tower barrels themselves are
    smooth and are never filleted, so the screw bosses keep full wall thickness.
    """
    try:
        return solid.edges("|Z").fillet(fillet_r)
    except Exception as exc:  # geometry dependent
        WARNINGS.append(
            "fillet skipped on %s (FILLET_R=%.3f in may be too large): %s"
            % (tag, FILLET_R, exc)
        )
        return solid


# ============================================================================
# PARTS
# ============================================================================


def build_base():
    """Base: floor, walls, screw towers, corner blocks, USB notch, magnets."""
    b = _shell_outline(shell_h)
    b = _break_vertical_edges(b, "base")

    # Cavity is cut AFTER the towers are unioned in, so the towers can never
    # intrude on it no matter how the tower diameter changes.
    b = b.cut(_box(-cav_l / 2, cav_l / 2, -cav_w / 2, cav_w / 2,
                   floor_t, shell_h + eps))

    # Corner blocks - the only thing allowed inside the cavity.
    for sx, sy in CORNERS:
        bx, by = block_center(sx, sy)
        b = b.union(
            _box(bx - block / 2, bx + block / 2,
                 by - block / 2, by + block / 2,
                 floor_t, floor_t + block_h)
        )

    # Screw pilot holes, down from the top of each tower.
    for sx, sy in CORNERS:
        tx, ty = tower_center(sx, sy)
        b = b.cut(_cyl(pilot_d / 2, pilot_depth + eps,
                       (tx, ty, shell_h - pilot_depth)))

    # USB-C U-notch, cut down from the top edge of the chosen short wall.
    nx_in = usb_sign * (cav_l / 2 - eps)
    nx_out = usb_sign * (out_l / 2 + tower_d)
    b = b.cut(_box(nx_in, nx_out,
                   usb_notch_off - usb_notch_w / 2,
                   usb_notch_off + usb_notch_w / 2,
                   notch_bot_z, shell_h + eps))

    # USB strain relief: a tie hole each side of the notch, just below it.
    for s in (-1, 1):
        y = usb_notch_off + s * usb_tie_span / 2
        b = b.cut(_cyl(tie_hole_d / 2, out_l + 2 * tower_d,
                       (-usb_sign * (out_l / 2 + tower_d), y, usb_tie_z),
                       (usb_sign, 0, 0)))

    # Magnet pockets, opening at the flat floor bottom, under the blocks.
    for sx, sy in CORNERS:
        bx, by = block_center(sx, sy)
        b = b.cut(_cyl(mag_d / 2, mag_h + eps, (bx, by, -eps)))

    return b


def build_lid():
    """Lid, built in the ASSEMBLED position (underside at z = shell_h)."""
    lid = _shell_outline(lid_t)
    lid = _break_vertical_edges(lid, "lid")
    lid = lid.translate((0, 0, lid_z0))

    # Alignment lip: a rim that drops into the cavity with LIP_CLEAR per side.
    lip = _box(-lip_out_l / 2, lip_out_l / 2, -lip_out_w / 2, lip_out_w / 2,
               lid_z0 - lip_h, lid_z0)
    lip = lip.cut(_box(-(lip_out_l / 2 - lip_w), lip_out_l / 2 - lip_w,
                       -(lip_out_w / 2 - lip_w), lip_out_w / 2 - lip_w,
                       lid_z0 - lip_h - eps, lid_z0 + eps))
    # Relieve the lip where the USB cable enters, so nothing pinches the cable.
    lip = lip.cut(_box(usb_sign * (cav_l / 2 + eps),
                       usb_sign * (cav_l / 2 - lip_w - lip_clear - lip_relief),
                       usb_notch_off - (usb_notch_w / 2 + lip_relief),
                       usb_notch_off + (usb_notch_w / 2 + lip_relief),
                       lid_z0 - lip_h - eps, lid_z0 + eps))
    lid = lid.union(lip)

    # Hold-down posts: end exactly at the PCB top surface.
    for sx, sy in CORNERS:
        bx, by = block_center(sx, sy)
        lid = lid.union(cq.Workplane(obj=_cyl(post_d / 2, post_h,
                                              (bx, by, pcb_top_z))))

    # Screw clearance holes + counterbores.
    for sx, sy in CORNERS:
        tx, ty = tower_center(sx, sy)
        lid = lid.cut(_cyl(clear_d / 2, lid_t + 2 * eps, (tx, ty, lid_z0 - eps)))
        lid = lid.cut(_cyl(cbore_d / 2, cbore_depth + eps,
                           (tx, ty, lid_z1 - cbore_depth)))

    # PT1000 cable hole + its strain-relief tie pair.
    lid = lid.cut(_cyl(rtd_hole_d / 2, lid_t + 2 * eps, (rtd_x, rtd_y, lid_z0 - eps)))
    for s in (-1, 1):
        lid = lid.cut(_cyl(tie_hole_d / 2, lid_t + 2 * eps,
                           (rtd_x, rtd_y + s * lid_tie_span / 2, lid_z0 - eps)))

    # Recessed freezer-ID label pocket, opening at the lid top face.
    lid = lid.cut(_box(label_x - label_l / 2, label_x + label_l / 2,
                       label_y - label_w / 2, label_y + label_w / 2,
                       lid_z1 - label_depth, lid_z1 + eps))

    return lid


def build_pcb_mock():
    """Visualisation only - never exported as a part."""
    return _box(-pcb_l / 2, pcb_l / 2, -pcb_w / 2, pcb_w / 2,
                pcb_bot_z, pcb_top_z)


def coupon_bounds():
    """(x_inner, y_inner, x_block_inner, y_block_outer) for the coupon corner."""
    sx, sy = COUPON_CORNER_X, COUPON_CORNER_Y
    x_in = sx * (out_l / 2 - coupon_size)
    y_in = sy * (out_w / 2 - coupon_size)
    x_block_inner = sx * (cav_l / 2 - block)
    y_block_outer = sy * (cav_w / 2)
    return x_in, y_in, x_block_inner, y_block_outer


def build_coupon(base):
    """One corner of the base, printed first to check tolerances.

    Carries a screw tower + pilot, a corner block with its magnet pocket, a
    cable hole at CABLE_D + CABLE_CLEAR, and one tie-hole pair at the same
    spacing the lid uses.
    """
    sx, sy = COUPON_CORNER_X, COUPON_CORNER_Y
    x_in, y_in, x_block_inner, y_block_outer = coupon_bounds()

    region = _box(x_in, sx * (out_l / 2 + tower_d),
                  y_in, sy * (out_w / 2 + tower_d),
                  -eps, shell_h + eps)
    c = base.intersect(region)

    # Free strip of floor between the coupon's inner edge and the corner block.
    hx = (x_in + x_block_inner) / 2
    hy = (y_in + y_block_outer) / 2
    c = c.cut(_cyl(rtd_hole_d / 2, floor_t + 2 * eps, (hx, hy, -eps)))
    for s in (-1, 1):
        c = c.cut(_cyl(tie_hole_d / 2, floor_t + 2 * eps,
                       (hx, hy + s * lid_tie_span / 2, -eps)))
    return c


# ============================================================================
# VALIDATION
# ============================================================================


def _rect(cx, cy, l, w):
    return (cx - l / 2, cx + l / 2, cy - w / 2, cy + w / 2)


def _circ_rect(cx, cy, d):
    return _rect(cx, cy, d, d)


def _rects_overlap(a, b):
    return not (a[1] <= b[0] or b[1] <= a[0] or a[3] <= b[2] or b[3] <= a[2])


def validate():
    """Hard geometric checks.  Returns a list of errors (empty == good)."""
    err = []

    def need(cond, msg):
        if not cond:
            err.append(msg)

    def warn(cond, msg):
        if not cond:
            WARNINGS.append(msg)

    # --- minimum printable thickness ---------------------------------------
    for name, val in (("WALL", wall), ("FLOOR", floor_t), ("LID_T", lid_t),
                      ("LIP_W", lip_w)):
        need(val >= min_feature, "%s is below MIN_FEATURE" % name)
    need(cbore_depth < lid_t, "CBORE_DEPTH must be less than LID_T")
    warn(lid_t - cbore_depth >= min_feature,
         "lid floor under the counterbore is %.3f in (< MIN_FEATURE)"
         % ((lid_t - cbore_depth) / IN))
    need(clear_d < cbore_d, "CLEAR_D must be smaller than CBORE_D")

    # --- cavity is exactly PCB + clearance ---------------------------------
    need(abs(cav_l - (pcb_l + 2 * pcb_clear)) < 1e-9, "cavity length wrong")
    need(abs(cav_w - (pcb_w + 2 * pcb_clear)) < 1e-9, "cavity width wrong")

    # --- corner blocks fit inside the cavity -------------------------------
    need(2 * block < cav_w, "BLOCK too large, opposite blocks would meet in Y")
    need(2 * block < cav_l, "BLOCK too large, opposite blocks would meet in X")

    # --- magnets ------------------------------------------------------------
    need(mag_d + 2 * min_feature <= block,
         "MAG_D does not fit inside BLOCK with MIN_FEATURE of material")
    need(floor_t + block_h - mag_h >= min_feature,
         "magnet pocket leaves less than MIN_FEATURE above it")

    # --- screw towers -------------------------------------------------------
    need(tower_d / 2 - pilot_d / 2 >= min_feature,
         "tower wall around PILOT_D is below MIN_FEATURE")
    need(pilot_depth < shell_h, "PILOT_DEPTH is deeper than the tower is tall")
    # material between the pilot hole and the nearest cavity corner
    corner_gap = ((out_l / 2 - cav_l / 2) ** 2
                  + (out_w / 2 - cav_w / 2) ** 2) ** 0.5 - pilot_d / 2
    need(corner_gap >= min_feature,
         "pilot hole breaks into the cavity corner (gap %.3f in)"
         % (corner_gap / IN))
    warn(tower_d / 2 - cbore_d / 2 >= min_feature,
         "lid rim outside the counterbore is only %.3f in; raise TOWER_D to "
         "%.3f in for a full-thickness rim"
         % ((tower_d / 2 - cbore_d / 2) / IN,
            (cbore_d + 2 * min_feature) / IN))

    # --- USB notch ----------------------------------------------------------
    need(notch_bot_z <= usb_port_z,
         "USB notch does not reach down to the USB-C port height")
    need(notch_bot_z > pcb_top_z,
         "USB notch cuts below the PCB top surface")
    tower_near_y = out_w / 2 - tower_d / 2
    need(abs(usb_notch_off) + usb_notch_w / 2 + min_feature <= tower_near_y,
         "USB notch runs into a screw tower; reduce USB_NOTCH_W or "
         "USB_NOTCH_OFFSET")
    need(usb_tie_z - tie_hole_d / 2 > 0, "USB tie holes fall below the floor")
    need(usb_tie_z + tie_hole_d / 2 + min_feature <= notch_bot_z,
         "USB tie holes break into the notch floor")
    warn(usb_tie_z - tie_hole_d / 2 >= pcb_top_z,
         "USB tie holes sit below the PCB top plane; the zip tie may foul the "
         "board edge")
    need(abs(usb_notch_off) + usb_tie_span / 2 + tie_hole_d / 2 + min_feature
         <= tower_near_y,
         "USB tie holes run into a screw tower")

    # --- hold-down posts ----------------------------------------------------
    need(abs(post_h - headroom) < 1e-9,
         "hold-down post does not end at the PCB top surface")
    bx, by = block_center(1, 1)
    need(bx + post_d / 2 <= cav_l / 2 - lip_clear - lip_w,
         "hold-down post collides with the lid lip in X")
    need(by + post_d / 2 <= cav_w / 2 - lip_clear - lip_w,
         "hold-down post collides with the lid lip in Y")
    need(post_d <= block, "POST_D is wider than the corner block")

    # --- PT1000 hole --------------------------------------------------------
    need(abs(rtd_hole_d - (mm(CABLE_D) + mm(CABLE_CLEAR))) < 1e-9,
         "PT1000 hole is not CABLE_D + CABLE_CLEAR")
    lip_inner_x = cav_l / 2 - lip_clear - lip_w
    lip_inner_y = cav_w / 2 - lip_clear - lip_w
    for label, cx, cy, d in (
        ("PT1000 cable hole", rtd_x, rtd_y, rtd_hole_d),
        ("PT1000 tie hole -", rtd_x, rtd_y - lid_tie_span / 2, tie_hole_d),
        ("PT1000 tie hole +", rtd_x, rtd_y + lid_tie_span / 2, tie_hole_d),
    ):
        need(abs(cx) + d / 2 + min_feature <= lip_inner_x
             and abs(cy) + d / 2 + min_feature <= lip_inner_y,
             "%s is not clear of the lid lip" % label)
        for sx, sy in CORNERS:
            px, py = block_center(sx, sy)
            gap = ((cx - px) ** 2 + (cy - py) ** 2) ** 0.5
            need(gap >= d / 2 + post_d / 2 + min_feature,
                 "%s lands on a hold-down post" % label)

    # --- lid top features do not overlap ------------------------------------
    feats = [
        ("velcro zone", _rect(velcro_x, velcro_y, velcro_l, velcro_w)),
        ("label pocket", _rect(label_x, label_y, label_l, label_w)),
        ("PT1000 cable hole", _circ_rect(rtd_x, rtd_y, rtd_hole_d)),
        ("PT1000 tie hole -", _circ_rect(rtd_x, rtd_y - lid_tie_span / 2, tie_hole_d)),
        ("PT1000 tie hole +", _circ_rect(rtd_x, rtd_y + lid_tie_span / 2, tie_hole_d)),
    ]
    for sx, sy in CORNERS:
        tx, ty = tower_center(sx, sy)
        feats.append(("counterbore %+d%+d" % (sx, sy),
                      _circ_rect(tx, ty, cbore_d)))
    for i in range(len(feats)):
        for j in range(i + 1, len(feats)):
            need(not _rects_overlap(feats[i][1], feats[j][1]),
                 "lid top features overlap: %s / %s"
                 % (feats[i][0], feats[j][0]))
    for name, r in feats:
        need(r[0] >= -out_l / 2 - tower_d / 2 and r[1] <= out_l / 2 + tower_d / 2
             and r[2] >= -out_w / 2 - tower_d / 2
             and r[3] <= out_w / 2 + tower_d / 2,
             "%s falls outside the lid footprint" % name)

    # --- fit coupon ---------------------------------------------------------
    x_in, y_in, x_block_inner, y_block_outer = coupon_bounds()
    hx = (x_in + x_block_inner) / 2
    hy = (y_in + y_block_outer) / 2
    strip = sorted((x_in, x_block_inner))
    need(strip[0] + min_feature <= hx - rtd_hole_d / 2
         and hx + rtd_hole_d / 2 <= strip[1] - min_feature,
         "coupon cable hole does not fit in the free floor strip; raise "
         "COUPON_SIZE")
    span = sorted((y_in, y_block_outer))
    need(span[0] + min_feature <= hy - lid_tie_span / 2 - tie_hole_d / 2
         and hy + lid_tie_span / 2 + tie_hole_d / 2 <= span[1] - min_feature,
         "coupon tie holes do not fit in the free floor strip; raise "
         "COUPON_SIZE")
    need(coupon_size > block + wall, "COUPON_SIZE is too small to hold a block")

    return err


def check_cavity(base):
    """Solid proof that nothing but the corner blocks lives in the cavity."""
    err = []
    cavity = _box(-cav_l / 2, cav_l / 2, -cav_w / 2, cav_w / 2,
                  floor_t, shell_h)

    # Above the blocks the cavity must be completely empty.
    above = _box(-cav_l / 2, cav_l / 2, -cav_w / 2, cav_w / 2,
                 floor_t + block_h + eps, shell_h)
    try:
        vol_above = base.intersect(above).val().Volume()
    except Exception:
        vol_above = 0.0
    if vol_above > 1e-3:
        err.append("something intrudes into the cavity above the corner "
                   "blocks (%.4f mm^3)" % vol_above)

    # At block height the only material must be the four blocks, less the part
    # of each magnet pocket that reaches up past the floor into its block.
    vol_blocks = base.intersect(cavity).val().Volume()
    pocket_in_block = math.pi * (mag_d / 2) ** 2 * max(0.0, mag_h - floor_t)
    expect = 4 * (block * block * block_h - pocket_in_block)
    if abs(vol_blocks - expect) / expect > 0.01:
        err.append("cavity material is %.1f mm^3, expected %.1f mm^3 of corner "
                   "blocks" % (vol_blocks, expect))
    return err


# ============================================================================
# EXPORT
# ============================================================================


def _out(name):
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        EXPORT_DIR, name)


def _svg(shape, name, direction, tag):
    exporters.export(
        shape, _out(name), exportType="SVG",
        opt={
            "width": SVG_W, "height": SVG_H,
            "marginLeft": 20, "marginTop": 20,
            "projectionDir": direction,
            "showAxes": False, "showHidden": False,
            "strokeWidth": 0.3,
        },
    )
    print("  %-28s %s" % (name, tag))


def export_all(base, lid, coupon, pcb):
    os.makedirs(_out(""), exist_ok=True)

    # Base and coupon are already in print orientation (flat floor on z = 0).
    # The lid is modelled in the assembled position, so flip it top-down for
    # printing: its top face becomes the build-plate face.
    lid_print = lid.rotate((0, 0, 0), (1, 0, 0), 180)
    zmin = lid_print.val().BoundingBox().zmin
    lid_print = lid_print.translate((0, 0, -zmin))

    print("solids (mm):")
    for shape, stem in ((base, "base"), (lid_print, "lid"),
                        (coupon, "fit_coupon")):
        exporters.export(shape, _out(stem + ".step"))
        exporters.export(shape, _out(stem + ".stl"),
                         tolerance=mm(STL_TOL), angularTolerance=STL_ANG_TOL)
        bb = shape.val().BoundingBox()
        print("  %-28s %6.2f x %6.2f x %6.2f mm  (%.3f x %.3f x %.3f in)"
              % (stem + ".step / .stl", bb.xlen, bb.ylen, bb.zlen,
                 bb.xlen / IN, bb.ylen / IN, bb.zlen / IN))

    print("views:")
    _svg(base, "base_top.svg", (0, 0, 1), "looking down into the cavity")
    _svg(base, "base_side.svg", (usb_sign, 0, 0), "USB notch end elevation")
    _svg(lid, "lid_top.svg", (0, 0, 1), "velcro zone, label pocket, holes")
    _svg(lid, "lid_underside.svg", (0, 0, -1), "lip and hold-down posts")

    # Assembled section through a corner block: PCB, block, post, lid contact.
    sec_y = block_center(1, 1)[1]
    cutter = _box(-out_l, out_l, sec_y, out_w + tower_d, -out_l, out_l)
    section = cq.Compound.makeCompound([
        base.cut(cutter).val(),
        pcb.cut(cutter).val(),
        lid.cut(cutter).val(),
    ])
    _svg(section, "assembly_section.svg", (0, -1, 0),
         "section at y = %.3f in through a corner" % (sec_y / IN))


# ============================================================================
# MAIN
# ============================================================================


def report():
    print("key dimensions            inches        mm")
    rows = (
        ("cavity L x W", "%.3f x %.3f" % (cav_l / IN, cav_w / IN),
         "%.2f x %.2f" % (cav_l, cav_w)),
        ("outer box L x W", "%.3f x %.3f" % (out_l / IN, out_w / IN),
         "%.2f x %.2f" % (out_l, out_w)),
        ("footprint over towers", "%.3f x %.3f"
         % ((out_l + tower_d) / IN, (out_w + tower_d) / IN),
         "%.2f x %.2f" % (out_l + tower_d, out_w + tower_d)),
        ("wall height", "%.3f" % (shell_h / IN), "%.2f" % shell_h),
        ("closed height", "%.3f" % (lid_z1 / IN), "%.2f" % lid_z1),
        ("PCB top surface z", "%.3f" % (pcb_top_z / IN), "%.2f" % pcb_top_z),
        ("hold-down post length", "%.3f" % (post_h / IN), "%.2f" % post_h),
        ("USB-C port z", "%.3f" % (usb_port_z / IN), "%.2f" % usb_port_z),
        ("USB notch floor z", "%.3f" % (notch_bot_z / IN), "%.2f" % notch_bot_z),
        ("USB notch depth", "%.3f" % (usb_notch_depth / IN),
         "%.2f" % usb_notch_depth),
        ("USB tie hole spacing", "%.3f" % (usb_tie_span / IN),
         "%.2f" % usb_tie_span),
        ("PT1000 hole dia", "%.3f" % (rtd_hole_d / IN), "%.2f" % rtd_hole_d),
        ("PT1000 tie hole spacing", "%.3f" % (lid_tie_span / IN),
         "%.2f" % lid_tie_span),
        ("antenna above steel", "%.3f" % (usb_port_z / IN),
         "%.2f" % usb_port_z),
    )
    for name, i, m in rows:
        print("  %-24s %-13s %s" % (name, i, m))


def main():
    print("ULT freezer sensor node enclosure")
    print("=" * 62)

    errors = validate()
    if errors:
        print("PARAMETER ERRORS:")
        for e in errors:
            print("  ! " + e)
        return 1

    base = build_base()
    lid = build_lid()
    coupon = build_coupon(base)
    pcb = build_pcb_mock()

    errors = check_cavity(base)
    if errors:
        print("GEOMETRY ERRORS:")
        for e in errors:
            print("  ! " + e)
        return 1

    export_all(base, lid, coupon, pcb)
    print()
    report()

    if WARNINGS:
        print()
        print("warnings:")
        for w in WARNINGS:
            print("  ~ " + w)

    print()
    print("OK - exports written to %s/" % EXPORT_DIR)
    return 0


if __name__ == "__main__":
    sys.exit(main())
