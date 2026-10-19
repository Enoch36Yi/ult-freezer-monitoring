#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let outputPath = null;
const artifactPaths = [];

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--output") {
    outputPath = args[++i];
    if (!outputPath) throw new Error("--output needs a path");
  } else if (args[i].startsWith("--")) {
    throw new Error(`Unknown option: ${args[i]}`);
  } else {
    artifactPaths.push(args[i]);
  }
}

if (artifactPaths.length === 0) {
  throw new Error("Usage: node scripts/create-release-manifest.mjs [--output FILE] IMAGE [IMAGE ...]");
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function sourceState() {
  try {
    const git = (...args) => execFileSync("git", args, {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    const paths = [...new Set(git("ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0"))]
      .filter((name) => /^(firmware|web|scripts|cad_enclosure)\//.test(name) &&
        /\.(?:h|c|cpp|py|ps1|psm1|mjs|ts|tsx|mts|css|json|ini|defaults)$/.test(name) &&
        !/(?:^|\/)(?:node_modules|\.pio|\.next|exports|revision_[^/]+)\//.test(name) &&
        !/(?:^|\/)(?:device_security|prototype22_wifi)\.h$/.test(name) &&
        !name.endsWith("tsconfig.tsbuildinfo"))
      .sort();
    const files = paths.map((name) => ({ name,
      sha256: createHash("sha256").update(readFileSync(resolve(repoRoot, name))).digest("hex") }));
    return {
      git_dirty: git("status", "--porcelain=v1", "--untracked-files=normal").trim().length > 0,
      source_sha256: createHash("sha256").update(files.map((item) => `${item.name}\0${item.sha256}\n`).join("")).digest("hex"),
      source_files: files,
    };
  } catch {
    return { git_dirty: null, source_sha256: null, source_files: [] };
  }
}

function firmwareDefaults() {
  try {
    const config = readFileSync(resolve(repoRoot, "firmware/include/config.h"), "utf8");
    const value = (name) => config.match(new RegExp(`^#define\\s+${name}\\s+\"([^\"]+)\"`, "m"))?.[1] ?? null;
    return { firmware_version: value("FIRMWARE_VERSION"), sensor_tier: value("SENSOR_TIER") };
  } catch { return null; }
}

function artifactName(filePath) {
  const absolute = resolve(filePath);
  const repoRelative = relative(repoRoot, absolute);
  if (repoRelative && !repoRelative.startsWith(`..${sep}`) && repoRelative !== "..") {
    return repoRelative.split(sep).join("/");
  }
  // Staged builds commonly live outside the checkout. Keep the manifest
  // portable and avoid recording a user's absolute path.
  return `${basename(dirname(absolute))}/${basename(absolute)}`;
}

const artifacts = artifactPaths.map((filePath) => {
  const absolute = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  const bytes = readFileSync(absolute);
  return {
    name: artifactName(filePath),
    bytes: statSync(absolute).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
});

const manifest = {
  manifest_version: 2,
  created_at_utc: new Date().toISOString(),
  git_commit: gitCommit(),
  ...sourceState(),
  firmware_defaults: firmwareDefaults(),
  node_version: process.version,
  limitations: [
    "Source fingerprint covers Git-visible build source/config under firmware, web, scripts and cad_enclosure; generated CAD and private headers are excluded.",
    "Artifact hashes identify exact local bytes, not a reproducible-build proof or evidence of flashing/deployment. Private configuration is intentionally not fingerprinted.",
  ],
  artifacts,
};
const json = `${JSON.stringify(manifest, null, 2)}\n`;

if (outputPath) {
  const absoluteOutput = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  writeFileSync(absoluteOutput, json, { encoding: "utf8", flag: "wx" });
  console.log(`Wrote release manifest: ${absoluteOutput}`);
} else {
  process.stdout.write(json);
}
