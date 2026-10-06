import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

rmSync("dist", { recursive: true, force: true });
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "--noEmit"], { stdio: "inherit" });

// The SDK is bundled in, so a global install needs no git dependency; npm packages stay external.
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  jsx: "automatic",
  packages: "external",
  alias: { "@checkcourt/sdk": "./node_modules/@checkcourt/sdk/dist/index.js" },
  legalComments: "none",
});
