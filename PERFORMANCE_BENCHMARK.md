## nano-rspow Benchmark Results

These anecdotal results were run on a MacBook Air M1 on branch `feat/cpu-pre-spun-pool`:

```
$ time cargo run --all-features --release benchmark --format markdown --backend all
```

| Backend | Mode | Tier | Threshold | Samples | Min (ms) | Max (ms) | Mean (ms) | Median (ms) |
|---------|------|------|-----------|--------:|---------:|---------:|----------:|------------:|
| `cpu` | `cold` | `dev` | `0xfe00000000000000` | 5 | 0.1 | 0.5 | 0.2 | 0.1 |
| `cpu` | `cold` | `ep2_recv` | `0xfffffe0000000000` | 5 | 5.4 | 285.7 | 103.4 | 72.9 |
| `cpu` | `cold` | `legacy_epoch1` | `0xffffffc000000000` | 5 | 329.1 | 5415.6 | 2095.7 | 1547.8 |
| `cpu` | `cold` | `ep2_send` | `0xfffffff800000000` | 5 | 2782.2 | 21942.2 | 14559.5 | 14473.9 |
| `cpu` | `warm` | `dev` | `0xfe00000000000000` | 5 | 0.0 | 0.1 | 0.0 | 0.0 |
| `cpu` | `warm` | `ep2_recv` | `0xfffffe0000000000` | 5 | 11.3 | 1506.6 | 506.7 | 457.2 |
| `cpu` | `warm` | `legacy_epoch1` | `0xffffffc000000000` | 5 | 1179.4 | 6901.0 | 2856.6 | 2072.8 |
| `cpu` | `warm` | `ep2_send` | `0xfffffff800000000` | 5 | 135.7 | 23303.8 | 13169.3 | 15152.1 |
| `wgpu` | `cold` | `dev` | `0xfe00000000000000` | 5 | 10.8 | 13.9 | 12.3 | 12.2 |
| `wgpu` | `cold` | `ep2_recv` | `0xfffffe0000000000` | 5 | 23.2 | 102.3 | 66.4 | 65.4 |
| `wgpu` | `cold` | `legacy_epoch1` | `0xffffffc000000000` | 5 | 87.3 | 699.3 | 356.5 | 202.8 |
| `wgpu` | `cold` | `ep2_send` | `0xfffffff800000000` | 5 | 1026.4 | 5753.3 | 2899.4 | 2514.9 |
| `wgpu` | `warm` | `dev` | `0xfe00000000000000` | 5 | 1.8 | 2.2 | 2.0 | 1.9 |
| `wgpu` | `warm` | `ep2_recv` | `0xfffffe0000000000` | 5 | 30.6 | 104.6 | 77.9 | 92.0 |
| `wgpu` | `warm` | `legacy_epoch1` | `0xffffffc000000000` | 5 | 130.1 | 969.7 | 381.3 | 215.9 |
| `wgpu` | `warm` | `ep2_send` | `0xfffffff800000000` | 5 | 118.2 | 7862.6 | 1870.7 | 545.2 |
| `opencl` | `cold` | `dev` | `0xfe00000000000000` | 5 | 1.6 | 6.0 | 3.8 | 3.5 |
| `opencl` | `cold` | `ep2_recv` | `0xfffffe0000000000` | 5 | 3.2 | 376.9 | 124.2 | 75.7 |
| `opencl` | `cold` | `legacy_epoch1` | `0xffffffc000000000` | 5 | 221.8 | 2197.5 | 886.7 | 596.9 |
| `opencl` | `cold` | `ep2_send` | `0xfffffff800000000` | 5 | 7542.4 | 30437.5 | 15495.3 | 11945.3 |
| `opencl` | `warm` | `dev` | `0xfe00000000000000` | 5 | 0.9 | 0.9 | 0.9 | 0.9 |
| `opencl` | `warm` | `ep2_recv` | `0xfffffe0000000000` | 5 | 5.9 | 392.2 | 119.1 | 72.1 |
| `opencl` | `warm` | `legacy_epoch1` | `0xffffffc000000000` | 5 | 156.9 | 3383.3 | 1410.6 | 645.6 |
| `opencl` | `warm` | `ep2_send` | `0xfffffff800000000` | 5 | 8.8 | 42345.9 | 16316.5 | 14321.7 |

> Tiers benchmarked: `dev`, `ep2_recv`, `legacy_epoch1`, `ep2_send`.
