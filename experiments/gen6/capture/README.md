# VAAPI capture sample

`sub-002.tar` contains the manifest and BO snapshots from one successful ffmpeg H.264 VAAPI encode submission on `lemox.lan` (PCI 8086:0126). The capture was made before `execbuf2` submission and does not include unrelated submissions. The relocation-aware copy retained for replay is in `session4/` (submission 002); the other raw per-submission BO dumps are local capture output and are ignored.

The decoded command stream is in `../cap-decode.log`. Its sequence is `PIPELINE_SELECT`, `STATE_BASE_ADDRESS`, 8-dword `MEDIA_VFE_STATE`, `MEDIA_CURBE_LOAD`, `MEDIA_INTERFACE_DESCRIPTOR_LOAD`, then Gen6 `MEDIA_OBJECT`. Across the 30 captured media batches, no `MEDIA_OBJECT_WALKER` appeared at a command boundary. The VFE values were stable: 59 max threads, 16 URB entries, URB entry size 58, CURBE allocation 36, and scratch disabled.

The capture source and decoder are `../snb-cap.c` and `../snb-cap-decode.py`. The ffmpeg H.264 VAAPI encode returned success. `vainfo` was unavailable, but the driver was loaded by ffmpeg. Installing ffmpeg and `i965-va-driver` added 118 MB according to apt; both are now installed on lemox.
