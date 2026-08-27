#!/usr/bin/env node
// Test fixture standing in for a real `claude` binary — no real Claude call
// involved. Swallows SIGTERM and never exits on its own — used to prove
// the force-termination (SIGKILL) fallback actually fires and works when
// a process doesn't cooperate with the graceful request.
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
