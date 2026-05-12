const { generateWork, validateWork, WorkType } = require('./index');

async function main() {
    console.log("Testing nano-rspow-node via NAPI-RS bindings...");
    
    // Official known-good test vector hash from the nano-node core implementation.
    const hash = "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2";
    console.log(`Hash: ${hash}`);
    
    const start = Date.now();
    console.log(`Generating work for WorkType.Dev...`);
    const workDev = await generateWork(hash, WorkType.Dev);
    console.log(`[Dev] Generated: ${workDev} in ${Date.now() - start}ms`);
    console.log(`[Dev] Valid: ${validateWork(hash, workDev, WorkType.Dev)}`);

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
