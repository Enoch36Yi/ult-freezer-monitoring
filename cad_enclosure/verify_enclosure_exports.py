"""Verify generated STEP/STL artifacts and draw a literal top-view projection.

Usage: python verify_enclosure_exports.py path/to/revision
Requires CadQuery 2.8.0 and trimesh 5.1.1. No remote services are used.
"""
import argparse
import hashlib
import json
from pathlib import Path

import cadquery as cq
import trimesh


def write_top_preview(mesh, path):
    # Orthographic downward view, explicitly mapped to the requested orientation:
    # +X = screen-up, -Y = screen-right, +Z = towards the viewer.
    scale, width, height = 5.5, 730, 1200
    cx, cy = 340, 600

    def screen(vertex):
        return cx-scale*vertex[1], cy-scale*vertex[0]

    polygons = []
    triangles = mesh.triangles
    for face_index in triangles[:, :, 2].mean(axis=1).argsort():
        tri = triangles[face_index]
        if mesh.face_normals[face_index, 2] <= 0.01:
            continue
        points = ' '.join(f'{x:.2f},{y:.2f}' for x,y in map(screen, tri))
        z = tri[:, 2].mean()
        color = '#dce8f1' if z < 7 else '#87a8c1' if z < 20 else '#416b8a'
        polygons.append(f'<polygon points="{points}" fill="{color}" stroke="{color}" stroke-width="0.12"/>')
    usb_x, usb_y = screen((76.22, -12.0, 0))
    probe_x, probe_y = screen((-44.45, -31.835, 0))
    text = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
<rect width="100%" height="100%" fill="white"/>
<g font-family="Arial,sans-serif" fill="#17364b">
<text x="35" y="40" font-size="24" font-weight="bold">PT1000 enclosure — corrected right exit</text>
<text x="35" y="68" font-size="16">Actual base STL, top view looking down onto lid position</text>
<text x="35" y="92" font-size="16">USB-C = TOP (+X) · probe exit = RIGHT (−Y)</text>
{''.join(polygons)}
<g stroke="#b43125" stroke-width="2" fill="none">
<path d="M {usb_x:.2f} {usb_y-3:.2f} L {usb_x:.2f} {usb_y-38:.2f}"/>
<path d="M {probe_x+3:.2f} {probe_y:.2f} L {probe_x+47:.2f} {probe_y:.2f}"/>
</g>
<text x="{usb_x-62:.2f}" y="{usb_y-47:.2f}" font-size="17" fill="#b43125">USB-C · TOP</text>
<text x="{probe_x+10:.2f}" y="{probe_y-18:.2f}" font-size="17" fill="#b43125">PROBE</text>
<text x="{probe_x+10:.2f}" y="{probe_y+25:.2f}" font-size="17" fill="#b43125">RIGHT</text>
<text x="35" y="1140" font-size="16">Base only; the matching lid tongue closes the upper split slot.</text>
<text x="35" y="1166" font-size="16">Digital geometry verified. Dimensions and physical fit remain provisional.</text>
</g></svg>'''
    path.write_text(text, encoding='utf-8')


def verify(out):
    results = {}
    for name in ('base', 'lid', 'probe_cradle', 'fit_test'):
        step = cq.importers.importStep(str(out/f'{name}.step')).val()
        solids = step.Solids()
        assert len(solids) == 1 and solids[0].isValid(), name
        mesh = trimesh.load_mesh(out/f'{name}.stl', process=True)
        components = len(mesh.split(only_watertight=False))
        assert mesh.is_watertight and mesh.is_winding_consistent, name
        assert components == 1 and mesh.volume > 0, name
        step_volume = step.Volume()
        volume_error = abs(mesh.volume-step_volume)/step_volume
        assert volume_error < 0.002, (name, volume_error)
        bb = step.BoundingBox()
        step_bounds = (bb.xlen, bb.ylen, bb.zlen)
        assert max(abs(a-b) for a,b in zip(step_bounds,mesh.extents)) < 0.05, name
        results[name] = {
            'step_valid_solids': len(solids), 'watertight': bool(mesh.is_watertight),
            'winding_consistent': bool(mesh.is_winding_consistent),
            'components': components, 'faces': len(mesh.faces),
            'bounds_mm': [round(float(v), 4) for v in mesh.extents],
            'mesh_volume_mm3': round(float(mesh.volume), 3),
            'step_volume_mm3': round(step_volume, 3),
            'relative_volume_error': round(float(volume_error), 7),
        }
        if name == 'base':
            write_top_preview(mesh, out/'base_top_usb_up.svg')
    (out/'mesh_verification.json').write_text(json.dumps(results,indent=2), encoding='utf-8')
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted(out.iterdir()) if p.suffix in ('.step','.stl','.py')}
    (out/'sha256.json').write_text(json.dumps(hashes,indent=2), encoding='utf-8')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    verify(parser.parse_args().output)
