#!/usr/bin/env node
'use strict';

let config = {
  root: 'example', //Root hugo folder, can be empty
  dataFolder: 'data', //Data folder path (will fetch ALL files from here)
  type: 'article', //Type name [basically layout] (save it under "layouts/NAME/single.html" or themes/THEME/layouts/NAME/single.html). Can be overridden on individual pages by defining "type" under "fields"
  pages: 'articles', //Pages elemenet in your data, in case it's "posts" or "articles" etc.
  contentPath: 'content', //Path to content directory (in case it's not "content")
  hugoPath: '/snap/bin/hugo' //Path to hugo binary (if global, e.g. /snap/bin/hugo)
}
config.root = (!!config.root ? config.root : '.') + '/';

const fs = require('fs');
const fse = require('fs-extra');
const prompts = require('prompts');

const converToObject = (file) => {
  const jsyml = require('js-yaml');
  const filetype = file.split('.').pop();
  const fileContent = fs.readFileSync(config.root + config.dataFolder + '/' + file, 'utf8');
  if (filetype === 'json') return JSON.parse(fileContent);
  if (filetype === 'yml' || filetype === 'yaml') return jsyml.safeLoad(fileContent);
};
const build = async (add, force) => {
  if (typeof add === 'undefined') add = true;
  if (typeof force === 'undefined') force = false;
  if (!config.contentPath || config.contentPath === '/') return console.log('Error: config.contentPath cannot be \'\' or \'/\')!');
  let dataFiles;
  try {
    dataFiles = fs.readdirSync(config.root + config.dataFolder);
  } catch (e) {
    return console.log('e', e);
  }
  if (dataFiles.length < 1) return console.log('No data files');
  for (let i in dataFiles) {
    let data = converToObject(dataFiles[i]);
    let pages = data[config.pages];
    for (let j in pages) {
      if (!pages[j].path) return console.log('Error: Pages must include path!');
      if (!pages[j].fields) return console.log('Error: Pages must include fields!');
      if (!pages[j].fields.type) pages[j].fields.type = config.type;
      
      const pagePath = config.root + config.contentPath + '/' + pages[j].path;
      if (add) {
        fse.ensureDirSync(pagePath);
        fs.writeFileSync(pagePath + '/index.md', JSON.stringify(pages[j].fields) + '\n');
        console.log('Created file: ' + pagePath + '/index.md');
      } else if (fs.existsSync(pagePath)) {
        let response;
        if (!force) {
          response = await prompts({
            type: 'confirm',
            name: 'value',
            message: 'Delete ' + pagePath + ' ?'
          });
        }
 
        if (force || response.value) {
          fse.removeSync(pagePath);
          console.log('Removed folder: ' + pagePath);
        }
      }
    }
  }

};
const main = async (mode, force) => {
  force = (force === '-f' || force === '--force') ? true : false;
  const { execSync } = require('child_process');
  if (mode === 'server') {
    //server mode - create data-generated files, run hugo server, remove data-generated files on stop
    console.log('Building data-generated files...');
    await build();
    console.log('Running Hugo Server...');
    process.on('SIGINT', () => {}); //Not exiting on ctrl+c (instead, going to "catch" clause)
    try {
      await execSync('(cd ' + config.root + ' && ' + config.hugoPath + ' server)');
    } catch (e) {
      console.log('Removing data-generated files...');
      await build(false, force);
    }
  } else if (mode === 'clean') {
    //clean - just remove data-generated files
    console.log('Removing data-generated files...');
    await build(false, force);
  } else {
    //default behavior - create data-generated files, run hugo build, remove data-generated files
    console.log('Building data-generated files...');
    await build();
    console.log('Running Hugo (build)...');
    await execSync('(cd ' + config.root + ' && ' + config.hugoPath + ')');
    console.log('Removing data-generated files...');
    await build(false, force);
  }

  console.log('Done!');
};

const args = process.argv.slice(2);

//in case no arguments but force flag is there
if (!!args[0] && args[0].search('-') === 0) args.unshift(undefined);
main(...args);