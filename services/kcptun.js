const log4js = require('log4js');
const logger = log4js.getLogger('system');
const fs = require('fs');
const exec = require('child_process').exec;
const spawn = require('child_process').spawn;
const cron = appRequire('init/cron');

const config = appRequire('services/config').all();
const downloadUrl = 'https://github.com/xtaci/kcptun/releases/download/v20171201/kcptun-linux-amd64-20171201.tar.gz';
const kcptunOption = config.kcptunOption ? ('--' + config.kcptunOption.replace(/;/g, ' --').replace(/=/g, ' ')).split(/\s+/) : ['--crypt', 'none', '--mtu', '1350', '--nocomp', '--mode', 'fast3', '--dscp', 46];
const kcptunDir = 'kcptun/';
const kcptunPath = process.env['HOME'] + '/' + kcptunDir;
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
    exist(kcptunPort).then(r => {
        if (r) {
            logger.info(`kcptun start ignored cause kcptun port ${kcptunPort} exists`);
        } else {
            logger.info(`prepare to start kcptun port on ${kcptunPort} for shadowsocks port ${ssPort}`);
            var options = kcptunOption.slice();
            options.unshift('-l', `:${ kcptunPort }`, '-t', `0.0.0.0:${ ssPort }`);
            //use spawn instead of exec because the startup command never ends
            let kcptun = spawn(`./${kcptunServer}`, options, {
                cwd: kcptunPath
            });
            //kcptun log default goes to stderr
            kcptun.stderr.on('data', function (data) {
                logger.info(`kcptun start info:\n${data}`);
            });
        }
    });
};


/**
 * Stop kcptun server for specified shadowsocks port
 * @param ssPort the target shadowsocks port that kcptun server apply
 * @returns {Promise}
 */
const stopFor = (ssPort) => {
    if (!ssPort) {
        return Promise.resolve();
    }
    const cmd = `ps aux | grep ${kcptunServer} | grep "[:]${ ssPort } "| awk '{print $2}'`;
    return new Promise((resolve, reject) => {
        exec(cmd, function (err, stdout, stderr) {
            if (err || stderr) {
                logger.error(`Failed to stop kcptun for shadowsocks port ${ssPort}:${ err || stderr}`);
                reject(stderr);
            } else {
                if (stdout) {
                    stdout.split('\n').filter(pid => pid).forEach(pid => {
                        process.kill(pid);
                        logger.info(`kcptun for shadowsocks port ${ssPort} had been stopped`);
                    });
                    resolve();
                }
            }
        });
    });
};

/**
 * Stop kcptun server started on the specified kcptun port
 * @param kcptunPort the target kcptun port to stop
 * @returns {Promise}
 */
const stop = (kcptunPort) => {
    if (!kcptunPort) {
        return Promise.resolve();
    }
    const cmd = `ps aux | grep ${kcptunServer} | grep "[:]${ kcptunPort } "| awk '{print $2}'`;
    return new Promise((resolve, reject) => {
        exec(cmd, function (err, stdout, stderr) {
            if (err || stderr) {
                logger.error(`Failed to stop kcptun on port ${kcptunPort}:${ err || stderr}`);
                reject(stderr);
            } else {
                if (stdout) {
                    stdout.split('\n').filter(pid => pid).forEach(pid => {
                        process.kill(pid);
                        logger.info(`kcptun ${kcptunPort} had been stopped`);
                    });
                    resolve();
                }
            }
        });
    });
};

/**
 * Install kcptun server and start a process for every account ever opened kcptun
 */
const init = async () => {
    logger.info(`init kcptun  ${kcptunPath}`);
    const startAll = async () => {
        kcptunServer = fs.readdirSync(kcptunPath).filter(f => serverRegex.test(f))[0];
        if (!kcptunServer) {
            logger.error(`kcptun server not found in ${kcptunPath}`);
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
                        result.push(+f);
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
 * @param kcptunPort
 * @returns {Promise.<*>}
 */
const exist = kcptunPort => {
    const cmd = `netstat -antu | grep ":${ kcptunPort } "|| true `;
    return new Promise((resolve, reject) => {
        exec(cmd, function (err, stdout, stderr) {
            if (err || stderr) {
                reject(err || stderr);
            } else {
                const result = stdout.split('\n').find(f => f);
                logger.info(`kcptun port ${kcptunPort} ${!!result ? '' : 'doesn\'t '}exist`);
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
    stopFor(port).then(() => {
            if (kcptunPort) {
                start(port, kcptunPort);
            }
        }
    );
};


const syncStatus = async () => {
    if (!inited) {
        return;
    }
    const accounts = await knex('account').select(['port', 'kcptunPort']);
    list().then(alivePorts => {
        if (alivePorts) {
            accounts.filter(a => a.kcptunPort).forEach(a => {
                let pos = alivePorts.indexOf(a.kcptunPort);
                if (pos < 0) {
                    start(a.port, a.kcptunPort)
                } else {
                    alivePorts.splice(pos, 1);
                }
            });
        }
        //kcptun port should kill
        if (alivePorts && alivePorts.length > 0) {
            logger.info(`kcptun port should kill ${alivePorts}`);
            alivePorts.forEach(p => stop(p));
        }
    });
};


exports.start = start;
exports.stop = stop;
exports.list = list;
exports.set = set;