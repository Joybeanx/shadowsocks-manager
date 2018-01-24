const log4js = require('log4js');
const logger = log4js.getLogger('system');
const fs = require('fs');
const exec = require('child_process').exec;
const cron = appRequire('init/cron');

const config = appRequire('services/config');
const downloadUrl = 'https://github.com/xtaci/kcptun/releases/download/v20171201/kcptun-linux-amd64-20171201.tar.gz';
const kcptunOption = config.kcptunOption ? '--' + config.kcptunOption.replace('/;/g', ' --').replace('/=/g', ' ') : '--crypt none --mtu 1350 --nocomp --mode fast2 --dscp 46';
const kcptunDir = 'kcptun/';
const kcptunPath = process.cwd() + '/' + kcptunDir;
const serverRegex = new RegExp('server');

const knex = appRequire('init/knex').knex;
const fileTools = appRequire('init/fileTools');
let inited;

let kcptunServer;


/**
 * Start kcptun server for specified shadowsocks port
 * @param ssPort the target shadowsocks port that kcptun server apply
 * @param kcptunPort kcptun local port
 * @returns {*} kcptun port
 */
const start = async (ssPort, kcptunPort) => {
    if (!ssPort || !kcptunPort) {
        return;
    }
    logger.info(`prepare to start kcptun port on ${kcptunPort} for shadowsocks port ${ssPort}`);
    exist(kcptunPort).then(r => {
        if (r) {
            logger.info(`kcptun start ignored cause kcptun port ${kcptunPort} exists`);
        } else {
            const cmd = `./${kcptunDir}${kcptunServer} -l ":${ kcptunPort }" -t "0.0.0.0:${ ssPort }" ${ kcptunOption }`;
            exec(cmd, (error, stdout, stderr) => {
                if (error || stderr) {
                    logger.error(`start error:${error}`);
                    logger.error(`start stderr:${stderr}`);
                    logger.error(`Failed to start kcptun on ${kcptunPort} for shadowsocks port ${ssPort}:${ stderr || error }`);
                    return;
                }
                logger.info(`stdout: ${stdout}`);
                logger.info(`kcptun started up on port ${kcptunPort} for shadowsocks port ${ssPort}`);
            });
        }
    });
};


/**
 * Stop kcptun server for specified shadowsocks port
 * @param ssPort the target shadowsocks port that kcptun server apply
 * @returns {*} kcptun port
 */
const stop = async (ssPort) => {
    if (!ssPort) {
        return;
    }
    logger.info(`prepare to stop kcptun ${ssPort}`);
    const cmd = `ps -aux | grep ${kcptunServer} | grep ":${ ssPort } "| awk '{print $2}'| xargs -r kill -9`;
    await exec(cmd, (error, stdout, stderr) => {
        if (error || stderr) {
            logger.error(`stop error:${error}`);
            logger.error(`stop stderr:${stderr}`);
            logger.error(`Failed to stop kcptun for shadowsocks port ${ssPort}:${ stderr || error}`);
            return;
        }
        logger.info(`stdout: ${stdout}`);
        logger.info(`kcptun stopped for shadowsocks port ${ssPort}`);
    });
    return {ssPort};
}


/**
 * Install kcptun server and start a process for every account ever opened kcptun
 */
const init = async () => {
    const startAll = async () => {
        kcptunServer = fs.readdirSync(kcptunPath).filter(f => serverRegex.test(f))[0];
        if (!kcptunServer) {
            logger.error("kcptun server not found in " + kcptunPath);
        }
        inited = true;
        logger.info(`kcptun  ${kcptunPath}${kcptunServer} set up successfully`);
        const accounts = await knex('account').select(['port', 'kcptunPort']);
        accounts.forEach(f => {
            start(f.port, f.kcptunPort);
        });
    }
    fileTools.unzipFromUrl(downloadUrl, kcptunPath, startAll);
};

init();
cron.minute(() => {
    syncStatus();
}, 1);

/**
 * List kcptun port opened on this server
 * @returns Promise
 */
const list = () => {
    const firstCharOfKcpServer = kcptunServer.charAt(0);
    const kcptunServerRegex = kcptunServer.replace(firstCharOfKcpServer, '[' + firstCharOfKcpServer + ']');
    const cmd = `ps -ef|grep "${ kcptunServerRegex }"  | gawk --re-interva  'match($0,/-l :([[:digit:]]*?)/,a)  { print a[1] }'`;
    return new Promise((resolve, reject) => {
        exec(cmd, function (err, stdout, stderr) {
            if (err || stderr) {
                reject(err || stderr);
            } else {
                const result = [];
                stdout.split('\n').filter(f => f).forEach(f => {
                    if (result.indexOf(f) < 0) {
                        result.push(f);
                    }
                });
                logger.info(`current alive kcptun ports:${result}`)
                resolve(result);
            }
        });
    });
};


/**
 * whether the kcptun process that starts on the specified port exists
 * @param port
 * @param kcptunPort
 * @returns {Promise.<*>}
 */
const exist = kcptunPort => {
    const cmd = `netstat -antu | grep ${ kcptunPort }|| true `;
    return new Promise((resolve, reject) => {
        exec(cmd, function (err, stdout, stderr) {
            if (err || stderr) {
                reject(err || stderr);
            } else {
                const result = stdout.split('\n').find(f => f);
                logger.info(`whether kcptun port exists:${!!result}`)
                resolve(result);
            }
        });
    });
};

/**
 * Stop existing kcptun server for the shadowsocks port, and start a new  kcptun server on the specified port if the input kcptun port is not empty
 * @param port
 * @param kcptunPort
 * @returns {Promise.<*>}
 */
const set = async (port, _kcptunPort) => {
    if (!inited) {
        return;
    }
    const kcptunPort = _kcptunPort ? _kcptunPort : 0;
    logger.info(`prepare to set kcptun port to ${kcptunPort} for shadowsocks port ${port}`);
    const updateAccount = await knex('account').where({port}).update({
        kcptunPort,
    });
    if (updateAccount <= 0) {
        return Promise.reject(`Cannot find account by port ${port}`);
    }
    await stop(port);
    if (kcptunPort) {
        await start(port, kcptunPort);
    }
    return {port, kcptunPort};
};


const syncStatus = async () => {
    if (!inited) {
        return;
    }
    const accounts = await knex('account').select(['port', 'kcptunPort']);
    list().then(currKcptunPorts => {
        accounts.filter(a => currKcptunPorts.indexOf(a.kcptunPort) < 0).forEach(a => start(a.port, a.kcptunPort));
    });
};


exports.start = start;
exports.stop = stop;
exports.list = list;
exports.set = set;