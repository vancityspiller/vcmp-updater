const _config = {
    password: "",
    port: 8000
}

const _versions = {
    "04rel006": "5FE83BB4"
}

const server = require('http').createServer(function(req, res) {

    // only POST requests
    if(req.method != 'POST') return;

    switch(req.url)
    {
        case '/check': {

            var reqBody = '';

            req.on('data', function(chunk) {
                reqBody += chunk.toString();
            });

            req.on('end', function() {   
                
                // extract our data from the form-data (couldn't find a reliable parser :X)
                const jsonStart = reqBody.indexOf('"json"'), jsonEnd = reqBody.lastIndexOf("}");

                // no data provided?
                if(jsonStart == -1 || jsonEnd == -1)
                {
                    // return a bad request status
                    res.writeHead(400); 
                    res.end();

                    return;
                }

                // slice it out
                const jsonData = JSON.parse(reqBody.slice(jsonStart + 9, jsonEnd + 1)); 

                // request doesn't match the format
                if(!jsonData.hasOwnProperty("password") ||!jsonData.hasOwnProperty("versions"))
                {
                    // return a bad request status
                    res.writeHead(400); 
                    res.end();

                    return;
                }

                // updater password is set and doesn't match
                if(_config.password != "" && jsonData.password != _config.password)
                {
                    // return an unauthorized status
                    res.writeHead(401); 
                    res.end();

                    return;
                }
                
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
            });   
                
            break;
        }

        case '/download':
        {

            break;
        }
    }
});

server.listen(_config.port);