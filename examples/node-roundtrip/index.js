const { generateWorkWithThreshold, validateWorkWithThreshold } = require('nano-rspow-node');

async function main() {
    console.log("Testing Node roundtrip consuming nano-rspow-node from NPM...");

    // Official known-good test vector hash from the nano-node core implementation.
    const hash = "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2";
    console.log(`Hash: ${hash}`);

    const start = Date.now();
    const threshold = "fe00000000000000";
    console.log(`Generating work at a custom testing threshold...`);
    const workDev = await generateWorkWithThreshold(hash, threshold);
    const duration = Date.now() - start;

    console.log(`[Dev] Generated: ${workDev} in ${duration}ms`);
    
    const isValid = validateWorkWithThreshold(hash, workDev, threshold);
    console.log(`[Dev] Valid: ${isValid}`);
    
    if (!isValid) {
        throw new Error("Generated work is invalid!");
    }
    
    console.log("Success! Node roundtrip test passed!");
}

main().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
