import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";

const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

rmSync("dist", { recursive: true, force: true });
execFileSync(process.execPath, [tsc], { stdio: "inherit" });
