const { generateWork, generateWorkWithThreshold, validateWork, WorkType, getBackendName, workTypeToHex } = require('./index');

async function main() {
    console.log("Testing nano-rspow-node via NAPI-RS bindings...");
    console.log("Active backend:", getBackendName());

    // Official known-good test vector hash from the nano-node core implementation.
    const hash = "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2";
    console.log(`Hash: ${hash}`);

    console.log("\nChecking WorkType -> hex mappings...");
    const expected = {
        [WorkType.Send]: "fffffff800000000",
        [WorkType.Receive]: "fffffe0000000000",
        [WorkType.LegacyEpoch1]: "ffffffc000000000",
        [WorkType.Epoch1]: "ffffffc000000000",
        [WorkType.Dev]: "fe00000000000000",
    };

    for (const wt of Object.values(WorkType)) {
        const hex = workTypeToHex(wt);
        console.log(`[${wt}] threshold: ${hex}`);
        if (hex !== expected[wt]) {
            throw new Error(`Unexpected threshold for ${wt}: got ${hex}, expected ${expected[wt]}`);
        }
        if (!/^[0-9a-f]{16}$/.test(hex)) {
            throw new Error(`Threshold for ${wt} is not lowercase 16-char hex: ${hex}`);
        }
    }

    const start = Date.now();
    console.log(`\nGenerating work for WorkType.Dev...`);
    const workDev = await generateWork(hash, WorkType.Dev);
    console.log(`[Dev] Generated: ${workDev} in ${Date.now() - start}ms`);
    console.log(`[Dev] Valid: ${validateWork(hash, workDev, WorkType.Dev)}`);

    const workCustom = await generateWorkWithThreshold(hash, "fe00000000000000");
    console.log(`[Custom threshold] Generated: ${workCustom}`);
    if (!validateWork(hash, workCustom, WorkType.Dev)) {
        throw new Error("Custom-threshold work failed validation");
    }

    const start2 = Date.now();
    console.log(`\nGenerating work for WorkType.Receive...`);
    const workRecv = await generateWork(hash, WorkType.Receive);
    console.log(`[Receive] Generated: ${workRecv} in ${Date.now() - start2}ms`);
    console.log(`[Receive] Valid: ${validateWork(hash, workRecv, WorkType.Receive)}`);

    // Testing invalid work
    console.log(`\nTesting invalid work...`);
    const isInvalidValid = validateWork(hash, "0000000000000000", WorkType.Receive);
    console.log(`[Invalid Work] Valid: ${isInvalidValid} (Expected: false)`);
}

main().catch(console.error);
