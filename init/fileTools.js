const fs = require('fs');
var tar = require('tar');
const http = require('http')
const path = require('path');
const zlib = require('zlib');
const log4js = require('log4js');
const logger = log4js.getLogger('system');

const mkdir = function mkdir(filePath) {
    try {
        var dir = path.dirname(filePath);
        if (fs.statSync(dir)) {
            return true;
        }
        mkdir(dir);
        fs.mkdirSync(dir);
    } catch (err) {
        logger.error(`Failed to create directory ${filePath}:${err}`);
        throw err;
    }
}

const download = function (url, dest) {
    const file = fs.createWriteStream(dest);
    http.get(url, function (response) {
        mkdir(dest);
        response.pipe(file);
        file.on('finish', function () {
            file.close();
        });
    }).on('error', function (err) {
        logger.error(`Failed to download ${url} to ${dest}:${err}`);
        fs.unlink(dest);
        throw err;
    });
};

const unzip = function (source, dest) {
    try {
        const inp = fs.createReadStream(source);
        const unzip = zlib.Unzip();
        mkdir(dest);
        const out = fs.createWriteStream(dest);
        inp.pipe(unzip).pipe(out);
    } catch (err) {
        logger.error(`Failed to unzip ${source} to ${dest}:${err}`);
        throw err;
    }
};

const unzipFirst = function (source, dest, entryRegex) {
    try {
        const inp = fs.createReadStream(source);
        const unzip = zlib.Unzip();
        const parser = inp.pipe(unzip).pipe(tar.Parse());
        let firstMatchEntryName = null;
        parser.on('entry', function (entry) {
                if (!entryRegex || (new RegExp(entryRegex)).test(entry.path)) {
                    const isDir = 'Directory' === entry.type;
                    const fullPath = path.join(dest, entry.path);
                    const directory = isDir ? fullPath : path.dirname(fullPath);
                    mkdir(directory);
                    if (!isDir) {
                        entry.pipe(fs.createWriteStream(fullPath));
                        firstMatchEntryName = fullPath;
                        parser.end();
                    }
                }
            }
        );
        return firstMatchEntryName;
    } catch (err) {
        logger.error(`Failed to unzip first match entry of ${source} to ${dest}:${err}`);
        throw err;
    }
}

exports.mkdir = mkdir;
exports.download = download;
exports.unzip = unzip;
exports.unzipFirst = unzipFirst;