// Phase 4 remains the cross-device compatibility gate, but the runtime scenario
// is now owned by the canonical v2 simulation so two divergent test harnesses
// cannot disagree about the synchronization contract.
require("./canonical-sync-v2-simulation.test.js");
