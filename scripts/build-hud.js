#!/usr/bin/env node

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function run(command, args) {
  const result = childProcess.spawnSync(command, args, {encoding: 'utf8'});
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} exited ${result.status}`);
  }
  return result.stdout.trim();
}

function main() {
  if (process.platform !== 'darwin') throw new Error('The Work Louder HUD requires macOS');
  const args = parseArgs(process.argv.slice(2));
  const source = path.join(__dirname, 'WorkLouderHUD.swift');
  const output = path.resolve(args.output || path.join(
    os.homedir(),
    'Library/Application Support/worklouder-macropad/bin/worklouder-hud',
  ));
  const compiler = run('/usr/bin/xcrun', ['--find', 'swiftc']);
  const sdk = run('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path']);
  const architecture = run('/usr/bin/uname', ['-m']);
  const target = `${architecture}-apple-macosx13.0`;
  fs.mkdirSync(path.dirname(output), {recursive: true, mode: 0o700});
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    run(compiler, [
      '-sdk',
      sdk,
      '-target',
      target,
      '-O',
      source,
      '-o',
      temporary,
    ]);
    fs.chmodSync(temporary, 0o755);
    fs.renameSync(temporary, output);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  console.log(JSON.stringify({
    built: output,
    source,
    target,
    mode: 'one-shot native HUD',
  }));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
