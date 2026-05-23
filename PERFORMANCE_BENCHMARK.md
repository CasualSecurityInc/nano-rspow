## nano-rspow Benchmark Results

These anecdotal results were run on a MacBook Air M1 using the following commandline:

```
$ time cargo run --all-features --release benchmark --format markdown --backend all
# [...]
cargo run --all-features --release benchmark --format markdown --backend all  378.11s user 39.20s system 132% cpu 5:15.63 total
```

| Backend | Mode | Tier | Threshold | Samples | Min (ms) | Max (ms) | Mean (ms) | Median (ms) |
|---------|------|------|-----------|--------:|---------:|---------:|----------:|------------:|
| `cpu` | `cold` | `dev` | `0xfe00000000000000` | 5 | 0.0 | 0.7 | 0.2 | 0.1 |
| `cpu` | `cold` | `ep2_recv` | `0xfffffe0000000000` | 5 | 1025.4 | 1204.8 | 1098.6 | 1087.8 |
| `cpu` | `cold` | `epoch1` | `0xffffffc000000000` | 5 | 1622.1 | 1825.3 | 1763.8 | 1785.9 |
| `cpu` | `cold` | `ep2_send` | `0xfffffff800000000` | 5 | 1757.4 | 1897.1 | 1823.4 | 1816.5 |
| `cpu` | `warm` | `dev` | `0xfe00000000000000` | 5 | 0.1 | 0.1 | 0.1 | 0.1 |
| `cpu` | `warm` | `ep2_recv` | `0xfffffe0000000000` | 5 | 1011.5 | 1112.4 | 1056.0 | 1051.0 |
| `cpu` | `warm` | `epoch1` | `0xffffffc000000000` | 5 | 1699.0 | 2031.1 | 1919.0 | 1988.5 |
| `cpu` | `warm` | `ep2_send` | `0xfffffff800000000` | 5 | 1849.3 | 1986.4 | 1920.1 | 1923.2 |
| `wgpu` | `cold` | `dev` | `0xfe00000000000000` | 5 | 11.1 | 14.5 | 12.0 | 11.4 |
| `wgpu` | `cold` | `ep2_recv` | `0xfffffe0000000000` | 5 | 41.6 | 93.0 | 66.1 | 59.2 |
| `wgpu` | `cold` | `epoch1` | `0xffffffc000000000` | 5 | 100.2 | 345.3 | 224.4 | 215.6 |
| `wgpu` | `cold` | `ep2_send` | `0xfffffff800000000` | 5 | 792.6 | 6369.2 | 3048.1 | 2688.0 |
| `wgpu` | `warm` | `dev` | `0xfe00000000000000` | 5 | 1.5 | 1.8 | 1.6 | 1.6 |
| `wgpu` | `warm` | `ep2_recv` | `0xfffffe0000000000` | 5 | 18.1 | 104.4 | 57.5 | 52.4 |
| `wgpu` | `warm` | `epoch1` | `0xffffffc000000000` | 5 | 72.1 | 677.3 | 377.1 | 428.7 |
| `wgpu` | `warm` | `ep2_send` | `0xfffffff800000000` | 5 | 254.3 | 4390.7 | 2048.4 | 1035.5 |
| `opencl` | `cold` | `dev` | `0xfe00000000000000` | 5 | 1.2 | 1.9 | 1.4 | 1.3 |
| `opencl` | `cold` | `ep2_recv` | `0xfffffe0000000000` | 5 | 2.3 | 912.7 | 343.7 | 269.7 |
| `opencl` | `cold` | `epoch1` | `0xffffffc000000000` | 5 | 549.0 | 7573.3 | 2301.8 | 1108.4 |
| `opencl` | `cold` | `ep2_send` | `0xfffffff800000000` | 5 | 5885.3 | 49208.3 | 25173.9 | 22335.8 |
| `opencl` | `warm` | `dev` | `0xfe00000000000000` | 5 | 1.1 | 1.5 | 1.3 | 1.3 |
| `opencl` | `warm` | `ep2_recv` | `0xfffffe0000000000` | 5 | 62.6 | 862.4 | 410.9 | 262.2 |
| `opencl` | `warm` | `epoch1` | `0xffffffc000000000` | 5 | 44.1 | 3394.7 | 1579.5 | 1738.1 |
| `opencl` | `warm` | `ep2_send` | `0xfffffff800000000` | 5 | 7553.9 | 14180.9 | 10463.9 | 10485.4 |
| `nano-pow` | `warm` | `dev` | `0xfe00000000000000` | 5 | 934.7 | 3050.0 | 1374.3 | 940.3 |
| `nano-pow` | `warm` | `ep2_recv` | `0xfffffe0000000000` | 5 | 942.8 | 1056.9 | 1018.5 | 1034.5 |
| `nano-pow` | `warm` | `epoch1` | `0xffffffc000000000` | 5 | 1211.3 | 1625.7 | 1397.3 | 1378.7 |
| `nano-pow` | `warm` | `ep2_send` | `0xfffffff800000000` | 5 | 2237.6 | 4566.4 | 3017.8 | 2567.3 |

> Tiers benchmarked: `dev`, `ep2_recv`, `epoch1`, `ep2_send`.
