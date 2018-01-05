const log4js = require('log4js');
const logger = log4js.getLogger('system');
const fs = require('fs');
const exec = require('child_process').exec;
const cron = appRequire('init/cron');

const config = appRequire('services/config').get('kcptun');
const downloadUrl = config.download;
const mtu = config.mtu;
const mode = config.mode;
const dscp = config.dscp;
const nocomp = config.nocomp = config.nocomp ? '--nocomp' : '';
const kcptunDir = process.env['HOME'] + '/kcptun/';
const serverRegex = new RegExp('server');

const knex = appRequire('init/knex').knex;
const fileTools = appRequire('init/fileTools');
let inited=false;

let kcptunServer;


/**
 * Start kcptun server for specified shadowsocks port
 * @param ssPort the target shadowsocks port that kcptun server apply
 * @param kcptunPort kcptun local port
 * @returns {*} kcptun port
 */
const start = async (ssPort, kcptunPort) => {
    try {
        if (!ssPort || !kcptunPort) {
            return;
        }
        const cmd = `${kcptunServer} -l ":${ kcptunPort } " -t "0.0.0.0:${ ssPort } " --crypt ${ crypt } --mtu ${ mtu } ${ nocomp } --mode ${ mode } --dscp ${ dscp }`;
        await exec(cmd);
        logger.info(`kcptun started up on port ${kcptunPort} for shadowsocks port ${ssPort}`);
        return {ssPort, kcptunPort};
    } catch (err) {
        logger.error(`Failed to start up kcptun for shadowsocks port ${ssPort}:` + err);
        return Promise.reject('error');
    }
};


/**
 * Stop kcptun server for specified shadowsocks port
 * @param ssPort the target shadowsocks port that kcptun server apply
 * @returns {*} kcptun port
 */
const stop = async (ssPort) => {
    try {
        if (!ssPort) {
            return;
        }
        const cmd = `kill -9 \`ps aux|grep ${kcptunServer}|grep :${ ssPort }|awk '{print $2}'\``;
        await exec(cmd);
        logger.info(`kcptun stopped for shadowsocks port ${ssPort}`);
        return {ssPort};
    } catch (err) {
        logger.error(`Failed to stop kcptun for shadowsocks port ${ssPort}:` + err);
        return Promise.reject('error');
    }
};


/**
 * Install kcptun server and start a process for every account ever opened kcptun
 */
const init = async () => {
    const startAll = async () => {
        kcptunServer = fs.readdirSync(kcptunDir).filter(f => serverRegex.test(f))[0];
        if (!kcptunServer) {
            logger.error("kcptun server not found in " + kcptunDir);
        }
        logger.info(`kcptun ${kcptunServer} set up successfully`);
        const accounts = await knex('account').select(['port', 'kcptunPort']);
        accounts.forEach(f => {
            start(f.port, f.kcptunPort);
        });
        inited=true;
    }
    fileTools.unzipFromUrl(downloadUrl, kcptunDir,startAll);
};

init();
cron.minute(() => {
    syncStatus();
}, 1);

/**
 * List kcptun port opened on this server
 * @returns kcptun port
 */
const list = async () => {
    const firstCharOfKcpServer = kcptunServer.charAt(0);
    const kcptunServerRegex = kcptunServer.replace(firstCharOfKcpServer, '[' + firstCharOfKcpServer + ']');
    const cmd = `ps -ef|grep "${ kcptunServerRegex } "  |gawk --re-interva  'match($0,/-l :([[:digit:]]*?)/,a)  { print a[1] }'`;
    const result = [];
    await exec(cmd, function (err, stdout, stderr) {
        if (err) {
            logger.error(`Failed to list kcptun port:` + err);
            throw   Promise.reject('error');
        } else {
            stdout.split('\n').filter(f => f).forEach(f => {
                if (result.indexOf(f) < 0) {
                    result.push(f);
                }
            });
        }
    });
    return result;
};


/**
 * Stop existing kcptun server for the shadowsocks port, and start a new  kcptun server on the specified port if the input kcptun port is not empty
 * @param ssPort
 * @param kcptunPort
 * @returns {Promise.<*>}
 */
const set = async (ssPort, kcptunPort) => {
    try {
        const updateAccount = await knex('account').where({ssPort}).update({
            kcptunPort,
        });
        if (updateAccount <= 0) {
            return Promise.reject('error');
        }
        stop(ssPort);
        if (kcptunPort) {
            start(ssPort, kcptunPort);
        }
        logger.info(`set kcptun port to ${kcptunPort} for shadowsocks port ${ssPort}`);
        return {ssPort, kcptunPort};
    } catch (err) {
        logger.error(`Failed to set kcptun for shadowsocks port ${ssPort}:` + err);
        return Promise.reject('error');
    }
};


const syncStatus = async () => {
    if(!inited){
        return;
    }
    const accounts = await knex('account').select(['port', 'kcptunPort']);
    const currentKcptunPorts = await list();
    accounts.forEach(f => {
        if (currentKcptunPorts.indexOf(f.kcptunPort) < 0) {
            start(f.port, f.kcptunPort);
        }
    });
};



exports.start = start;
exports.stop = stop;
exports.list = list;
exports.set = set;