"""Regression fixtures for the requested USB-up / probe-right top view.

Run beside enclosure_pt1000.py, outside OneDrive. The literal fixture positions
are hand-derived from the 2026-10-05 board layout and the new -Y exit location.
They deliberately do not reuse the feature constructors being checked.
"""
import unittest

import cadquery as cq
import enclosure_pt1000 as model


def contains(part, xyz):
    return part.val().isInside(cq.Vector(*xyz), 1e-6)


def overlap(a, b):
    return a.intersect(b).val().Volume()


class EnclosureGeometryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = model.build_base()
        cls.lid = model.build_lid()

    def test_probe_slot_opens_on_right_when_usb_is_up(self):
        # Downward view: screen-up = +X, screen-right = -Y, eye = +Z.
        self.assertFalse(contains(self.base, (-44.45, -30.435, 11.0)),
                         'probe aperture must cut the -Y wall')
        self.assertFalse(contains(self.base, (-44.45, -30.435, 10.0)),
                         'rounded lower half of the aperture must be clear')
        self.assertFalse(contains(self.base, (-44.45, -30.435, 25.0)),
                         'split slot must be open to the lid')
        self.assertTrue(contains(self.base, (-74.82, 0.0, 20.0)),
                        'the former -X probe slot must be closed')
        self.assertFalse(contains(self.base, (74.82, -12.0, 20.0)),
                         'USB opening must remain on +X')

    def test_exterior_probe_lead_in_follows_the_aperture(self):
        self.assertFalse(contains(self.base, (-41.70, -31.70, 11.0)),
                         'widened lead-in must cut the exterior -Y edge')
        self.assertTrue(contains(self.base, (-41.70, -30.40, 11.0)),
                        'lead-in taper must keep material inside the wall')

    def test_lid_tongue_and_lip_follow_probe_slot(self):
        self.assertTrue(contains(self.lid, (-44.45, -30.435, 20.0)),
                        'descending tongue must close the new -Y slot')
        self.assertFalse(contains(self.lid, (-74.82, 0.0, 20.0)),
                         'no tongue may remain at the former -X exit')
        self.assertTrue(contains(self.lid, (-72.5, 0.0, 28.0)),
                        'restore the continuous lip at the former -X exit')
        self.assertLess(overlap(self.base, self.lid), 0.01,
                        'assembled tongue/lip must not intersect the base')

    def test_probe_tie_holes_flank_the_new_exit(self):
        for x in (-52.45, -36.45):
            self.assertFalse(contains(self.base, (x, -30.435, 6.0)),
                             'probe tie hole must cut the -Y wall')
        for y in (-8.0, 8.0):
            self.assertTrue(contains(self.base, (-74.82, y, 6.0)),
                            'former -X tie holes must be closed')

    def test_nominal_cable_is_clear_of_assembled_base_and_lid(self):
        cable = cq.Workplane(obj=cq.Solid.makeCylinder(
            2.0, 9.0, cq.Vector(-44.45, -34.0, 11.0), cq.Vector(0, 1, 0)))
        for name, part in [('base', self.base), ('lid', self.lid)]:
            self.assertLess(overlap(part, cable), 0.01, name)

    def test_tongue_has_print_clearance_on_both_sides(self):
        # Slot width 4.7 mm and tongue width 4.0 mm leave 0.35 mm/side.
        # A 0.30 mm strip must fit each gap without touching base or tongue.
        for x in (-46.625, -42.275):
            gauge = model.box(x-0.15, x+0.15, -31.7, -29.2, 14.0, 29.4)
            for part in (self.base, self.lid):
                self.assertLess(overlap(part, gauge), 0.001)

    def test_nominal_boards_clear_base_and_moved_lid_tongue(self):
        # Literal existing PCB envelopes, excluding unmeasured wires/components.
        boards = [model.box(-18.48, 70.42, -26.035, 26.035, 8.0, 9.6),
                  model.box(-58.42, -30.48, -12.7, 12.7, 8.0, 9.6)]
        for name, part in [('base', self.base), ('lid', self.lid)]:
            for board in boards:
                self.assertLess(overlap(part, board), 0.01, name)


if __name__ == '__main__':
    unittest.main(verbosity=2)
