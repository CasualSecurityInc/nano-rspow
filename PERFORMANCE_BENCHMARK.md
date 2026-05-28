## nano-rspow Benchmark Results

These anecdotal results were run on a MacBook Air M1 using the following commandline:

```
$ time cargo run --all-features --release benchmark --format markdown --backend all
```

| Backend | Mode | Tier | Threshold | Samples | Min (ms) | Max (ms) | Mean (ms) | Median (ms) |
|---------|------|------|-----------|--------:|---------:|---------:|----------:|------------:|
| `cpu` | `cold` | `dev` | `0xfe00000000000000` | 5 | 0.1 | 0.6 | 0.2 | 0.1 |
| `cpu` | `cold` | `ep2_recv` | `0xfffffe0000000000` | 5 | 45.2 | 521.8 | 167.5 | 69.7 |
| `cpu` | `cold` | `epoch1` | `0xffffffc000000000` | 5 | 149.9 | 2989.0 | 1237.5 | 888.2 |
| `cpu` | `cold` | `ep2_send` | `0xfffffff800000000` | 5 | 3626.4 | 27526.9 | 14633.5 | 12586.8 |
| `cpu` | `warm` | `dev` | `0xfe00000000000000` | 5 | 0.0 | 0.0 | 0.0 | 0.0 |
| `cpu` | `warm` | `ep2_recv` | `0xfffffe0000000000` | 5 | 0.2 | 709.0 | 282.2 | 192.7 |
| `cpu` | `warm` | `epoch1` | `0xffffffc000000000` | 5 | 1147.8 | 4408.3 | 2316.1 | 1935.1 |
| `cpu` | `warm` | `ep2_send` | `0xfffffff800000000` | 5 | 584.7 | 43992.3 | 20514.7 | 18670.9 |
| `wgpu` | `cold` | `dev` | `0xfe00000000000000` | 5 | 11.6 | 14.2 | 12.4 | 11.8 |
| `wgpu` | `cold` | `ep2_recv` | `0xfffffe0000000000` | 5 | 29.1 | 78.3 | 56.0 | 60.7 |
| `wgpu` | `cold` | `epoch1` | `0xffffffc000000000` | 5 | 250.1 | 622.0 | 366.5 | 309.8 |
| `wgpu` | `cold` | `ep2_send` | `0xfffffff800000000` | 5 | 669.4 | 3718.1 | 1822.2 | 1542.6 |
| `wgpu` | `warm` | `dev` | `0xfe00000000000000` | 5 | 1.4 | 1.6 | 1.5 | 1.5 |
| `wgpu` | `warm` | `ep2_recv` | `0xfffffe0000000000` | 5 | 20.6 | 65.7 | 40.1 | 31.8 |
| `wgpu` | `warm` | `epoch1` | `0xffffffc000000000` | 5 | 111.2 | 981.3 | 352.9 | 130.5 |
| `wgpu` | `warm` | `ep2_send` | `0xfffffff800000000` | 5 | 78.7 | 5663.0 | 2460.4 | 2486.2 |
| `opencl` | `cold` | `dev` | `0xfe00000000000000` | 5 | 1.3 | 2.1 | 1.5 | 1.4 |
| `opencl` | `cold` | `ep2_recv` | `0xfffffe0000000000` | 5 | 23.4 | 235.2 | 140.3 | 180.0 |
| `opencl` | `cold` | `epoch1` | `0xffffffc000000000` | 5 | 91.5 | 3332.8 | 1624.1 | 1157.3 |
| `opencl` | `cold` | `ep2_send` | `0xfffffff800000000` | 5 | 751.8 | 34160.1 | 13582.6 | 12232.1 |
| `opencl` | `warm` | `dev` | `0xfe00000000000000` | 5 | 0.8 | 1.2 | 0.9 | 0.9 |
| `opencl` | `warm` | `ep2_recv` | `0xfffffe0000000000` | 5 | 117.4 | 423.0 | 234.2 | 152.1 |
| `opencl` | `warm` | `epoch1` | `0xffffffc000000000` | 5 | 3.1 | 3269.7 | 1255.3 | 1090.3 |
| `opencl` | `warm` | `ep2_send` | `0xfffffff800000000` | 5 | 1307.8 | 53309.1 | 17692.6 | 13515.0 |

> Tiers benchmarked: `dev`, `ep2_recv`, `epoch1`, `ep2_send`.
