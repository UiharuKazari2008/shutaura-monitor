const systemglobal = require('../config.json');

const os = require('os');
const { clone } = require('./tools');
const amqp = require('amqplib/callback_api');
const MQServer = `amqp://${systemglobal.MQUsername}:${systemglobal.MQPassword}@${systemglobal.MQServer}/?heartbeat=60`

module.exports = function (facility, options) {
    let module = {};
    let amqpConn = null;
    let pubChannel = null;
    const Logger = require('./logSystem')(facility);

    function publish(exchange, routingKey, content, callback) {
        try {
            pubChannel.publish(exchange, routingKey, content, { persistent: true },
                function(err, ok) {
                    if (err) {
                        Logger.printLine("KanmiMQ", "Failed to Publish Message", "critical", err)
                        pubChannel.connection.close();
                        callback(false)
                    } else {
                        callback(true)
                    }
                });
        } catch (e) {
            Logger.printLine("KanmiMQ", "Publish Error", "error", e)
            callback(false)
        }
    }
    function sendData(client, content, ok) {
        let exchange = "kanmi.exchange";
        let cleanObject = clone(content)
        if ( content.hasOwnProperty('itemFileData' ) ) {
            delete cleanObject.itemFileData
        }
        publish(exchange, client, new Buffer.from(JSON.stringify(content), 'utf-8'), function (callback) {
            if (callback) {
                ok(true);
                if (client !== systemglobal.Sequenzia_In) {
                    //Logger.printLine("KanmiMQ", `Sent message to ${client}`, "info", cleanObject)
                }
            } else {
                ok(false)
            }
        });
    }
    function closeOnErr(err) {
        if (!err) return false;
        Logger.printLine("KanmiMQ", "Connection Closed due to error", "error", err)
        amqpConn.close();
        return true;
    }

    amqp.connect(MQServer, function(err, conn) {
        if (err) {
            Logger.printLine("KanmiMQ", "Initialization Error", "critical", err)
            return setTimeout(function () {
                process.exit(1)
            }, 1000);
        }
        conn.on("error", function(err) {
            if (err.message !== "Connection closing") {
                Logger.printLine("KanmiMQ", "Initialization Connection Error", "emergency", err)
            }
        });
        conn.on("close", function() {
            Logger.printLine("KanmiMQ", "Attempting to Reconnect...", "debug")
            return setTimeout(function () {
                process.exit(1)
            }, 1000);
        });
        Logger.printLine("KanmiMQ", `Publisher Connected to Kanmi Exchange as ${systemglobal.SystemName}!`, "info")
        amqpConn = conn;
        amqpConn.createConfirmChannel(function(err, ch) {
            if (closeOnErr(err)) return;
            ch.on("error", function(err) {
                Logger.printLine("KanmiMQ", "Channel Error", "error", err)
            });
            ch.on("close", function() {
                Logger.printLine("KanmiMQ", "Channel Closed", "critical", {
                    message: "null"
                })
            });
            pubChannel = ch;
        });
    });

    module.sendMessage = function (message, channel, proccess, inbody) {
        let body = 'undefined'
        let proc = 'Unknown'
        if (typeof proccess !== 'undefined' && proccess) {
            if (proccess !== 'Unknown') {
                proc = proccess
            }
        }
        if (typeof inbody !== 'undefined' && inbody) {
            if (proc === "SQL") {
                body = "" + inbody.sqlMessage
            } else if (Object.getPrototypeOf(inbody) === Object.prototype) {
                if (inbody.message) {
                    body = "" + inbody.message
                } else {
                    body = "" + JSON.stringify(inbody)
                }
            } else {
                body = "" + inbody
            }
        }
        let sendto = "720168867845898283"
        let errmessage = ""
        let loglevel = ''
        if (channel === "system") {
            sendto = "716207965190750238"
            loglevel = 'info'
            message = "" + message
        } else if (channel === "info") {
            sendto = "720170385588355072"
            loglevel = 'info'
            message = "🆗 " + message
        } else if (channel === "warn") {
            sendto = "720168185596346458"
            loglevel = 'warning'
            message = "⚠ " + message
        } else if (channel === "err") {
            sendto = "720168722156879962"
            loglevel = 'error'
            message = "❌ " + message
        } else if (channel === "crit") {
            sendto = "720168867845898283"
            loglevel = 'critical'
            message = "⛔ " + message
        } else if (channel === "message") {
            sendto = "720167909049237536"
            loglevel = 'notice'
            message = "✉️ " + message
        } else {
            message = "❕ " + message
            loglevel = 'alert'
            sendto = channel
        }
        if (body !== "undefined" ) {
            errmessage = ":\n```" + body.substring(0,500) + "```"
        }
        if (channel === "err" || channel === "crit" ) {
            Logger.printLine(proc, message, loglevel, inbody)
        } else {
            Logger.printLine(proc, message, loglevel)
        }
        sendData( `${systemglobal.Discord_Out}.priority`, {
            fromClient : `return.${facility}.${os.hostname()}`,
            messageReturn:  false,
            messageType : 'stext',
            messageChannelID : sendto,
            messageText : message.substring(0,255) + errmessage
        }, function (ok) {

        });
    }
    module.sendCmd = function (client, content, exchangeLevel) {
        let exchange = "kanmi.command";
        if (exchangeLevel) {
            exchange += "." + exchangeLevel
        }
        publish(exchange, `command.${client}`, new Buffer.from(JSON.stringify({
            command: content
        }), 'utf-8'), function (callback) {
            if (callback) {
                Logger.printLine("KanmiMQ", `Sent command to ${client}`, "info", content)
            } else {
            }
        });
    }
    module.sendData = sendData;

    return module
}

