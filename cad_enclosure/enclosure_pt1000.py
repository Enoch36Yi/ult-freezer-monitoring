"""Revised parametric ULT enclosure. Dimensions in mm; run outside OneDrive.

CadQuery foundation/layout follows enclosure.py. See README for documented vs
provisional dimensions. Output defaults to a new revision folder, never exports/.
"""
import argparse
import json
import os
import sys
from pathlib import Path
import cadquery as cq
from cadquery import exporters

# Official Adafruit MAX31865 PCB Eagle geometry (product 3648).
ADA_W, ADA_L, ADA_HOLE_D, ADA_HOLE_PITCH = 25.4, 27.94, 2.5, 20.32
ADA_HOLE_FROM_TERMINAL_END = 2.54
# Provisional until physical caliper checks.
PERF_L, PERF_W, PERF_T = 88.9, 52.07, 1.6
PERF_COMPONENT_H, PERF_UNDER_H = 17.0, 2.0
ADA_T, ADA_COMPONENT_H, ADA_UNDER_H = 1.6, 12.0, 1.0
ESP_USB_Y, ESP_USB_Z_ABOVE_PERF = -12.0, 8.5
USB_PLUG_W, USB_PLUG_H, USB_CLEAR = 13.0, 8.0, 1.0
PROBE_CABLE_D, PROBE_D, PROBE_CRADLE_CLEAR = 4.0, 6.0, 0.6
PRINT_CLEAR, BOARD_EDGE_CLEAR, WIRE_GAP = 0.35, 3.0, 12.0
TERMINAL_CLEAR = 15.0
WALL, FLOOR, LID_T = 2.8, 3.0, 3.0
PERF_STANDOFF, ADA_STANDOFF, HEAD_CLEAR = 5.0, 5.0, 3.0
TOWER_D, PILOT_D, LID_CLEAR_D = 9.0, 2.6, 3.4
MAG_D, MAG_DEPTH = 10.3, 3.0
LIP_H, LIP_W, ZIP_D = 2.4, 1.8, 3.6
LABEL_L, LABEL_W, LABEL_DEPTH = 35.0, 12.0, 0.5
CRADLE_L, CRADLE_H, CRADLE_T = 46.0, 16.0, 5.0
CRADLE_SCREW_PITCH, CRADLE_PILOT_D, CRADLE_TIE_SLOT_W = 36.0, 2.5, 4.2
EPS = 0.02

INNER_L = PERF_L + ADA_L + WIRE_GAP + BOARD_EDGE_CLEAR + TERMINAL_CLEAR
INNER_W = max(PERF_W, ADA_W) + 2*BOARD_EDGE_CLEAR
OUT_L, OUT_W = INNER_L + 2*WALL, INNER_W + 2*WALL
ADA_X = -INNER_L/2 + TERMINAL_CLEAR + ADA_L/2
PERF_X = INNER_L/2 - BOARD_EDGE_CLEAR - PERF_L/2
PERF_BOT, ADA_BOT = FLOOR+PERF_STANDOFF, FLOOR+ADA_STANDOFF
PERF_TOP, ADA_TOP = PERF_BOT+PERF_T, ADA_BOT+ADA_T
SHELL_H = max(PERF_TOP+PERF_COMPONENT_H, ADA_TOP+ADA_COMPONENT_H)+HEAD_CLEAR
USB_Z = PERF_TOP+ESP_USB_Z_ABOVE_PERF
USB_OPEN_W = USB_PLUG_W+2*USB_CLEAR
USB_OPEN_BOTTOM = USB_Z-USB_PLUG_H/2-USB_CLEAR
PROBE_OPEN_D = PROBE_CABLE_D+2*PRINT_CLEAR
PROBE_Z = FLOOR+8.0
# Looking down onto the lid: USB (+X) is TOP, so RIGHT is -Y.
# Provisional exit centre beside the Adafruit PCB; check the real wire bend.
PROBE_X = ADA_X
CORNERS = ((-1,-1),(-1,1),(1,-1),(1,1))

def box(x0,x1,y0,y1,z0,z1):
    return cq.Workplane('XY').box(x1-x0,y1-y0,z1-z0,centered=(False,False,False)).translate((x0,y0,z0))
def cyl(r,h,p,d=(0,0,1)):
    return cq.Workplane(obj=cq.Solid.makeCylinder(r,h,cq.Vector(*p),cq.Vector(*d)))
def corner(sx,sy): return sx*OUT_L/2,sy*OUT_W/2
def perf_corner(sx,sy): return PERF_X+sx*(PERF_L/2-5),sy*(PERF_W/2-5)
def ada_holes():
    x=ADA_X-ADA_L/2+ADA_HOLE_FROM_TERMINAL_END
    return [(x,-ADA_HOLE_PITCH/2),(x,ADA_HOLE_PITCH/2)]
def outline(h):
    p=box(-OUT_L/2,OUT_L/2,-OUT_W/2,OUT_W/2,0,h)
    for sx,sy in CORNERS:
        x,y=corner(sx,sy); p=p.union(cyl(TOWER_D/2,h,(x,y,0)))
    return p

def build_base():
    b=outline(SHELL_H).cut(box(-INNER_L/2,INNER_L/2,-INNER_W/2,INNER_W/2,FLOOR,SHELL_H+EPS))
    for sx,sy in CORNERS:
        x,y=corner(sx,sy)
        b=b.cut(cyl(PILOT_D/2,12,(x,y,SHELL_H-12)))
        mx,my=sx*(INNER_L/2-8),sy*(INNER_W/2-8)
        b=b.union(cyl(7,3,(mx,my,FLOOR)))
        b=b.cut(cyl(MAG_D/2,MAG_DEPTH+EPS,(mx,my,-EPS)))
    for sx,sy in CORNERS:
        x,y=perf_corner(sx,sy)
        b=b.union(box(x-4,x+4,y-4,y+4,FLOOR,PERF_BOT))
    for sy in (-1,1):
        y=sy*(PERF_W/2+PRINT_CLEAR+1.2)
        b=b.union(box(PERF_X-18,PERF_X+18,y-1.2,y+1.2,FLOOR,PERF_TOP+2))
    for x,y in ada_holes():
        b=b.union(cyl(4,ADA_STANDOFF,(x,y,FLOOR)))
        b=b.cut(cyl(1,ADA_STANDOFF+EPS,(x,y,FLOOR)))
    b=b.union(box(ADA_X+ADA_L/2-3,ADA_X+ADA_L/2,-ADA_W/2+2,ADA_W/2-2,FLOOR,ADA_BOT))
    b=b.cut(box(INNER_L/2-EPS,OUT_L/2+TOWER_D,ESP_USB_Y-USB_OPEN_W/2,ESP_USB_Y+USB_OPEN_W/2,USB_OPEN_BOTTOM,SHELL_H+EPS))
    b=b.cut(box(PROBE_X-PROBE_OPEN_D/2,PROBE_X+PROBE_OPEN_D/2,-OUT_W/2-TOWER_D,-INNER_W/2+EPS,PROBE_Z,SHELL_H+EPS))
    b=b.cut(cyl(PROBE_OPEN_D/2,WALL+TOWER_D+EPS,(PROBE_X,-OUT_W/2-TOWER_D,PROBE_Z),(0,1,0)))
    # Lead-in chamfer removes the sharp exterior half-round cable contact.
    b=b.cut(cq.Workplane(obj=cq.Solid.makeCone(PROBE_OPEN_D/2+0.8,
        PROBE_OPEN_D/2,1.0,cq.Vector(PROBE_X,-OUT_W/2-EPS,PROBE_Z),cq.Vector(0,1,0))))
    # Wall tie holes: strap on the exterior, no tie trapped between magnets
    # and freezer steel. Pairs flank their separate openings.
    for y in (ESP_USB_Y-USB_OPEN_W/2-4,ESP_USB_Y+USB_OPEN_W/2+4):
        b=b.cut(cyl(ZIP_D/2,WALL+2*EPS,(OUT_L/2+EPS,y,USB_OPEN_BOTTOM-4),(-1,0,0)))
    for x in (PROBE_X-8,PROBE_X+8):
        b=b.cut(cyl(ZIP_D/2,WALL+2*EPS,(x,-OUT_W/2-EPS,PROBE_Z-5),(0,1,0)))
    for x in (-CRADLE_SCREW_PITCH/2,CRADLE_SCREW_PITCH/2):
        b=b.union(cyl(4.2,3,(x,OUT_W/2,SHELL_H/2),(0,1,0)))
        b=b.cut(cyl(CRADLE_PILOT_D/2,4.7,(x,OUT_W/2+3,SHELL_H/2),(0,-1,0)))
    return b

def build_lid():
    z=SHELL_H
    lid=outline(LID_T).translate((0,0,z))
    lip=box(-INNER_L/2+PRINT_CLEAR,INNER_L/2-PRINT_CLEAR,-INNER_W/2+PRINT_CLEAR,INNER_W/2-PRINT_CLEAR,z-LIP_H,z)
    lip=lip.cut(box(-INNER_L/2+PRINT_CLEAR+LIP_W,INNER_L/2-PRINT_CLEAR-LIP_W,-INNER_W/2+PRINT_CLEAR+LIP_W,INNER_W/2-PRINT_CLEAR-LIP_W,z-LIP_H-EPS,z+EPS))
    lip=lip.cut(box(INNER_L/2-LIP_W-1,INNER_L/2+EPS,ESP_USB_Y-USB_OPEN_W/2-1,ESP_USB_Y+USB_OPEN_W/2+1,z-LIP_H-EPS,z+EPS))
    lip=lip.cut(box(PROBE_X-PROBE_OPEN_D/2-1,PROBE_X+PROBE_OPEN_D/2+1,-INNER_W/2-EPS,-INNER_W/2+LIP_W+1,z-LIP_H-EPS,z+EPS))
    lid=lid.union(lip)
    # Integral tongue closes the long open leg of the split probe exit while
    # leaving a rounded cable-size aperture at its lower edge.
    lid=lid.union(box(PROBE_X-(PROBE_OPEN_D/2-PRINT_CLEAR),PROBE_X+PROBE_OPEN_D/2-PRINT_CLEAR,
                      -OUT_W/2,-INNER_W/2+3,
                      PROBE_Z+PROBE_OPEN_D/2+PRINT_CLEAR,z))
    for sx,sy in CORNERS:
        x,y=perf_corner(sx,sy)
        lid=lid.union(cyl(2.8,z-PERF_TOP,(x,y,PERF_TOP)))
    for sx,sy in CORNERS:
        x,y=corner(sx,sy)
        lid=lid.cut(cyl(LID_CLEAR_D/2,LID_T+2*EPS,(x,y,z-EPS)))
        lid=lid.cut(cyl(3,1.2,(x,y,z+LID_T-1.2)))
    lid=lid.cut(box(-LABEL_L/2,LABEL_L/2,-LABEL_W/2,LABEL_W/2,z+LID_T-LABEL_DEPTH,z+LID_T+EPS))
    return lid

def build_cradle():
    c=box(-CRADLE_L/2,CRADLE_L/2,0,CRADLE_T,0,CRADLE_H)
    c=c.cut(cyl((PROBE_D+PROBE_CRADLE_CLEAR)/2,CRADLE_L+2*EPS,(-CRADLE_L/2-EPS,CRADLE_T/2,CRADLE_H),(1,0,0)))
    for x in (-CRADLE_SCREW_PITCH/2,CRADLE_SCREW_PITCH/2):
        c=c.union(cyl(4,3,(x,-3,CRADLE_H/2),(0,1,0)))
        c=c.cut(cyl(1.7,CRADLE_T+3.1,(x,-3.05,CRADLE_H/2),(0,1,0)))
    for x in (-8,8):
        c=c.cut(box(x-CRADLE_TIE_SLOT_W/2,x+CRADLE_TIE_SLOT_W/2,-EPS,CRADLE_T+EPS,CRADLE_H-7,CRADLE_H+EPS))
    return c

def build_fit_test():
    b=box(0,34,0,31,0,FLOOR)
    b=b.union(box(0,WALL,0,31,FLOOR,15)).union(box(0,34,0,WALL,FLOOR,15))
    b=b.union(cyl(4.5,15,(0,0,0))).cut(cyl(PILOT_D/2,10,(0,0,5)))
    b=b.cut(cyl(MAG_D/2,MAG_DEPTH+EPS,(16,16,-EPS)))
    b=b.cut(box(-EPS,WALL+EPS,17-PROBE_OPEN_D/2,17+PROBE_OPEN_D/2,8,15+EPS))
    b=b.cut(cyl(PROBE_OPEN_D/2,WALL+2*EPS,(-EPS,17,8),(1,0,0)))
    return b

def solid(p,name):
    s=p.val().Solids()
    if len(s)!=1 or not s[0].isValid(): raise ValueError(f'{name}: {len(s)} or invalid solids')
    return s[0]
def preview(p,path,direction):
    exporters.export(p,str(path),exportType='SVG',opt={'width':1000,'height':700,'projectionDir':direction,'showAxes':False,'showHidden':False,'strokeWidth':0.35})

def run(out):
    out.mkdir(parents=True,exist_ok=True)
    base,lid,cradle,fit=build_base(),build_lid(),build_cradle(),build_fit_test()
    logs=[]
    for n,p in [('base',base),('lid',lid),('probe_cradle',cradle),('fit_test',fit)]:
        s=solid(p,n); logs.append(f'{n}: one valid solid; volume {s.Volume():.2f} mm3')
    perf=box(PERF_X-PERF_L/2,PERF_X+PERF_L/2,-PERF_W/2,PERF_W/2,PERF_BOT,PERF_TOP)
    ada=box(ADA_X-ADA_L/2,ADA_X+ADA_L/2,-ADA_W/2,ADA_W/2,ADA_BOT,ADA_TOP)
    for n,p in [('perfboard',perf),('Adafruit PCB',ada),('lid',lid)]:
        v=base.intersect(p).val().Volume()
        if v>0.01: raise ValueError(f'{n} interferes with base: {v:.3f} mm3')
        logs.append(f'{n}/base nominal interference: {v:.4f} mm3')
    for n,p in [('perfboard',perf),('Adafruit PCB',ada)]:
        v=lid.intersect(p).val().Volume()
        if v>0.01: raise ValueError(f'{n} interferes with lid: {v:.3f} mm3')
        logs.append(f'{n}/lid nominal interference: {v:.4f} mm3')
    cable=cyl(PROBE_CABLE_D/2,WALL+6,(PROBE_X,-OUT_W/2-2,PROBE_Z),(0,1,0))
    for n,p in [('base',base),('lid',lid)]:
        v=p.intersect(cable).val().Volume()
        if v>0.01: raise ValueError(f'probe cable interferes with {n}: {v:.3f} mm3')
        logs.append(f'probe cable/{n} nominal interference: {v:.4f} mm3')
    assert WALL>=2.4 and FLOOR>=2.4 and LID_T>=2.4
    assert USB_OPEN_BOTTOM>PERF_TOP and PROBE_OPEN_D>=PROBE_CABLE_D+2*PRINT_CLEAR
    assert ADA_HOLE_PITCH==abs(ada_holes()[1][1]-ada_holes()[0][1])
    assert PERF_TOP+PERF_COMPONENT_H+HEAD_CLEAR<=SHELL_H
    assert ADA_TOP+ADA_COMPONENT_H+HEAD_CLEAR<=SHELL_H
    assert USB_OPEN_W>=USB_PLUG_W+2*USB_CLEAR
    assert PROBE_Z-PROBE_OPEN_D/2>FLOOR
    assert CRADLE_SCREW_PITCH<CRADLE_L-6
    assert WALL+3-4.7>=1.0  # cradle pilot remains blind to cavity
    for sx,sy in CORNERS:
        x,y=corner(sx,sy)
        assert abs(x)>=OUT_L/2 and abs(y)>=OUT_W/2
    logs.append(f'wall/floor/lid {WALL}/{FLOOR}/{LID_T} mm; lip clearance {PRINT_CLEAR} mm/side')
    logs.append(f'Adafruit hole pitch {ADA_HOLE_PITCH} mm; USB opening width {USB_OPEN_W} mm; probe opening {PROBE_OPEN_D} mm')
    logs.append(f'top view looking down: USB +X is TOP; probe -Y is RIGHT; probe x={PROBE_X:.2f}, z={PROBE_Z:.2f} mm')
    logs.append(f'probe tongue side clearance {PRINT_CLEAR} mm; nominal cable-to-tongue vertical clearance {PROBE_OPEN_D/2+PRINT_CLEAR-PROBE_CABLE_D/2:.2f} mm')
    logs.append('four lid/base screw axes share corner coordinates; two cradle axes share 36 mm pitch; cradle pilots remain blind')
    logs.append(f'provisional component headroom {HEAD_CLEAR} mm above perfboard and Adafruit component envelopes; terminal driver space not simulated')
    lid_print=lid.rotate((0,0,0),(1,0,0),180)
    lid_print=lid_print.translate((0,0,-lid_print.val().BoundingBox().zmin))
    cradle_print=cradle.rotate((0,0,0),(1,0,0),-90)
    cradle_print=cradle_print.translate((0,0,-cradle_print.val().BoundingBox().zmin))
    parts={'base':base,'lid':lid_print,'probe_cradle':cradle_print,'fit_test':fit}
    for n,p in parts.items():
        exporters.export(p,str(out/f'{n}.step'))
        exporters.export(p,str(out/f'{n}.stl'),tolerance=0.025,angularTolerance=0.12)
        solid(cq.importers.importStep(str(out/f'{n}.step')),f'{n} STEP reimport')
        logs.append(f'{n}: STEP reimport valid, STL exported')
    mounted=cradle.translate((0,OUT_W/2+6,SHELL_H/2-CRADLE_H/2))
    mount_interference=base.intersect(mounted).val().Volume()
    if mount_interference>0.01: raise ValueError(f'cradle/base interference {mount_interference:.3f} mm3')
    logs.append(f'cradle/base nominal interference: {mount_interference:.4f} mm3')
    assembly=cq.Compound.makeCompound([base.val(),lid.val(),mounted.val(),perf.val(),ada.val()])
    exploded=cq.Compound.makeCompound([base.val(),lid.translate((0,0,42)).val(),
        mounted.translate((0,44,0)).val(),perf.translate((0,0,18)).val(),
        ada.translate((0,0,18)).val()])
    preview(assembly,out/'assembly.svg',(-1,1,-0.8))
    preview(exploded,out/'exploded.svg',(-1,1,-0.8))
    preview(base,out/'base_top.svg',(0,0,1))
    preview(lid,out/'lid_underside.svg',(0,0,-1))
    manifest={'units':'mm','overall_box_mm':[OUT_L,OUT_W,SHELL_H+LID_T],
        'top_view':{'view':'looking down onto lid','top':'+X (USB-C)','right':'-Y (probe)',
                    'probe_center_mm':[PROBE_X,-OUT_W/2,PROBE_Z]},
        'parts':{},'checks':logs}
    for n,p in parts.items():
        bb=p.val().BoundingBox(); manifest['parts'][n]={'bounds_mm':[round(bb.xlen,2),round(bb.ylen,2),round(bb.zlen,2)],'volume_mm3':round(p.val().Volume(),2)}
    (out/'verification.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps(manifest,indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--output',type=Path,default=Path(__file__).parent/'revision_pt1000_2026-10-17')
    run(ap.parse_args().output)
    # This Windows CadQuery/OCP build faults during interpreter teardown after
    # successful exports. Files are closed; exit explicitly only on success.
    sys.stdout.flush()
    os._exit(0)
