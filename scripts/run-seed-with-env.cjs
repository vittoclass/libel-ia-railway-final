#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { execSync } = require("child_process");

const envPath = ".env.local";
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^"|"$/g, "");
    if (key) process.env[key] = value;
  }
}

execSync("node scripts/seed-pedagogical-parameters.cjs", {
  stdio: "inherit",
  env: process.env,
});
