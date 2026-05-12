#!/usr/bin/env node

const { generateWork, WorkType } = require('../index');
const util = require('util');

async function run() {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(`
🚀 nano-rspow-node
GPU-accelerated Nano Proof-of-Work Generator

Usage:
  npx nano-rspow <hash> [--type <send|receive|epoch1|dev>]

Arguments:
  <hash>        The 64-character hexadecimal block root hash.

Options:
  --type <type> The difficulty threshold type. 
                Options: send (default), receive, epoch1, dev.
  --help, -h    Show this help message.

Example:
  npx nano-rspow 718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2
  npx nano-rspow 718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2 --type receive
`);
        process.exit(0);
    }

    const hash = args[0];
    if (hash.length !== 64) {
        console.error(`❌ Error: Hash must be exactly 64 hexadecimal characters.`);
        process.exit(1);
    }

    let typeArg = 'send';
    const typeIndex = args.indexOf('--type');
    if (typeIndex !== -1 && args.length > typeIndex + 1) {
        typeArg = args[typeIndex + 1].toLowerCase();
    }

    let workType;
    switch (typeArg) {
        case 'receive': workType = WorkType.Receive; break;
        case 'epoch1': workType = WorkType.Epoch1; break;
        case 'dev': workType = WorkType.Dev; break;
        case 'send': workType = WorkType.Send; break;
        default:
            console.error(`❌ Error: Unknown threshold type '${typeArg}'.`);
            process.exit(1);
    }

    console.log(`\n⏳ Generating PoW...`);
    console.log(`   Hash:      ${hash}`);
    console.log(`   Threshold: ${typeArg.toUpperCase()}\n`);

    const start = Date.now();
    try {
        const work = await generateWork(hash, workType);
        const elapsed = Date.now() - start;
        
        console.log(`✅ Work Generated Successfully!`);
        console.log(`   Work:      ${work}`);
        console.log(`   Time:      ${(elapsed / 1000).toFixed(3)}s\n`);
    } catch (e) {
        console.error(`❌ Work Generation Failed:`, e.message);
        process.exit(1);
    }
}

run().catch(err => {
    console.error(`❌ Fatal Error:`, err);
    process.exit(1);
});
