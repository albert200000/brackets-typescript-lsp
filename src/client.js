/*global exports */
/*global process */
/*eslint-env es6, node*/
/*eslint max-len: ["error", { "code": 200 }]*/
"use strict";

var LanguageClient = require(global.LanguageClientInfo.languageClientPath).LanguageClient,
    net = require("net"),
    cp = require("child_process"),
    execa = require("execa"),
    semver = require('semver'),
    clientName = "TypeScriptClient",
    executablePath = "";

function validateNodeExecutable(confParams) {
    executablePath = confParams["executablePath"] ||
        (process.platform === 'win32' ? 'node.exe' : 'node');

    return new Promise(function (resolve, reject) {
        resolve();
    });
}

var serverOptions = function () {
    return new Promise(function (resolve, reject) {
        var serverProcess = cp.spawn(executablePath, [
            __dirname + "/../node_modules/.bin/typescript-language-server",
            "--stdio",
            "--tsserver-path=" + __dirname + "/../node_modules/.bin/tsserver"
        ]);

//        serverProcess.stdout.on('data', function (chunk) {
//            var str = chunk.toString();
//            console.log('TS Language Server:', str);
//        });
//
//        serverProcess.stderr.on('data', function (chunk) {
//            var str = chunk.toString();
//            console.log('TS Language Server:', str);
//        });
 
        if (serverProcess && serverProcess.pid) {
            resolve({
                process: serverProcess
            });
        } else {
            reject("Couldn't create server process");
        }
    });
},
options = {
    serverOptions: serverOptions
};

function init(domainManager) {
    var client = new LanguageClient(clientName, domainManager, options);
    client.addOnRequestHandler('validateNodeExecutable', validateNodeExecutable);
}

exports.init = init;
