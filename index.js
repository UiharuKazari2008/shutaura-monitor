/*    ___                  __                        _______ __
     /   | _________ _____/ /__  ____ ___  __  __   / ____(_) /___  __
    / /| |/ ___/ __ `/ __  / _ \/ __ `__ \/ / / /  / /   / / __/ / / /
   / ___ / /__/ /_/ / /_/ /  __/ / / / / / /_/ /  / /___/ / /_/ /_/ /
  /_/  |_\___/\__,_/\__,_/\___/_/ /_/ /_/\__, /   \____/_/\__/\__, /
                                        /____/               /____/
Developed at Academy City Research
"Developing a better automated future"
======================================================================================
Kanmi Project - Discord Log System
Copyright 2020
======================================================================================
This code is under a strict NON-DISCLOSURE AGREEMENT, If you have the rights
to access this project you understand that release, demonstration, or sharing
of this project or its content will result in legal consequences. All questions
about release, "snippets", or to report spillage are to be directed to:

- ACR Docutrol -----------------------------------------
(Academy City Research Document & Data Control Services)
docutrol@acr.moe - 301-399-3671 - docs.acr.moe/docutrol
====================================================================================== */

const systemglobal = require('./config.json');
const facilityName = 'SQL-Watchdog';

const eris = require('eris');
const colors = require('colors');
const ping = require('ping');
let init = 0;
const bootTime = (Date.now().valueOf() / 1000).toFixed(0)
const storageHandler = require('node-persist');

const localParameters = storageHandler.create({
    dir: 'data/sql-state',
    stringify: JSON.stringify,
    parse: JSON.parse,
    encoding: 'utf8',
    logging: false,
    ttl: false,
    expiredInterval: 2 * 60 * 1000, // every 2 minutes the process will clean-up the expired cache
    forgiveParseErrors: false
});
localParameters.init((err) => {
    if (err) {
        Logger.printLine("LocalParameters", "Failed to initialize the Local parameters storage", "error", err)
    } else {
        Logger.printLine("LocalParameters", "Initialized successfully the Local parameters storage", "debug", err)
    }
});

const Logger = require('./utils/logSystem')(facilityName);
const db = require('./utils/shutauraSQL')(facilityName);

const startTime = new Date().getTime();
let activeRefresh = false;
let alarminhibited = false;
let sqlNoResponse = false;
let sqlWriteFail = false;
let sqlIOFail = false;
let sqlFallingBehind = false;

Logger.printLine("Discord", "Settings up Discord bot", "debug")
const discordClient = new eris.CommandClient(systemglobal.Discord_Key, {
    compress: true,
    restMode: true,
}, {
    name: "Shutaura Watchdog",
    description: "SQL Database Replication Watchdog",
    owner: "Yukimi Kazari",
    prefix: `!sql ${systemglobal.SystemName} `,
    restMode: true,
});

discordClient.registerCommand("inhibit", function (msg,args) {
    alarminhibited = (!alarminhibited);
    return `Alarms are ${((alarminhibited) ? 'disabled, dashboard will still update!' : 'enabled!')}`
},{
    argsRequired: false,
    caseInsensitive: false,
    description: "Inhibit All Alarms",
    fullDescription: "Disables all alarms and warnings",
    guildOnly: true
})
discordClient.registerCommand("status", async function (msg,args) {
    if (args.length > 0) {
        switch (args[0]) {
            case 'enable':
                updateStatus(undefined, true, msg.guildID, args[1].replace("<#", "").replace(">", ""));
                return `Added a insights display to <#${args[1].replace("<#", "").replace(">", "")}>`
            case 'disable':
                await localParameters.del(`statusgen-${msg.guildID}`)
                return "Disabled Insights Display for this guild, Please delete the message"
            default:
                return "Invalid Command"
        }
    } else {
        return `Missing command, use "help status"`
    }
}, {
    argsRequired: false,
    caseInsensitive: false,
    description: "Status Controls",
    fullDescription: "Enable/Disable Insights Display and Manage Stored Values\n" +
        "   **enable** - Add an insights display to this server\n      channel\n**disable** - Removes an insights display for this server\n      [system]",
    usage: "command [arguments]",
    guildOnly: true
})


async function updateIndicators() {
    const databaseStatus = await db.query(`SHOW SLAVE STATUS;`);
    let addUptimeWarning = false;
    let watchDogWarnings = [];
    let watchDogFaults = [];
    let ioState = [];
    let sqlState = [];
    let errors = [];
    if (databaseStatus.rows.length === 0) {
        watchDogFaults.push(`🚨 No replication hosts/channels!`)
    } else {
        sqlNoResponse = false;
        await databaseStatus.rows.forEach(row => {
            if (row.Seconds_Behind_Master !== null) {
                if (parseInt(row.Seconds_Behind_Master.toString()) >= 300) {
                    watchDogWarnings.push(`⚠️ Channel "${row.Channel_Name.toUpperCase()}" is behind by ${row.Seconds_Behind_Master} sec`);
                } else {
                    sqlFallingBehind = true;
                }
            }

            if (row.Last_SQL_Errno !== 0) {
                watchDogFaults.push(`🚨 Channel "${row.Channel_Name.toUpperCase()}" replication error: ${row.Last_SQL_Errno}`);
                if (!sqlWriteFail) {
                    if (!alarminhibited) {
                        discordClient.createMessage(systemglobal.Discord_Alarm_Channel, `🆘 ALARM! ${systemglobal.DatabaseName} Database Channel "${row.Channel_Name.toUpperCase()}" replication error\n\`${row.Last_SQL_Error}\``)
                            .catch(err => {
                                Logger.printLine("StatusUpdate", `Error sending message for alarm : ${err.message}`, "error", err)
                            })
                            .then(() => {
                                sqlWriteFail = true;
                            })
                    } else {
                        sqlWriteFail = true;
                    }
                }
            }
            if (row.Last_SQL_Error) {
                errors.push([row.Channel_Name, 1, row.Last_SQL_Error])
            }
            if (row.Slave_SQL_Running !== 'Yes') {
                watchDogFaults.push(`🛑 Channel "${row.Channel_Name.toUpperCase()}" has stopped!`);
                if (!sqlWriteFail) {
                    if (!alarminhibited) {
                        discordClient.createMessage(systemglobal.Discord_Alarm_Channel, `🆘 ALARM! ${systemglobal.DatabaseName} Database Channel "${row.Channel_Name.toUpperCase()}" has stopped replication!`)
                            .catch(err => {
                                Logger.printLine("StatusUpdate", `Error sending message for alarm : ${err.message}`, "error", err)
                            })
                            .then(() => {
                                sqlWriteFail = true;
                            })
                    } else {
                        sqlWriteFail = true;
                    }
                }
            } else {
                sqlWriteFail = true;
            }

            if (row.Last_IO_Errno !== 0) {
                watchDogFaults.push(`🚨 Channel "${row.Channel_Name.toUpperCase()}" IO error: ${row.Last_IO_Errno}`);
                if (!sqlIOFail) {
                    if (!alarminhibited) {
                        discordClient.createMessage(systemglobal.Discord_Alarm_Channel, `🆘 ALARM! ${systemglobal.DatabaseName} Database Channel "${row.Channel_Name.toUpperCase()}" IO error\n\`${row.Last_IO_Error}\``)
                            .catch(err => {
                                Logger.printLine("StatusUpdate", `Error sending message for alarm : ${err.message}`, "error", err)
                            })
                            .then(() => {
                                sqlIOFail = true;
                            })
                    } else {
                        sqlIOFail = true;
                    }
                }
            }

            if (row.Last_IO_Error) {
                errors.push([row.Channel_Name, 2, row.Last_IO_Error])
            }
            if (row.Slave_IO_Running !== 'Yes') {
                watchDogFaults.push(`🛑 Channel "${row.Channel_Name.toUpperCase()}" IO Failure!`);
                if (!sqlIOFail) {
                    if (!alarminhibited) {
                        discordClient.createMessage(systemglobal.Discord_Alarm_Channel, `🆘 ALARM! ${systemglobal.DatabaseName} Database Channel "${row.Channel_Name.toUpperCase()}" IO Failure!`)
                            .catch(err => {
                                Logger.printLine("StatusUpdate", `Error sending message for alarm : ${err.message}`, "error", err)
                            })
                            .then(() => {
                                sqlIOFail = true;
                            })
                    } else {
                        sqlIOFail = true;
                    }
                }
            } else {
                sqlIOFail = true;
            }
            if (row.Slave_IO_State !== null && row.Slave_IO_State !== 'Waiting for source to send event' && row.Slave_IO_State.length > 0)
                ioState.push([row.Channel_Name, row.Slave_IO_State]);
            if (row.Slave_SQL_Running_State !== null && row.Slave_SQL_Running_State !== 'Replica has read all relay log; waiting for more updates' && row.Slave_SQL_Running_State.length > 0)
                sqlState.push([row.Channel_Name, row.Slave_SQL_Running_State]);
        })
    }


    localParameters.keys().then((localKeys) => {
        discordClient.getRESTGuilds()
            .then(function (guilds) {
                guilds.forEach(function (guild) {
                    if (localKeys.indexOf("statusgen-" + guild.id) !== -1 ) {
                        updateStatus({
                            ioState, sqlState, errors,
                            warnings: watchDogWarnings,
                            faults: watchDogFaults
                        }, true, guild.id)
                    }
                })
            })
    });}
async function updateStatus(input, forceUpdate, guildID, channelID) {
    if (!activeRefresh) {
        activeRefresh = true;
        let data
        try {
            data = await localParameters.getItem('statusgen-' + guildID)
        } catch (e) {
            console.error("Failed to get guild local parameters")
        }
        let channel;
        if (channelID) {
            channel = channelID
        } else if (data && data.channel) {
            channel = data.channel
        } else {
            return false;
        }
        let embed = {
            "title": "",
            "footer": {
                "text": `${systemglobal.DatabaseName} Database`,
                "icon_url": discordClient.guilds.get(guildID).iconURL
            },
            "timestamp": (new Date().toISOString()) + "",
            "color": 65366,
            "thumbnail": {
                "url": null
            },
            "fields": [

            ]
        }
        if (systemglobal.embed_icon) {
            embed.thumbnail = {
                "url": systemglobal.embed_icon
            }
        } else {
            delete embed.thumbnail;
        }

        let warnings = []
        let faults = []
        if (input && input.warnings.length > 0)
            warnings = input.warnings;
        if (input && input.faults.length > 0)
            faults = input.faults;
        if (alarminhibited)
            warnings.push('⚠ Alarms are inhibited! Please re-enable!');

        if (faults.length === 0 && warnings.length === 0) {
            embed.title = `✅ Database is Operating Normally`
        }
        if (warnings.length > 0) {
            embed.color = 16771840
            embed.title = `🔶 Possible Issues Detected`
            embed.fields.unshift({
                "name": `⚠️ Active Warnings`,
                "value": warnings.join('\n').substring(0, 1024)
            })
        }
        if (faults.length > 0) {
            embed.color = 16711680
            embed.title = `❌ Active Faults Detected`
            embed.fields.unshift({
                "name": `⛔ Active Alarms`,
                "value": faults.join('\n').substring(0, 1024)
            })
        }

        if (input && input.errors.length > 0) {
            input.errors.map(e => {
                embed.fields.push({
                    "name": `❌ ${(e[1] === 1) ? 'SQL ' : (e[1] === 2) ? 'I/O ' : ''}Error Log (${e[0]})`,
                    "value": `\`\`\`\n${e[2]}\`\`\``.substring(0, 1024)
                })
            })
        }
        if (input && input.sqlState.length > 0) {
            input.sqlState.map(e => {
                embed.fields.push({
                    "name": `⚙️ SQL Status (${e[0]})`,
                    "value": `\`\`\`\n${e[1]}\`\`\``.substring(0, 1024)
                })
            })
        }
        if (input && input.ioState.length > 0) {
            input.ioState.map(e => {
                embed.fields.push({
                    "name": `💾 I/O Status (${e[0]})`,
                    "value": `\`\`\`\n${e[1]}\`\`\``.substring(0, 1024)
                })
            })
        }

        if (!input) {
            embed.color = 16711680
            embed.fields.unshift({
                "name": `⛔ Active Alarms`,
                "value": `Waiting for initialization!`
            })
        }

        if (data && data.message && !channelID) {
            discordClient.editMessage(channel, data.message, {
                embed
            })
                .then(msg => {
                    localParameters.setItem('statusgen-' + guildID, {
                        channel: msg.channel.id,
                        message: msg.id,
                    })
                })
                .catch(e => {
                    console.error(e)
                });
        } else {
            console.log(embed)
            discordClient.createMessage(channel, {
                embed
            })
                .then(async msg => {
                    await localParameters.setItem('statusgen-' + guildID, {
                        channel: msg.channel.id,
                        message: msg.id,
                    })
                })
                .catch(e => {
                    console.error(e)
                });
        }
        activeRefresh = false;
    }
}

setInterval(updateIndicators, 60000);
discordClient.on("ready", () => {
    Logger.printLine("Discord", "Connected successfully to Discord!", "debug");
    if (init === 0) {
        discordClient.editStatus( "online", {
            name: 'the datacenters',
            type: 3
        })
        init = 1;
    }
    updateIndicators();
    process.send('ready');
});
discordClient.on("error", (err) => {
    Logger.printLine("Discord", "Shard Error, Rebooting...", "error", err)
    console.log(`${err.message}`.bgRed)
    discordClient.connect()
});

discordClient.connect().catch((er) => { Logger.printLine("Discord", "Failed to connect to Discord", "emergency", er) });

process.on('uncaughtException', function(err) {
    Logger.printLine("uncaughtException", err.message, "critical", err)
    console.log(err)
    setTimeout(function() {
        process.exit(1)
    }, 3000)
});
