const { generateWork, generateWorkWithThreshold, validateWork, validateWorkWithThreshold, WorkType, LegacyWorkType, TestingWorkType, getBackendName, workTypeToHex, legacyWorkTypeToHex, testingWorkTypeToHex } = require('./index');

async function main() {
    console.log("Testing nano-rspow-node via NAPI-RS bindings...");
    console.log("Active backend:", getBackendName());

    // Official known-good test vector hash from the nano-node core implementation.
    const hash = "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2";
    console.log(`Hash: ${hash}`);

    console.log("\nChecking WorkType -> hex mappings...");
    const expected = {
        [WorkType.Send]: "fffffff800000000",
        [WorkType.Receive]: "fffffe0000000000"
    };

    if ("LegacyEpoch1" in WorkType || "Dev" in WorkType) {
        throw new Error("WorkType must expose current mainnet presets only");
    }

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

    const devThreshold = testingWorkTypeToHex(TestingWorkType.Dev);
    const legacyThreshold = legacyWorkTypeToHex(LegacyWorkType.Epoch1);
    if (legacyThreshold !== "ffffffc000000000") {
        throw new Error(`Unexpected legacy threshold: ${legacyThreshold}`);
    }

    const workCustom = await generateWorkWithThreshold(hash, devThreshold);
    console.log(`[Custom threshold] Generated: ${workCustom}`);
    if (!validateWorkWithThreshold(hash, workCustom, devThreshold)) {
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
