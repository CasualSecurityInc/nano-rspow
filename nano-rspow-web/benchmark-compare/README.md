# Browser PoW comparison

This throwaway page compares one Epoch 2 send-work search from `nano-rspow-web` and Zosoled's `nano-pow` for the same randomly generated work root. It imports the checked-in NanoPow competitor fixture rather than an unpinned CDN dependency.

The comparison directory contains the generated WASM/JS assets it imports, so
serve this directory itself over HTTP; opening the file directly will not
reliably load the WASM module:

```bash
cd nano-rspow-web
cd benchmark-compare
python3 -m http.server 8080
```

Open `http://localhost:8080/benchmark-compare/`.

Each solver can run once per paired round. The page serializes all work and preserves each raw duration; it does not report a misleading average.

The **Start ping-pong battle** control runs 42 individual searches, alternating
between nano-rspow and NanoPow with a 100 ms cool-down between searches. Each
work value is eight bytes whereas the next input root must be 32 bytes, so the
page uses the exact returned nonce repeated four times as the next root. The
scatter plot and summaries update after every search. **Stop!** prevents the
next search after the in-flight solver finishes; neither browser implementation
currently exposes cancellation for a running search.
