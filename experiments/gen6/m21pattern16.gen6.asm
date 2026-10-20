
                                      
mov (8) r4.0<1>:UD 0x00000000:UD {align1};
mov (1) r4.20<1>:UB r0.20<0,1,0>:UB {align1};
mov (1) r4.8<1>:UD 0x00000000:UD {align1};
mov (1) r20.0<1>:UD 0x61000000:UD {align1};
mov (1) r20.4<1>:UD 0x61000001:UD {align1};
mov (1) r20.8<1>:UD 0x61000002:UD {align1};
mov (1) r20.12<1>:UD 0x61000003:UD {align1};
mov (1) r20.16<1>:UD 0x61000004:UD {align1};
mov (1) r20.20<1>:UD 0x61000005:UD {align1};
mov (1) r20.24<1>:UD 0x61000006:UD {align1};
mov (1) r20.28<1>:UD 0x61000007:UD {align1};
mov (1) r4.8<1>:UD 0x00000000:UD {align1};
mov (8) m0.0<1>:UD r4.0<8,8,1>:UD {align1};
mov (8) m1.0<1>:UD r20.0<8,8,1>:UD {align1};
send (16) 0 r16 null data_port(5, 8, 0, 0, 1, 1) mlen 2 rlen 1 {align1};
mov (8) r17.0<1>:UD r16.0<8,8,1>:UD {align1};
mov (8) m0.0<1>:UD r0.0<8,8,1>:UD {align1};
send (16) 0 acc0<1>UW null thread_spawner(0, 0, 1) mlen 1 rlen 0 {align1 EOT};

