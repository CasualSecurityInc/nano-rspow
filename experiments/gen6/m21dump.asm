/*
 * One root thread writes part of the R0..R3 payload to a bound buffer.
 * It is dispatched with the captured Gen6 MEDIA_OBJECT packet; its captured
 * inline data is useful for checking the first words written by the kernel.
 *
 * The header and send sequence follow the Gen6 VME OWord Block Write in
 * ref-vme/intra_frame.asm and inter_frame.asm. The differences are the
 * single binding-table entry (BTI 0), fixed OWord offset zero, and payload
 * copied from R0..R3.
 */

mov (8) r4.0<1>:UD 0:UD {align1};
mov (1) r4.20<1>:UB r0.20<0,1,0>:UB {align1}; /* dispatch id */
mov (8) m0.0<1>:UD r4.0<8,8,1>:UD {align1};

mov (8) m1.0<1>:UD r0.0<8,8,1>:UD {align1};
mov (8) m2.0<1>:UD r1.0<8,8,1>:UD {align1};
mov (8) m3.0<1>:UD r2.0<8,8,1>:UD {align1};
mov (8) m4.0<1>:UD r3.0<8,8,1>:UD {align1};

/* Gen6 VME's eight-OWord block write, narrowed to our single BTI 0. */
send (16) 0 r16 null data_port(5, 8, 4, 0, 1, 1) mlen 5 rlen 1 {align1};

/* Exact Gen6 VME thread-spawner EOT sequence. */
mov (8) m0.0<1>:UD r0.0<8,8,1>:UD {align1};
send (16) 0 acc0<1>UW null thread_spawner(0, 0, 1) mlen 1 rlen 0 {align1 EOT};
