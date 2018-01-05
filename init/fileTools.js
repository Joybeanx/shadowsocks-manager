const fs = require('fs');
const request = require('request');
const targz = require('tar.gz2');
const log4js = require('log4js');
const logger = log4js.getLogger('system');

const mkdirSync = function (dirPath) {
    try {
        fs.mkdirSync(dirPath)
    } catch (err) {
        if (err.code !== 'EEXIST') {
            logger.error(`Failed to make directory ${dirPath}`);
            throw err;
        }
    }
}

const unzipFromUrl = function (url, dest, callback) {
    const read = request.get(url);
    const write = targz().createWriteStream(dest);
    read.pipe(write).on('finish', () => callback());
}

exports.mkdirSync = mkdirSync;
exports.unzipFromUrl = unzipFromUrl;