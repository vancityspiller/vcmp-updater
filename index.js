const _config = require('./config.json');
const _versions = require('./versions.json');

const { Curl, CurlFeature } = require('node-libcurl');
const fs = require('fs');
const schedule = require('node-schedule');

// ======================================================= //

const _log = (log) => {
    if(_config.logging) {
        console.log(log);
    }
} 

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
            versions: _versions
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

                        _log(`[>] Downloading version ${v} (build ${buildVersion})`);
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
                    if(_code !== 200) {

                        // need to close these either way
                        fs.closeSync(fileOut);
                        reqDownload.close();

                        // might need to delete the garbage
                        fs.unlink(`./builds/${tempFileName}`, () => {});
                        return;
                    }

                    fs.closeSync(fileOut);

                    // Rename the file if header found
                    if(fileName !== null) {
                        fs.rename(`./builds/${tempFileName}`, `./builds/${fileName}`, () => {});
                        
                        // update our version catalog
                        _versions[v] = buildVersion;
                        fs.writeFile('./versions.json', JSON.stringify(_versions, null, 4), () => {});   
                    }

                    _log('[>] Download completed.\n');
                    reqDownload.close();
                });

                // ------------------------------------------------------- //

                reqDownload.perform();
            });
        }
    });

    reqCheck.perform();
}

// ======================================================= //

// run this function everday and on startup
// only if updater url is set
if(_config.updater.trim().length > 0) {

    schedule.scheduleJob('0 0 * * *', taskUpdate);
    taskUpdate();
}

// ======================================================= //
// Routes

const server = require('http').createServer(function(req, res) {

    // only POST requests
    if(req.method !== 'POST') return;

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
            
            _log('[<] [check] POST Request received.\n');

            // process versions
            const reqVersions = Object.keys(jsonData.versions);
            var newVersions = [];

            reqVersions.forEach(v => {

                // we don't have that version
                if(!_versions.hasOwnProperty(v)) return;

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

            if(!_versions.hasOwnProperty(jsonData.version)) {

                // return 404
                res.writeHead(404); 
                res.end();

                return;
            }

            // ------------------------------------------------------- //

            _log('[<] [download] POST Request received.');

            const file = 'build' + _versions[jsonData.version] + '.7z';
            const path = './builds/' + file;
            const fileSize = fs.statSync(path).size;

            res.writeHead(200, {
                'Content-Description' : 'File Transfer',
                'Content-Type' : 'application/octet-stream',
                'Content-Disposition' : 'attachment; filename=' + file,
                'Content-Length' : fileSize
            });
            
            _log(`[>] [download] Sending version ${jsonData.version} (build ${_versions[jsonData.version]}).\n`);
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