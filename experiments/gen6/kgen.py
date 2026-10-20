#!/usr/bin/env python3
"""Emit Gen6 SIMD8 Blake2b-8: eight nonces/thread, one SoA record and EOT.

The small instruction IR can be interpreted offline and checked against
hashlib before assembling. Hardware encoding is verified by golden.py.
"""
import argparse
from dataclasses import dataclass
import hashlib
import heapq
import json
import random
import struct
import sys

IV = [0x6a09e667f3bcc908, 0xbb67ae8584caa73b, 0x3c6ef372fe94f82b,
      0xa54ff53a5f1d36f1, 0x510e527fade682d1, 0x9b05688c2b3e6c1f,
      0x1f83d9abfb41bd6b, 0x5be0cd19137e2179]
SIGMA = [
    [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
    [14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3],
    [11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4],
    [7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8],
    [9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13],
    [2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9],
    [12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11],
    [13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10],
    [6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5],
    [10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0]]
COL = [(0,4,8,12),(1,5,9,13),(2,6,10,14),(3,7,11,15),
       (0,5,10,15),(1,6,11,12),(2,7,8,13),(3,4,9,14)]
MASK32, MASK64 = (1 << 32)-1, (1 << 64)-1


@dataclass(frozen=True)
class Operand:
    reg: int | None = None
    byte: int = 0
    broadcast: bool = False
    value: int = 0

    def asm(self, width=8):
        if self.reg is None:
            return f'0x{self.value & MASK32:08x}:UD'
        region = '0,1,0' if self.broadcast else ('16,16,1' if width == 16 else '8,8,1')
        return f'r{self.reg}.{self.byte}<{region}>:UD'


def vr(reg): return Operand(reg)
def sc(reg, byte=0): return Operand(reg, byte, True)
def imm(value): return Operand(value=value)


class Pool:
    def __init__(self, lanes=8):
        self.span = lanes // 8
        first = 11 if lanes == 8 else 12
        self.free = list(range(first, 96 if lanes == 8 else 126, self.span))
        self.live = set()
        self.highest = 10

    def get(self):
        if not self.free: raise RuntimeError('GRF pool exhausted')
        reg = heapq.heappop(self.free)
        assert reg not in self.live
        self.live.add(reg)
        self.highest = max(self.highest, reg + self.span - 1)
        return reg

    def put(self, *regs):
        for reg in regs:
            assert reg in self.live, f'double free/non-owned r{reg}'
            self.live.remove(reg)
            heapq.heappush(self.free, reg)


@dataclass
class Pair:
    lo: int
    hi: int
    def opl(self): return vr(self.lo)
    def oph(self): return vr(self.hi)


@dataclass(frozen=True)
class Uniform:
    reg: int
    byte: int
    def opl(self): return sc(self.reg, self.byte)
    def oph(self): return sc(self.reg, self.byte+4)


class Nonce:
    def opl(self): return vr(8)
    def oph(self): return sc(2, 12)


class Kernel:
    def __init__(self, rounds=12, pred=False, lanes=8):
        if lanes not in (8, 16): raise ValueError('lanes must be 8 or 16')
        self.rounds, self.pred, self.lanes, self.ops = rounds, pred, lanes, []
        self.pool = Pool(lanes)
        # r0 header, r1/r2 CURBE, r3 inline, r4 write header, r5 lane
        # r6=t*8, r7=batch base+t*8, r8/r9=nonce, r10=carry mask.
        for lane in range(lanes):
            self.emit('mov', (5 + lane // 8, (lane % 8)*4), imm(lane), width=1)
        self.emit('mov', 5, vr(5), width=lanes)
        self.emit('shl', 4, sc(3), imm(lanes.bit_length()-1), width=1)
        self.emit('add', 7, sc(2, 8), sc(4), width=1)
        self.emit('add', 8, sc(7), vr(5))
        self.emit('shl', 7, sc(3), imm(lanes.bit_length()-1), width=1)
        initial = [IV[0] ^ 0x01010008] + IV[1:] + IV[:]
        initial[12] ^= 40
        initial[14] ^= MASK64
        self.state = []
        for value in initial:
            pair = Pair(self.pool.get(), self.pool.get())
            self.emit('mov', pair.lo, imm(value))
            self.emit('mov', pair.hi, imm(value >> 32))
            self.state.append(pair)
        for r in range(rounds):
            sigma = SIGMA[r % 10]
            for g, indexes in enumerate(COL):
                a,b,c,d = [self.state[i] for i in indexes]
                self.g(a,b,c,d,self.message(sigma[2*g]),self.message(sigma[2*g+1]))
                owned = [reg for p in self.state for reg in (p.lo,p.hi)]
                assert len(set(owned)) == 32 and set(owned) == self.pool.live
        lo, hi = self.pool.get(), self.pool.get()
        self.emit('xor', lo, self.state[0].opl(), self.state[8].opl())
        self.emit('xor', lo, vr(lo), imm(IV[0] ^ 0x01010008))
        self.emit('xor', hi, self.state[0].oph(), self.state[8].oph())
        self.emit('xor', hi, vr(hi), imm((IV[0] ^ 0x01010008) >> 32))
        gt, eq, ge, hit = [self.pool.get() for _ in range(4)]
        self.emit('cmp.g.f0.0', gt, vr(hi), sc(2,4))
        self.emit('cmp.e.f0.0', eq, vr(hi), sc(2,4))
        self.emit('cmp.ge.f0.0', ge, vr(lo), sc(2))
        self.emit('and', eq, vr(eq), vr(ge))
        self.emit('or', hit, vr(gt), vr(eq))
        self.emit('and', hit, vr(hit), imm(1))
        self.output_regs = (8, lo, hi, hit)

    def emit(self, op, dest, a, b=None, width=None):
        if width is None: width = self.lanes
        dest = (dest, 0) if isinstance(dest, int) else dest
        assert dest[1] % 4 == 0 and dest[1]//4 + width <= (8 if width <= 8 else 16)
        self.ops.append((op, dest, a, b, width))

    def message(self, k):
        if k == 0: return Nonce()
        if k <= 4: return Uniform(1,(k-1)*8)
        return None

    def rebind(self, dest, lo, hi):
        self.pool.put(dest.lo, dest.hi)
        dest.lo, dest.hi = lo, hi

    def add2(self, a, b):
        lo = self.pool.get()
        self.emit('add', lo, a.opl(), b.opl())
        self.emit('cmp.l.f0.0', 10, vr(lo), a.opl())
        hi = self.pool.get()
        self.emit('add', hi, a.oph(), b.oph())
        if self.pred:
            self.emit('addp', hi, vr(hi), imm(1))
        else:
            self.emit('and', 10, vr(10), imm(1))
            self.emit('add', hi, vr(hi), vr(10))
        return lo, hi

    def add(self, dest, a, b, message=None):
        lo, hi = self.add2(a,b)
        if message is not None:
            temp = Pair(lo,hi)
            lo, hi = self.add2(temp,message)
            self.pool.put(temp.lo,temp.hi)
        self.rebind(dest,lo,hi)

    def xor(self, dest, source):
        self.emit('xor', dest.lo, dest.opl(), source.opl())
        self.emit('xor', dest.hi, dest.oph(), source.oph())

    def rotate(self, dest, n):
        if n == 32:
            dest.lo, dest.hi = dest.hi, dest.lo
            return
        low, high = dest.opl(), dest.oph()
        if n > 32: low, high = high, low
        n %= 32
        lo, hi, temp = [self.pool.get() for _ in range(3)]
        self.emit('shr', lo, low, imm(n))
        self.emit('shl', temp, high, imm(32-n))
        self.emit('or', lo, vr(lo), vr(temp))
        self.emit('shr', hi, high, imm(n))
        self.emit('shl', temp, low, imm(32-n))
        self.emit('or', hi, vr(hi), vr(temp))
        self.pool.put(temp)
        self.rebind(dest,lo,hi)

    def g(self,a,b,c,d,x,y):
        self.add(a,a,b,x); self.xor(d,a); self.rotate(d,32)
        self.add(c,c,d); self.xor(b,c); self.rotate(b,24)
        self.add(a,a,b,y); self.xor(d,a); self.rotate(d,16)
        self.add(c,c,d); self.xor(b,c); self.rotate(b,63)

    def assembly(self):
        layout = 'one 128-byte SoA8 block' if self.lanes == 8 else 'two adjacent 128-byte SoA8 blocks'
        lines = [f'/* {self.rounds}-round Blake2b-8; SIMD{self.lanes}: {layout}/thread. */']
        for op, (reg, byte), a, b, width in self.ops:
            sources = a.asm(width) + (' ' + b.asm(width) if b is not None else '')
            if op == 'addp':
                lines.append(f'(f0.0) add ({width}) r{reg}.{byte}<1>:UD {sources} {{align1}};')
            else:
                lines.append(f'{op} ({width}) r{reg}.{byte}<1>:UD {sources} {{align1}};')
        footer = [
            'mov (8) r4.0<1>:UD 0:UD {align1};',
            'mov (1) r4.20<1>:UB r0.20<0,1,0>:UB {align1};',
        ]
        if self.lanes == 8:
            footer += ['mov (1) r4.8<1>:UD r7.0<0,1,0>:UD {align1};',
                       'mov (8) m0.0<1>:UD r4.0<8,8,1>:UD {align1};']
            footer += [f'mov (8) m{i+1}.0<1>:UD r{reg}.0<8,8,1>:UD {{align1}};'
                       for i,reg in enumerate(self.output_regs)]
            footer += ['send (16) 0 r16 null data_port(5, 8, 4, 0, 1, 1) mlen 5 rlen 1 {align1};',
                       'mov (8) r17.0<1>:UD r16.0<8,8,1>:UD {align1};']
        else:
            footer += ['mov (1) r4.8<1>:UD r7.0<0,1,0>:UD {align1};',
                       'mov (8) m0.0<1>:UD r4.0<8,8,1>:UD {align1};']
            for i,reg in enumerate(self.output_regs):
                footer.append(f'mov (8) m{i+1}.0<1>:UD r{reg}.0<8,8,1>:UD {{align1}};')
            footer += ['send (16) 0 r16 null data_port(5, 8, 4, 0, 1, 1) mlen 5 rlen 1 {align1};',
                       'add (1) r4.8<1>:UD r4.8<0,1,0>:UD 8:UD {align1};',
                       'mov (8) m0.0<1>:UD r4.0<8,8,1>:UD {align1};']
            for i,reg in enumerate(self.output_regs):
                footer.append(f'mov (8) m{i+1}.0<1>:UD r{reg+1}.0<8,8,1>:UD {{align1}};')
            footer.append('send (16) 0 r16 null data_port(5, 8, 4, 0, 1, 1) mlen 5 rlen 1 {align1};')
        footer += [
            'mov (8) m0.0<1>:UD r0.0<8,8,1>:UD {align1};',
            'send (16) 0 acc0<1>UW null thread_spawner(0, 0, 1) mlen 1 rlen 0 {align1 EOT};',
        ]
        return '\n'.join(lines+footer)+'\n', len(self.ops)+len(footer)

    def simulate(self,root,base,thread,threshold):
        regs = [[0]*8 for _ in range(128)]
        flags = [False]*self.lanes
        curbe = list(struct.unpack('<8I',root)) + [threshold & MASK32, threshold >> 32,
                 base & MASK32, base >> 32] + list(range(0xc0de000c,0xc0de0010))
        regs[1], regs[2], regs[3][0] = curbe[:8], curbe[8:], thread
        def read(src,width):
            if src.reg is None: return [src.value & MASK32]*width
            i = src.byte//4
            if src.broadcast: return [regs[src.reg][i]]*width
            flat = regs[src.reg][i:]
            if width > 8: flat += regs[src.reg+1]
            return flat[:width]
        for op,(reg,byte),a,b,width in self.ops:
            xs, ys = read(a,width), read(b,width) if b is not None else [0]*width
            result=[]
            for x,y in zip(xs,ys):
                if op=='mov': v=x
                elif op=='add': v=x+y
                elif op=='xor': v=x^y
                elif op=='and': v=x&y
                elif op=='or': v=x|y
                elif op=='shl': v=x<<y
                elif op=='shr': v=x>>y
                elif op.startswith('cmp.'):
                    relation=op.split('.')[1]
                    condition={'l':x<y,'g':x>y,'e':x==y,'ge':x>=y}[relation]
                    flags[len(result)] = condition
                    v=MASK32 if condition else 0
                elif op == 'addp':
                    v=x+y if flags[len(result)] else x
                else: raise ValueError(op)
                result.append(v & MASK32)
            regs[reg][byte//4:byte//4+min(width,8)]=result[:8]
            if width > 8: regs[reg+1][:width-8]=result[8:]
        return [regs[r][:] + (regs[r+1][:] if self.lanes == 16 else []) for r in self.output_regs]


def reference(nonce,root,rounds):
    msg=struct.unpack('<16Q',struct.pack('<Q',nonce)+root+bytes(88))
    v=[IV[0]^0x01010008]+IV[1:]+IV[:]
    v[12]^=40; v[14]^=MASK64
    def rotr(x,n): return ((x>>n)|(x<<(64-n))) & MASK64
    for r in range(rounds):
        s=SIGMA[r%10]
        for g,(a,b,c,d) in enumerate(COL):
            v[a]=(v[a]+v[b]+msg[s[2*g]]) & MASK64
            v[d]=rotr(v[d]^v[a],32)
            v[c]=(v[c]+v[d]) & MASK64
            v[b]=rotr(v[b]^v[c],24)
            v[a]=(v[a]+v[b]+msg[s[2*g+1]]) & MASK64
            v[d]=rotr(v[d]^v[a],16)
            v[c]=(v[c]+v[d]) & MASK64
            v[b]=rotr(v[b]^v[c],63)
    return v[0]^v[8]^IV[0]^0x01010008


def self_test(pred=False, lanes=8):
    rng=random.Random(6207)
    edge32 = 0xfffffff8 if lanes == 8 else 0xfffffff0
    edge64 = 0xfffffffffffffff8 if lanes == 8 else 0xfffffffffffffff0
    cases=[(bytes(32),0,0),(bytes(range(32)),edge32,0),
           (bytes(31)+b'\x01',0x100000000,0),(bytes([255])*32,edge64,0)]
    cases += [(rng.randbytes(32),rng.randrange(1<<32)<<32, t) for t in (0,1,7,31,255,4095)]
    checked=0
    for rounds in (2,12):
        k=Kernel(rounds,pred=pred,lanes=lanes)
        for root,base,t in cases:
            threshold=reference(base+t*lanes,root,rounds)
            for thr in (0,1<<63,MASK64,threshold,min(threshold+1,MASK64)):
                got=k.simulate(root,base,t,thr)
                for lane in range(lanes):
                    nonce=base+t*lanes+lane
                    digest=reference(nonce,root,rounds)
                    if rounds==12:
                        truth=int.from_bytes(hashlib.blake2b(struct.pack('<Q',nonce)+root,digest_size=8).digest(),'little')
                        assert digest==truth
                    assert [reg[lane] for reg in got]==[nonce & MASK32,digest & MASK32,digest>>32,int(digest>=thr)]
                    checked+=1
    print(f'PASS generator IR: {checked} lane records, lanes={lanes}, 2/12 rounds, carry/nonce/threshold boundaries; 12-round digests agree with hashlib')


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--rounds',type=int,default=12)
    ap.add_argument('--metadata')
    ap.add_argument('--self-test',action='store_true')
    ap.add_argument('--pred',action='store_true',help='use flag-predicated carry adds')
    ap.add_argument('--lanes',type=int,choices=(8,16),default=8)
    args=ap.parse_args()
    if not 0<=args.rounds<=12: ap.error('rounds must be 0..12')
    if args.self_test: self_test(args.pred,args.lanes); return
    k=Kernel(args.rounds,pred=args.pred,lanes=args.lanes)
    asm,count=k.assembly()
    meta={'rounds':args.rounds,'instructions':count,'bytes':count*16,
          'highest_grf':k.pool.highest,
          'record_layout':'soa8' if args.lanes == 8 else 'two-adjacent-soa8-blocks',
          'nonces_per_thread':args.lanes,
          'predicated_carry':args.pred}
    if args.metadata:
        with open(args.metadata,'w') as f: json.dump(meta,f,indent=2); f.write('\n')
    print(asm,end='')
    print(f'{count} instructions, {count*16} bytes, highest GRF r{k.pool.highest}, {args.rounds} rounds, lanes={args.lanes}; SoA record; predicated_carry={args.pred}',file=sys.stderr)


if __name__=='__main__': main()
