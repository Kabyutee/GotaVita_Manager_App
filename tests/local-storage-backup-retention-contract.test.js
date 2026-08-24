const fs = require("node:fs");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/modules/backups.js", "utf8");

assert.match(source, /const\s+GV_AUTO_BACKUP_RETENTION\s*=\s*3\s*;/, "Auto-backup retention must remain bounded at 3 full-state copies");
assert.match(source, /function\s+compactAutoBackupRetention\s*\(/, "Storage retention compactor is missing");
assert.match(source, /list\.slice\(-GV_AUTO_BACKUP_RETENTION\)/, "Retention compactor must keep only the newest generated backups");
assert.match(source, /localStorage\.removeItem\(KEYS\.autobackup\)/, "Compactor must release the old generated backup allocation before rewriting");
assert.match(source, /while\s*\(list\.length\s*>\s*GV_AUTO_BACKUP_RETENTION\)\s*list\.shift\(\)/, "Backup creation must enforce the bounded retention policy");
assert.match(source, /setTimeout\(\(\)\s*=>\s*compactAutoBackupRetention\(\),\s*0\)/, "Startup storage GC must be scheduled after deferred initialization");

console.log("LocalStorage backup retention contract: PASS");
console.log(JSON.stringify({ retention: 3, generatedBackupCopies: "bounded", startupGC: true }, null, 2));
