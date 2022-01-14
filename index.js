const _config = require('./config.json');
const _versions = require('./versions.json');

// ======================================================= //

const fs = require('fs');
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

            // updater password is set and doesn't match
            if(_config.password !== "" && jsonData.password !== _config.password) {

                // return an unauthorized status
                res.writeHead(401); 
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

            const file = 'build' + _versions[jsonData.version] + '.7z';
            const path = './builds/' + file;
            const fileSize = fs.statSync(path).size;

            res.writeHead(200, {
                'Content-Description' : 'File Transfer',
                'Content-Type' : 'application/octet-stream',
                'Content-Disposition' : 'attachment; filename=' + file,
                'Content-Length' : fileSize
            });

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