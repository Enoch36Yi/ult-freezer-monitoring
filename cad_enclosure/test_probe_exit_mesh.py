"""Dependency-free regression on exported binary-STL wall geometry.

Usage: python test_probe_exit_mesh.py path/to/revision
Uses upward ray intersections with the actual triangles; it does not recreate
the CAD features or infer orientation from filenames.
"""
import struct
import sys
import unittest
from pathlib import Path

REVISION = Path(__file__).parent/'revision_pt1000_2026-10-17'


def read_triangles(path):
    data = path.read_bytes()
    count = struct.unpack_from('<I', data, 80)[0]
    if len(data) != 84 + 50*count:
        raise ValueError('Expected binary STL with complete triangles')
    return [struct.unpack_from('<9f', data, 84+50*i+12) for i in range(count)]


def inside(triangles, xyz):
    x, y, z = xyz
    hits = set()
    for tri in triangles:
        ax,ay,az,bx,by,bz,cx,cy,cz = tri
        denominator = (by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
        if abs(denominator) < 1e-9:
            continue
        u = ((by-cy)*(x-cx)+(cx-bx)*(y-cy))/denominator
        v = ((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/denominator
        w = 1-u-v
        if min(u,v,w) < -1e-7:
            continue
        height = u*az+v*bz+w*cz
        if height > z+1e-6:
            hits.add(round(height, 5))
    return len(hits) % 2 == 1


class ProbeExitMeshTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.triangles = read_triangles(REVISION/'base.stl')

    def test_probe_aperture_is_on_right_wall(self):
        self.assertFalse(inside(self.triangles,(-44.45,-30.435,11.0)),
                         'missing right-side (-Y) probe aperture')

    def test_former_probe_wall_is_closed(self):
        self.assertTrue(inside(self.triangles,(-74.82,0.0,20.0)),
                        'former -X split slot must be closed')

    def test_usb_still_opens_at_top(self):
        self.assertFalse(inside(self.triangles,(74.82,-12.0,20.0)))


if __name__ == '__main__':
    if len(sys.argv) > 1 and not sys.argv[1].startswith('-'):
        REVISION = Path(sys.argv.pop(1))
    unittest.main(verbosity=2)
