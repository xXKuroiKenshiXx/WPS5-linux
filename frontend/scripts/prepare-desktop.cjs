'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const dependencies = Object.fromEntries(['@xan105/ini', 'crc', 'dbus-next', 'fast-glob', 'xml2js'].map(name => [name, app.dependencies[name]]));
const runtime = { name: app.name, version: app.version, main: 'electron/main.js', private: true,
  description: app.description, author: app.author, homepage: app.homepage, dependencies };
if (process.platform === 'win32') runtime.optionalDependencies = app.optionalDependencies;
const dir = path.join(root, 'desktop');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(runtime, null, 2) + '\n');
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prefix', dir, '--no-audit', '--no-fund'], { stdio: 'inherit', shell: process.platform === 'win32' });