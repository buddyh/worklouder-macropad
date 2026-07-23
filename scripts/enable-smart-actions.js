#!/usr/bin/env node
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const asarPath = process.env.INPUT_ASAR || '/Applications/input.app/Contents/Resources/app.asar';
const inputApp = process.env.INPUT_APP || path.resolve(asarPath, '../../..');
const knownInputVersions = new Set(['0.17.2']);
const disabledGate = 'static isSmartActionEnabled(e) {\n      return false;\n    }';
const enabledGate = 'static isSmartActionEnabled(e) {\n      return true; \n    }';

function parseAsar(fd) {
  const header = Buffer.alloc(16);
  fs.readSync(fd, header, 0, header.length, 0);
  const size = header.readUInt32LE(12);
  const bytes = Buffer.alloc(size);
  fs.readSync(fd, bytes, 0, size, 16);
  return { tree: JSON.parse(bytes.toString('utf8')), dataStart: 16 + size };
}

function entries(node, path = '') {
  if (!node.files) return [];
  return Object.entries(node.files).flatMap(([name, child]) => {
    const childPath = `${path}/${name}`;
    return child.files ? entries(child, childPath) : [{ path: childPath, node: child }];
  });
}

function findGates(fd, tree, dataStart) {
  const results = [];
  for (const entry of entries(tree).filter(({ path, node }) => path.endsWith('.js') && node.offset != null && node.size != null)) {
    const bytes = Buffer.alloc(Number(entry.node.size));
    fs.readSync(fd, bytes, 0, bytes.length, dataStart + Number(entry.node.offset));
    const source = bytes.toString('utf8');
    const disabledMatches = source.split(disabledGate).length - 1;
    const enabledMatches = source.split(enabledGate).length - 1;
    if (disabledMatches || enabledMatches) {
      results.push({entry, bytes, source, disabledMatches, enabledMatches, dataStart});
    }
  }
  return results;
}

function backupPath() {
  if (process.env.INPUT_ASAR_BACKUP) return process.env.INPUT_ASAR_BACKUP;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(asarPath)).digest('hex').slice(0, 12);
  return path.join(
    os.homedir(),
    'Library/Application Support/worklouder-macropad/backups',
    `input-app-${hash}.asar`,
  );
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function inputVersion() {
  try {
    return childProcess.execFileSync('/usr/bin/plutil', [
      '-extract',
      'CFBundleShortVersionString',
      'raw',
      path.join(inputApp, 'Contents/Info.plist'),
    ], {encoding: 'utf8'}).trim();
  } catch {
    return null;
  }
}

function signatureStatus() {
  try {
    childProcess.execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', inputApp], {
      stdio: 'ignore',
    });
    return 'valid';
  } catch {
    return 'invalid-or-unsigned';
  }
}

function inputIsRunning() {
  try {
    childProcess.execFileSync('/usr/bin/pgrep', ['-x', 'input'], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
}

function main() {
  const command = process.argv[2] || '--status';
  if (command === '--restore') {
    if (inputIsRunning()) throw new Error('Quit Input before restoring app.asar');
    const backup = process.argv[3];
    if (!backup || !fs.existsSync(backup)) throw new Error('Usage: --restore /path/to/backup.asar');
    fs.copyFileSync(backup, asarPath);
    if (sha256(backup) !== sha256(asarPath)) throw new Error('Restored ASAR checksum mismatch');
    console.log(JSON.stringify({
      restored: asarPath,
      from: backup,
      checksumVerified: true,
      signature: signatureStatus(),
    }));
    return;
  }
  const version = inputVersion();
  const fd = fs.openSync(asarPath, command === '--enable' ? 'r+' : 'r');
  try {
    const { tree, dataStart } = parseAsar(fd);
    const gates = findGates(fd, tree, dataStart);
    const disabledCount = gates.reduce((sum, gate) => sum + gate.disabledMatches, 0);
    const enabledCount = gates.reduce((sum, gate) => sum + gate.enabledMatches, 0);
    if (disabledCount === 0 && enabledCount === 0) {
      if (command === '--status') {
        console.log(JSON.stringify({
          status: 'unknown',
          enabled: null,
          inputVersion: version,
          signature: signatureStatus(),
          reason: 'known Smart Actions gate not found; this Input build is not safe to patch',
        }));
        process.exitCode = 2;
        return;
      }
      throw new Error('Smart Actions gate not found; refusing to patch this Input build');
    }
    if (disabledCount + enabledCount !== 1 || gates.length !== 1) {
      throw new Error(`Expected one Smart Actions gate, found ${disabledCount + enabledCount}`);
    }
    const gate = gates[0];
    if (command === '--status') {
      console.log(JSON.stringify({
        status: enabledCount === 1 ? 'enabled' : 'disabled',
        enabled: enabledCount === 1,
        inputVersion: version,
        testedVersion: knownInputVersions.has(version),
        signature: signatureStatus(),
        asset: gate.entry.path,
      }));
      return;
    }
    if (command !== '--enable') throw new Error('Usage: --status | --enable | --restore BACKUP');
    if (enabledCount === 1) {
      console.log(JSON.stringify({
        status: 'enabled',
        enabled: true,
        inputVersion: version,
        signature: signatureStatus(),
        asset: gate.entry.path,
        changed: false,
      }));
      return;
    }
    if (!knownInputVersions.has(version) && !process.argv.includes('--allow-unsupported-version')) {
      throw new Error(
        `Input ${version ?? 'unknown'} is not a tested patch target; refusing. `
        + 'Use --allow-unsupported-version only after independently validating the gate.',
      );
    }
    if (inputIsRunning()) throw new Error('Quit Input before enabling the Smart Actions editor');
    const backup = backupPath();
    fs.mkdirSync(path.dirname(backup), {recursive: true, mode: 0o700});
    fs.chmodSync(path.dirname(backup), 0o700);
    if (!fs.existsSync(backup)) {
      fs.copyFileSync(asarPath, backup);
      fs.chmodSync(backup, 0o600);
    }
    const originalChecksum = sha256(asarPath);
    if (sha256(backup) !== originalChecksum) throw new Error('Backup checksum mismatch; refusing to patch');
    const patched = Buffer.from(gate.source.replace(disabledGate, enabledGate));
    if (patched.length !== gate.bytes.length) throw new Error('Patch changes asset length');
    fs.writeSync(fd, patched, 0, patched.length, gate.dataStart + Number(gate.entry.node.offset));
    fs.fsyncSync(fd);
    const verification = findGates(fd, tree, dataStart);
    const verifiedEnabled = verification.reduce((sum, item) => sum + item.enabledMatches, 0);
    if (verifiedEnabled !== 1) throw new Error('Post-patch Smart Actions gate verification failed');
    console.log(JSON.stringify({
      status: 'enabled',
      enabled: true,
      inputVersion: version,
      changed: true,
      asset: gate.entry.path,
      backup,
      backupChecksum: originalChecksum,
      warning: 'Patching app.asar invalidates the Input app code signature; restore or reinstall Input to recover.',
    }));
  } finally {
    fs.closeSync(fd);
  }
}

try { main(); } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
