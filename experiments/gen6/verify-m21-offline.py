#!/usr/bin/env python3
"""Check Gen6 field locations and packed fields against captured VAAPI BOs."""
from pathlib import Path
import struct
import xml.etree.ElementTree as ET

here = Path(__file__).resolve().parent
xml = ET.parse(here / 'gen6.xml').getroot()
idrt = xml.find("struct[@name='INTERFACE_DESCRIPTOR_DATA']")
length = idrt.find("field[@name='Constant URB Entry Read Length']")
assert (int(length.attrib['start']), int(length.attrib['end'])) == (144, 159)
print('ID DW4: CURBE length is in bits 16..31; 0x00020000 is offset 0, length 2')
ss = xml.find("struct[@name='RENDER_SURFACE_STATE']")
shifts = {name: int(ss.find(f"field[@name='{name}']").attrib['start']) % 32
          for name in ('Width', 'Height', 'Surface Pitch', 'Depth')}
assert shifts == {'Width': 6, 'Height': 19, 'Surface Pitch': 3, 'Depth': 21}
print('Surface shifts from XML:', shifts)
raw = (here / 'capture/session4/bo-002-4-45.bin').read_bytes()
# Surface 0: 128x96 source => 8x6 macroblocks, one 16-byte intra record each.
# Surface 1: the capture's 512 KiB buffer (also the corresponding BO size).
# Surface 2: logical size decoded from capture, used as an additional round trip.
for off, n in ((0, 8*6), (32, 524288//16), (64, 228)):
    w = struct.unpack_from('<8I', raw, off)
    e = n - 1
    dw2 = ((e & 127) << shifts['Width']) | (((e >> 7) & 8191) << shifts['Height'])
    dw3 = (((e >> 20) & 127) << shifts['Depth']) | (15 << shifts['Surface Pitch'])
    assert (dw2, dw3) == (w[2], w[3]), (off, dw2, dw3, w)
    print(f'PASS captured surface +0x{off:x}: {n*16} bytes; DW2=0x{dw2:08x} DW3=0x{dw3:08x}')
print('OWord block controls in ref-vme/vme.inc: 0=16B low, 1=16B high, 2=32B, 3=64B, 4=128B')
