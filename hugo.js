#!/usr/bin/env node
'use strict';

let config = {
  root: 'example', //Root hugo folder, can be empty
  dataFolder: 'data', //Data folder path (will fetch ALL json/yaml/toml files from here)
  type: 'article', //Type name [basically layout] (save it under "layouts/NAME/single.html" or themes/THEME/layouts/NAME/single.html). Can be overridden on individual pages by defining "type" under "fields"
  pages: 'articles', //Pages elemenet in your data, in case it's "posts" or "articles" etc.
  contentPath: 'content', //Path to content directory (in case it's not "content")
  hugoPath: 'hugo' //Path to hugo binary (if it's not on your PATH, e.g. /snap/bin/hugo)
}

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fse = require('fs-extra');
const prompts = require('prompts');

const manifestName = '.hugo-data-to-pages.json'; //Lists what this script generated, so cleanup never removes anything else
const dataTypes = ['.json', '.yml', '.yaml', '.toml'];

const isDataFile = (file) => {
  if (!dataTypes.includes(path.extname(file).toLowerCase())) return false;
  return fs.statSync(config.root + config.dataFolder + '/' + file).isFile();
};
const converToObject = (file) => {
  const jsyml = require('js-yaml');
  const jstml = require('toml');
  const filetype = path.extname(file).toLowerCase();
  const fileContent = fs.readFileSync(config.root + config.dataFolder + '/' + file, 'utf8');
  try {
    if (filetype === '.json') return JSON.parse(fileContent);
    if (filetype === '.yml' || filetype === '.yaml') return jsyml.safeLoad(fileContent);
    if (filetype === '.toml') return jstml.parse(fileContent);
  } catch (e) {
    throw new Error('Could not parse ' + file + ': ' + e.message);
  }
};
const getContentPath = () => {
  if (!config.contentPath || config.contentPath === '/') throw new Error('config.contentPath cannot be \'\' or \'/\'!');
  return path.join(config.root, config.contentPath);
};
const isInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const hash = (content) => crypto.createHash('sha1').update(content).digest('hex');
//A generated folder is only ours as long as it holds nothing but the index.md we wrote
const isUnchanged = (pagePath, contentHash) => {
  try {
    const files = fs.readdirSync(pagePath);
    return files.length === 1 && files[0] === 'index.md' && hash(fs.readFileSync(pagePath + '/index.md')) === contentHash;
  } catch (e) {
    return false;
  }
};
const isEmptyFolder = (folder) => {
  try {
    return fs.readdirSync(folder).length < 1;
  } catch (e) {
    return false;
  }
};
//Manifest: "pages" (generated folder -> hash of its index.md) and "folders" (parent folders created along the way)
const readManifest = () => {
  const manifestPath = path.join(config.root, manifestName);
  const manifest = { pages: {}, folders: [] };
  if (!fs.existsSync(manifestPath)) return manifest;
  try {
    const stored = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const pagePath in stored.pages) manifest.pages[path.join(config.root, pagePath)] = stored.pages[pagePath];
    manifest.folders = stored.folders.map((folder) => path.join(config.root, folder));
  } catch (e) {
    throw new Error('Could not read ' + manifestPath + ' (' + e.message + '). Remove it, along with any generated folders that are still around.');
  }
  return manifest;
};
const writeManifest = (manifest) => {
  const manifestPath = path.join(config.root, manifestName);
  if (Object.keys(manifest.pages).length < 1 && manifest.folders.length < 1) return fse.removeSync(manifestPath);
  const stored = { pages: {}, folders: manifest.folders.map((folder) => path.relative(config.root, folder)) };
  for (const pagePath in manifest.pages) stored.pages[path.relative(config.root, pagePath)] = manifest.pages[pagePath];
  fs.writeFileSync(manifestPath + '.tmp', JSON.stringify(stored, null, 2) + '\n');
  fs.renameSync(manifestPath + '.tmp', manifestPath);
};
//Reads all data files and validates every page before anything is written
const collectPages = () => {
  const contentPath = getContentPath();
  let dataFiles;
  try {
    dataFiles = fs.readdirSync(config.root + config.dataFolder).filter(isDataFile);
  } catch (e) {
    throw new Error('Could not read data folder: ' + e.message);
  }
  if (dataFiles.length < 1) console.log('No data files');
  const pages = [];
  const errors = [];
  const seen = new Map(); //pagePath -> where it was defined
  for (const file of dataFiles) {
    const data = converToObject(file);
    const filePages = config.pages ? (data || {})[config.pages] : data;
    if (!filePages || typeof filePages !== 'object') continue; //Data file without pages
    for (const key of Object.keys(filePages)) {
      const page = filePages[key];
      const where = file + ' [' + key + ']';
      if (!page || page.path === '' || !['string', 'number'].includes(typeof page.path)) { errors.push(where + ': Pages must include path!'); continue; }
      if (!page.fields || typeof page.fields !== 'object' || Array.isArray(page.fields)) { errors.push(where + ': Pages must include fields!'); continue; }

      const relativePath = path.relative(contentPath, path.join(contentPath, String(page.path)));
      const pagePath = path.join(contentPath, relativePath);
      if (!isInside(contentPath, pagePath)) { errors.push(where + ': path "' + page.path + '" is not inside ' + contentPath + '!'); continue; }
      if (seen.has(pagePath)) { errors.push(where + ': path "' + page.path + '" is already used by ' + seen.get(pagePath) + '!'); continue; }
      seen.set(pagePath, where);

      const fields = Object.assign({}, page.fields);
      if (!fields.type) fields.type = config.type;
      pages.push({ pagePath: pagePath, fields: fields, where: where });
    }
  }
  //Hugo does not build a page that sits inside another page's folder
  for (const page of pages) {
    for (let parent = path.dirname(page.pagePath); isInside(contentPath, parent); parent = path.dirname(parent)) {
      if (seen.has(parent)) errors.push(page.where + ': ' + page.pagePath + ' is inside the page of ' + seen.get(parent) + '!');
    }
  }
  if (errors.length) throw new Error('Invalid pages, nothing was generated:\n  ' + errors.join('\n  '));
  return pages;
};
const generate = () => {
  const contentPath = getContentPath();
  const pages = collectPages();
  const manifest = readManifest();
  const conflicts = pages.filter((page) => fs.existsSync(page.pagePath) && !isUnchanged(page.pagePath, manifest.pages[page.pagePath]));
  if (conflicts.length) {
    throw new Error('These folders already exist and are not (or no longer) the ones this script generated, nothing was generated:\n  ' + conflicts.map((page) => page.pagePath).join('\n  '));
  }
  try {
    for (const page of pages) {
      const created = []; //Folders that don't exist yet, top one first
      for (let folder = page.pagePath; isInside(contentPath, folder) && !fs.existsSync(folder); folder = path.dirname(folder)) created.unshift(folder);
      const content = JSON.stringify(page.fields) + '\n';
      try {
        fse.ensureDirSync(page.pagePath);
        fs.writeFileSync(page.pagePath + '/index.md', content);
      } catch (e) {
        try { if (created.length) fse.removeSync(created[0]); } catch (ignored) {}
        throw e;
      }
      //Only recording what was actually created
      manifest.pages[page.pagePath] = hash(content);
      for (const folder of created.slice(0, -1)) {
        if (!manifest.folders.includes(folder)) manifest.folders.push(folder);
      }
      console.log('Created file: ' + page.pagePath + '/index.md');
    }
  } finally {
    writeManifest(manifest);
  }
};
const clean = async (force) => {
  const contentPath = getContentPath();
  const manifest = readManifest();
  const remaining = { pages: {}, folders: [] };
  for (const pagePath in manifest.pages) {
    if (!fs.existsSync(pagePath)) continue;
    if (!isInside(contentPath, pagePath)) {
      console.log('Skipping ' + pagePath + ' (not inside ' + contentPath + ')');
      remaining.pages[pagePath] = manifest.pages[pagePath];
      continue;
    }
    if (!isUnchanged(pagePath, manifest.pages[pagePath])) {
      console.log('Leaving ' + pagePath + ' (changed since it was generated)');
      continue;
    }
    let response;
    if (!force && !process.stdin.isTTY) {
      console.log('Keeping ' + pagePath + ' (no terminal to confirm on, use --force)');
      response = { value: false };
    } else if (!force) {
      response = await prompts({
        type: 'confirm',
        name: 'value',
        message: 'Delete ' + pagePath + ' ?'
      });
    }

    if (force || response.value) {
      fse.removeSync(pagePath);
      console.log('Removed folder: ' + pagePath);
    } else {
      remaining.pages[pagePath] = manifest.pages[pagePath];
    }
  }
  //Removing the parent folders we created (deepest first), as long as nothing else is in them
  for (const folder of manifest.folders.slice().sort((a, b) => b.length - a.length)) {
    if (!isInside(contentPath, folder)) continue;
    if (isEmptyFolder(folder)) {
      fs.rmdirSync(folder);
      console.log('Removed folder: ' + folder);
    } else if (Object.keys(remaining.pages).some((pagePath) => isInside(folder, pagePath))) {
      remaining.folders.push(folder);
    }
  }
  writeManifest(remaining);
};
const readConfigFile = (file) => {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (e) {
    throw new Error('Could not read config file ' + file + ': ' + e.message);
  }
};
const main = async (argvs) => {
  const mode = typeof argvs._[0] === 'undefined' ? 'default' : argvs._[0];
  const force = !!argvs['force'];
  const configFile = typeof argvs['configFile'] === 'undefined' ? false : readConfigFile(argvs['configFile']);
  Object.assign(config, configFile); //overriding default settings
  config.root = (!!config.root ? config.root : '.') + '/';
  const { execSync } = require('child_process');
  if (mode === 'server') {
    //server mode - create data-generated files, run hugo server, remove data-generated files on stop
    console.log('Building data-generated files...');
    generate();
    console.log('Running Hugo Server...');
    process.on('SIGINT', () => {}); //Not exiting on ctrl+c (instead, going to "catch" clause)
    try {
      await execSync('(cd ' + config.root + ' && ' + config.hugoPath + ' server)');
    } catch (e) {
      console.log('Removing data-generated files...');
      await clean(force);
    }
  } else if (mode === 'generate') {
    //generate - just create data-generated files (no hugo running, and no removal)
    console.log('Building data-generated files...');
    generate();
  } else if (mode === 'clean') {
    //clean - just remove data-generated files
    console.log('Removing data-generated files...');
    await clean(force);
  } else {
    //default behavior - create data-generated files, run hugo build, remove data-generated files (even if something fails)
    try {
      console.log('Building data-generated files...');
      generate();
      console.log('Running Hugo (build)...');
      await execSync('(cd ' + config.root + ' && ' + config.hugoPath + ')');
    } catch (e) {
      process.exitCode = 1; //Set right away, in case the cleanup doesn't get to finish
      throw e;
    } finally {
      console.log('Removing data-generated files...');
      await clean(force);
    }
  }

  console.log('Done!');
};

// Defining commands and flags
const argvs = require('yargs')
  .command('$0', 'Generate folders/files from data, then run `hugo build`')
  .command('generate', 'Generate folders/files from data (does not run hugo build)')
  .command('server', 'Generate folders/files from data, run `hugo server`, then cleanup on exit')
  .command('clean', 'Trigger cleanup manually')
  .option('force', {
    alias: 'f',
    type: 'boolean',
    default: false,
    description: 'Use this flag to skip folder removal prompts (be careful with this one!)'
  })
  .option('configFile', {
    alias: 'c',
    description: 'Optionally use an external config file (JSON format only)'
  })
  .argv;

main(argvs).catch((e) => {
  console.error('Error: ' + e.message);
  process.exitCode = 1;
});
