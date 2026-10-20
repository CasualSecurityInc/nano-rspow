# Route C M2.1-final: Session 5 results

All direct submissions in this session used the captured 14-dword
`MEDIA_OBJECT` packet. The host harness read `DRM_IOCTL_I915_GET_RESET_STATS`
before submission and after wait. The reset count remained 7 for every
reported run; no new GT reset was observed.

## A0: dataport write

The existing 160-byte kernel (`m21dump.asm`) completed. Its 256-byte result
buffer had nonzero dwords 2 and 3:

```text
dword[2] = 0x000f0001
dword[3] = 0x00300007
```

Those values match captured `MEDIA_OBJECT` inline dwords 8 and 9. This proves
that the current kernel's dataport message can write through the bound buffer
surface, and that part of the packet payload reaches the write data. It does
not yet validate the larger multi-register record layout.

## A1: extended register dump

The 336-byte two-send kernel (`m21dump2.asm`) completed with the reset count
unchanged, both with default inline data and with `0xfeed0000` through
`0xfeed0007` in packet dwords 6–13. In both cases the first four result words
were the same stable values:

```text
a722c924 21a95601 662909e4 9114485c
```

No CURBE magic or inline magic appeared in the result. Increasing the CURBE
load/read length from 64 bytes/two units to 128 bytes/four units did not expose
the magic and changed the A0 output, so the experiment was reverted. CURBE
delivery and inline-to-GRF placement remain unproven; A1 is inconclusive.

## C gate

The multi-thread slot test was not submitted. Its per-thread result address
depends on locating an inline value in A1, which the data does not identify.
Submitting multiple threads with an unverified address would create write
collisions and would not establish the requested property.
