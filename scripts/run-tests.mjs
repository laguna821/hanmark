import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";

const testFiles = (await readdir("tests", { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
  .map((entry) => `tests/${entry.name}`)
  .sort();

if (testFiles.length === 0) {
  throw new Error("No TypeScript test files were found in tests/.");
}

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", ...testFiles],
  { stdio: "inherit" },
);

child.on("error", (error) => {
  throw error;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
