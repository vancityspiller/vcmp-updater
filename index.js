const _config = require('./config.json');
const _versions = require('./versions.json');

const unknownVersions = {};
const updaterEnabled = _config.updater.trim().length > 0;

// ======================================================= //

console.log('=======================================\n');
console.log(`Listening on port: ${_config.port}\n`);
console.log(`Password: ${_config.password.trim().length > 0 ? _config.password : '[unset]'}`);
console.log(`Updater: ${updaterEnabled ? _config.updater : '[disabled]'}\n`);
console.log('=======================================\n');

// ======================================================= //
// Dependencies

const { Curl, CurlFeature } = require('node-libcurl');
const fs = require('fs');
const schedule = require('node-schedule');

// ======================================================= //
// Logging 

const _log = (log) => {
    if(_config.logging) {

        const now_ = new Date();
        log = `[${now_.getHours()}:${now_.getMinutes()}] ${log}\n`;

        console.log(log);
        fs.appendFile('updater_log.txt', log, () => {});
    }
} 

const taskLog = () => {

    if(_config.logging) {

        const monthNames = ["January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"];

        const now_ = new Date();
        const log = `========== ${now_.getDate()} ${monthNames[now_.getMonth()]} ==========\n`;

        console.log(log);
        fs.appendFile('updater_log.txt', log, () => {});
    }
}

taskLog();
schedule.scheduleJob('0 0 * *', taskLog);

// ======================================================= //
// Update local versions from provided updater

const taskUpdate = () => {

    _log('[>] Running update task.');

    const reqCheck = new Curl();
    const close_ = reqCheck.close.bind(reqCheck);

    reqCheck.setOpt(Curl.option.URL, `${_config.updater}/check`);
    reqCheck.setOpt(Curl.option.HTTPPOST, [{ 
        name: 'json', contents: JSON.stringify({
            password: '',
            versions: {
                ...unknownVersions,
                ..._versions
            }
        })
    }]);

    // ------------------------------------------------------- //

    reqCheck.on('error', close_);
    reqCheck.on('end', (_code, _body, _headers) => {

        // check if request was accepted
        if(_code !== 200) return;

        if(_body.length > 0) {
            const newVersions = _body.split('|');

            newVersions.forEach((v) => {

                const reqDownload = new Curl();
                const close = reqDownload.close.bind(reqDownload);

                reqDownload.setOpt(Curl.option.URL, `${_config.updater}/download`);
                reqDownload.setOpt(Curl.option.HTTPPOST, [{ 
                    name: 'json', contents: JSON.stringify({
                        password: '',
                        version: v
                    })
                }]);

                reqDownload.on('error', close);

                // ------------------------------------------------------- //

                let fileName = null, buildVersion = null;
                reqDownload.setOpt(Curl.option.HEADERFUNCTION, function(buff, size, nmemb) {
                    
                    const buffStr = buff.toString();

                    if(buffStr.toLowerCase().indexOf('content-disposition: attachment;') !== -1) {
                        fileName = buffStr.slice(43, -3);
                        buildVersion = fileName.slice(5, -3);
                    }
                
                    return size * nmemb;
                });

                // ------------------------------------------------------- //
                
                const tempFileName = new Date().getTime();
                const fileOut = fs.openSync(`./builds/${tempFileName}`, 'w+');

                reqDownload.setOpt(Curl.option.WRITEFUNCTION, (buff, nmemb, size) => {
                    let written = 0;
                    if (fileOut) {
                        written = fs.writeSync(fileOut, buff, 0, nmemb * size);
                    } 
                    else {
                        process.stdout.write(buff.toString());
                        written = size * nmemb;
                    }
                    return written;
                });

                // ------------------------------------------------------- //

                // disable storage since we're writing the file
                reqDownload.enable(CurlFeature.Raw | CurlFeature.NoStorage);
                reqDownload.on('end', (_code, _body, _headers) => {
                    
                    // check if request was accepted
                    // or if couldn't find filename in headers
                    if(_code !== 200 || fileName === null) {

                        // need to close these either way
                        fs.closeSync(fileOut);
                        reqDownload.close();

                        // might need to delete the garbage
                        fs.unlink(`./builds/${tempFileName}`, () => {});

                        _log(`[x] Could not download version ${v} successfully.`);
                        return;
                    }

                    fs.closeSync(fileOut);
                    fs.rename(`./builds/${tempFileName}`, `./builds/${fileName}`, () => {});
                    
                    // update our version catalog
                    _versions[v] = buildVersion;
                    fs.writeFile('./versions.json', JSON.stringify(_versions, null, 4), () => {});   

                    // check if it was listed as an unknown version earlier
                    if(unknownVersions.hasOwnProperty(v)) {

                        // if so, then remove it
                        delete unknownVersions[v];
                    }

                    _log(`[>] Downloaded version ${v} (build ${buildVersion}).`);
                    reqDownload.close();
                });

                // ------------------------------------------------------- //

                reqDownload.perform();
            });
        }
    });

    reqCheck.perform();
}

// run this function everday and on startup
// only if updater url is set
if(updaterEnabled) {

    schedule.scheduleJob('0 0 * * *', taskUpdate);
    taskUpdate();
}

// ======================================================= //
// Routes

const server = require('http').createServer(function(req, res) {

    // only POST requests
    if(req.method !== 'POST') {
        
        res.writeHead(404);
        res.end();

        return;
    }

    var reqBody = '';
    req.on('data', function(chunk) {
        reqBody += chunk.toString();
    });

    // ------------------------------------------------------- //

    req.on('end', function() {   
        
        // extract our data from the form-data (couldn't find a reliable parser :X)
        const jsonStart = reqBody.indexOf('"json"'), jsonEnd = reqBody.lastIndexOf("}");

        // no data provided?
        if(jsonStart === -1 || jsonEnd === -1)
        {
            // return a bad request status
            res.writeHead(400); 
            res.end();

            return;
        }

        // slice it out
        const jsonData = JSON.parse(reqBody.slice(jsonStart + 9, jsonEnd + 1));

        // ------------------------------------------------------- //

        // request doesn't have a password field
        if(!jsonData.hasOwnProperty("password")) {

            // return a bad request status
            res.writeHead(400); 
            res.end();

            return;
        }

        // updater password is set and doesn't match
        if(_config.password !== "" && jsonData.password !== _config.password) {

            // return an unauthorized status
            res.writeHead(401); 
            res.end();

            return;
        }

        // ======================================================= //

        if(req.url === '/check') {

            // request doesn't have versions key
            if(!jsonData.hasOwnProperty("versions")) {

                // return a bad request status
                res.writeHead(400); 
                res.end();

                return;
            }

            // ------------------------------------------------------- //
            
            _log('[<] [check] POST Request received.');

            // process versions
            const reqVersions = Object.keys(jsonData.versions);
            var newVersions = [];

            reqVersions.forEach(v => {

                // we don't have that version
                if(!_versions.hasOwnProperty(v)) {
                    
                    if(!unknownVersions.hasOwnProperty(v)) {
                        _log(`[<] Unknown version ${v} encountered.`);
                        
                        // mark that version as unknown
                        unknownVersions[v] = '00000001';
                        if(updaterEnabled) taskUpdate();
                    }

                    return;
                };

                // compare the build version
                const v1 = parseInt(jsonData.versions[v], 16), v2 = parseInt(_versions[v], 16);
                if(v1 < v2) newVersions.push(v);
            });     
            
            // OK
            res.writeHead(200);

            // reduce it to single value
            if(newVersions.length > 0) {

                newVersions = newVersions.reduce((p, n) =>  p + "|" + n);
                res.end(newVersions)
            }
            else res.end();
        }

        // ======================================================= //

        else if (req.url === '/download') {
            
            // request doesn't have version key
            if(!jsonData.hasOwnProperty("version")) {

                // return a bad request status
                res.writeHead(400); 
                res.end();

                return;
            }

            // ------------------------------------------------------- //

            // we dn't have that version yet
            if(!_versions.hasOwnProperty(jsonData.version)) {

                // return 404
                res.writeHead(404); 
                res.end();

                if(!unknownVersions.hasOwnProperty(jsonData.version)) {
                    _log(`[<] Unknown version ${jsonData.version} encountered.`);
                    
                    // mark that version as unknown
                    unknownVersions[jsonData.version] = '00000001';
                    if(updaterEnabled) taskUpdate();
                }

                return;
            }

            // ------------------------------------------------------- //

            const file = 'build' + _versions[jsonData.version] + '.7z';
            const path = './builds/' + file;
            const fileSize = fs.statSync(path).size;

            res.writeHead(200, {
                'Content-Description' : 'File Transfer',
                'Content-Type' : 'application/octet-stream',
                'Content-Disposition' : 'attachment; filename=' + file,
                'Content-Length' : fileSize
            });
            
            _log(`[>] [download] Sending version ${jsonData.version} (build ${_versions[jsonData.version]}).`);
            const readStream = fs.createReadStream(path);
            readStream.pipe(res);
        }

        // ======================================================= //

        else {

            // return a not found
            res.writeHead(404);
            res.end();
        }
    });
});

server.listen(_config.port);

// ======================================================= //