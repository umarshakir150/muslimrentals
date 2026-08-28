#!/usr/bin/env node
// Test fixture standing in for a real `claude` binary — no real Claude call
// involved. Hangs forever until SIGTERM, then exits cleanly and promptly —
// used to prove the graceful-termination path succeeds without ever
// needing to escalate to SIGKILL.
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
