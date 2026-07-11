import esbuild from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const isBenchmark = process.argv.includes("--benchmark");
const entryPoint = isBenchmark
  ? "test/performance-benchmark.mjs"
  : "test/performance.test.mjs";
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "2hop-links-test-"));
const outputFile = path.join(
  tempDir,
  isBenchmark ? "performance-benchmark.cjs" : "performance.test.cjs"
);

try {
  await esbuild.build({
    absWorkingDir: projectRoot,
    entryPoints: [entryPoint],
    outfile: outputFile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    sourcemap: "inline",
    plugins: [
      {
        name: "obsidian-test-stub",
        setup(build) {
          build.onResolve({ filter: /^obsidian$/ }, () => ({
            path: path.join(projectRoot, "test/support/obsidian-stub.mjs"),
          }));
        },
      },
    ],
  });

  const args = isBenchmark
    ? [outputFile]
    : ["--test", "--test-concurrency=1", outputFile];
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
