
                                      
mov (1) r20.0<1>:UD 0x00000101:UD {align1};
mov (1) r20.4<1>:UD 0x00000102:UD {align1};
mov (1) r20.8<1>:UD 0x00000103:UD {align1};
mov (1) r20.12<1>:UD 0x00000104:UD {align1};
mov (1) r20.16<1>:UD 0x00000105:UD {align1};
mov (1) r20.20<1>:UD 0x00000106:UD {align1};
mov (1) r20.24<1>:UD 0x00000107:UD {align1};
mov (1) r20.28<1>:UD 0x00000108:UD {align1};
mov (8) r4.0<1>:UD 0x00000000:UD {align1};
mov (1) r4.20<1>:UB r0.20<0,1,0>:UB {align1};
mov (1) r4.8<1>:UD 0x00000000:UD {align1};
mov (8) m0.0<1>:UD r4.0<8,8,1>:UD {align1};
mov (8) m1.0<1>:UD r20.0<4,4,1>:UD {align1};
mov (8) m2.0<1>:UD r1.0<8,8,1>:UD {align1};
mov (8) m3.0<1>:UD r2.0<8,8,1>:UD {align1};
mov (8) m4.0<1>:UD r3.0<8,8,1>:UD {align1};
send (16) 0 r16 null data_port(5, 8, 4, 0, 1, 1) mlen 5 rlen 1 {align1};
mov (8) r17.0<1>:UD r16.0<8,8,1>:UD {align1};
mov (8) m0.0<1>:UD r0.0<8,8,1>:UD {align1};
send (16) 0 acc0<1>UW null thread_spawner(0, 0, 1) mlen 1 rlen 0 {align1 EOT};

