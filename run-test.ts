import { spawn } from "node:child_process";

const searchProcess = spawn("bun", ["run", "service-search/src/server.ts"], {
  stdio: "inherit",
});

const appProcess = spawn("bun", ["run", "app-education/src/server.ts"], {
  stdio: "inherit",
});

function cleanup() {
  try {
    searchProcess.kill("SIGTERM");
  } catch {}
  try {
    appProcess.kill("SIGTERM");
  } catch {}
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

// Tunggu 800ms sampai kedua server listening
setTimeout(() => {
  const testProcess = spawn("bun", ["run", "test-e2e.ts"], {
    stdio: "inherit",
  });

  testProcess.on("exit", (code) => {
    cleanup();
    process.exit(code || 0);
  });
}, 800);
