'use strict';

const bless = require('bless');
const webpackSources = require('webpack-sources');

const RawSource = webpackSources.RawSource;
const SourceMapSource = webpackSources.SourceMapSource;
const CSS_REGEXP = /\.css$/;
const CleanCSS = require('clean-css');

function createBlessedFileName(filenameWithoutExtension, index) {
  return index === 0 ? `${filenameWithoutExtension}.css` : `${filenameWithoutExtension}-blessed${index}.css`;
}

/**
 * Inject @import rules into a .css file for all others
 */
function addImports(parsedData, filenameWithoutExtension) {
  const lastChunk = parsedData.data.pop();
  parsedData.data = [lastChunk].concat(parsedData.data);

  const sourceToInjectIndex = 0;
  let addImports = '';

  parsedData.data.map((fileContents, index) => { // eslint-disable-line max-nested-callbacks
    if (index !== sourceToInjectIndex) {
      const filename = createBlessedFileName(filenameWithoutExtension, index);
      // E.g. @import url(app-blessed1.css);
      addImports += `@import url(${filename.replace(/.*\//, '')});\n`;
    }
    return fileContents;
  });

  parsedData.data[sourceToInjectIndex] = `${addImports}\n${parsedData.data[sourceToInjectIndex]}`;

  return parsedData;
}

function minimize(parsedData) {
  parsedData.data = parsedData.data.map((cssString) => {
    return new CleanCSS({inline: false}).minify(cssString).styles;
  });
  return parsedData;
}

class BlessCSSWebpackPlugin {

  constructor(options) {
    options = options || {
      sourceMap: false,
      addImports: false
    };
    this.options = options;
  }

  apply(compiler) {
    compiler.plugin('compilation', compilation => {
      compilation.plugin('optimize-chunk-assets', (chunks, callback) => {
        chunks.forEach(chunk => {
          chunk.files
            .filter(filename => filename.match(CSS_REGEXP))
            .filter(filename => {
              if (this.options.files) {
                return this.options.files.some(file => {
                  let filenameRegExp = new RegExp(`.*\/${file}.*\.css$`);
                  return filename.match(filenameRegExp);
                });
              } else {
                return true;
              }
            })
            .forEach(cssFileName => {
              const asset = compilation.assets[cssFileName];
              let input = {};

              if (this.options.sourceMap) {
                if (asset.sourceAndMap) {
                  input = asset.sourceAndMap();
                } else {
                  input.map = asset.map();
                  input.source = asset.source();
                }
              } else {
                input.source = asset.source();
              }

              const filenameWithoutExtension = cssFileName.replace(CSS_REGEXP, '');

              let parsedData = bless.chunk(input.source, {
                sourcemaps: this.options.sourceMap,
                source: this.options.sourceMap ? input.map.sources[0] : null
              });

              if (parsedData.data.length > 1) {
                if (this.options.addImports) {
                  // Inject imports into primary created file
                  parsedData = addImports(parsedData, filenameWithoutExtension);
                }
                if (this.options.minimize) {
                  parsedData = minimize(parsedData);
                }
                parsedData.data.forEach((fileContents, index) => { // eslint-disable-line max-nested-callbacks
                  const filename = createBlessedFileName(filenameWithoutExtension, index);
                  const outputSourceMap = parsedData.maps[index];

                  if (outputSourceMap) {
                    compilation.assets[filename] = new SourceMapSource(fileContents, filename, outputSourceMap, input.source, input.map);
                  } else {
                    compilation.assets[filename] = new RawSource(fileContents);
                  }

                  if (index > 0 && !this.options.addImports) {
                    chunk.files.push(filename);
                  }
                });
              }
            });
        });
        callback();
      });
    });
  }

}

module.exports = BlessCSSWebpackPlugin;
