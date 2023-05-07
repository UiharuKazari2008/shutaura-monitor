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
    const databaseStatus = await db.query(`SELECT
    smi.host AS Master_Host,
    smi.master_log_name AS Master_Log_File,
    rcs.service_state AS Slave_IO_Running,
    rss.service_state AS Slave_SQL_Running,
    t.processlist_time AS Seconds_Behind_Master,
    rcs.last_error_number AS Last_IO_Errno,
    rcs.last_error_message AS Last_IO_Error,
    rss.last_error_number AS Last_SQL_Errno,
    rss.last_error_message AS Last_SQL_Error,
    tc.processlist_state AS  Slave_IO_State,
    t.processlist_state AS  Slave_SQL_Running_State

FROM
    mysql.slave_master_info smi
        JOIN
    performance_schema.replication_connection_status rcs USING (channel_name)
        LEFT JOIN
    performance_schema.replication_applier_status_by_worker rss USING (channel_name)
        LEFT JOIN
    performance_schema.threads t ON (rss.thread_id = t.thread_id)
        LEFT JOIN
    performance_schema.threads tc ON (rcs.thread_id = tc.thread_id);`)



    let addUptimeWarning = false;
    let watchDogWarnings = [];
    let watchDogFaults = [];
    let ioState = [];
    let sqlState = [];
    if (!addUptimeWarning && process.uptime() <= 15 * 60) {
        watchDogWarnings.push(`🔕 Watchdog system was reset <t:${bootTime}:R>!`)
        addUptimeWarning = true
    }
    if (databaseStatus.rows.length === 0) {
        watchDogFaults.push(`🚨 No replication masters!`)
    } else {
        sqlNoResponse = false;
        await databaseStatus.rows.forEach(row => {
            if (parseInt(row.Seconds_Behind_Master.toString()) >= 300) {
                watchDogFaults.push(`🚨 Database is critically behind by ${row.Seconds_Behind_Master} sec`);
                if (!sqlFallingBehind) {
                    if (!alarminhibited) {
                        discordClient.createMessage(systemglobal.Discord_Alarm_Channel, `🆘 ALARM! ${systemglobal.DatabaseName} Database is critically behind by ${row.Seconds_Behind_Master} sec`)
                            .catch(err => {
                                Logger.printLine("StatusUpdate", `Error sending message for alarm : ${err.message}`, "error", err)
                            })
                            .then(() => {
                                sqlFallingBehind = true;
                            })
                    } else {
                        sqlFallingBehind = true;
                    }
                }
            } else if (parseInt(row.Seconds_Behind_Master.toString()) >= 60) {
                watchDogWarnings.push(`⚠️ Database is slagging behind by ${row.Seconds_Behind_Master} sec`);
            } else {
                sqlFallingBehind = true;
            }

            if (row.Last_SQL_Errno !== 0) {
                watchDogFaults.push(`🚨 Database replication error: ${row.Last_SQL_Errno}`);
                if (!sqlWriteFail) {
                    if (!alarminhibited) {
                        discordClient.createMessage(systemglobal.Discord_Alarm_Channel, `🆘 ALARM! ${systemglobal.DatabaseName} Database replication error\n\`${row.Last_SQL_Error}\``)
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
            if (row.Slave_SQL_Running !== 'ON') {
                watchDogFaults.push(`🛑 Database has stopped replication!`);
                if (!sqlWriteFail) {
                    if (!alarminhibited) {
                        discordClient.createMessage(systemglobal.Discord_Alarm_Channel, `🆘 ALARM! ${systemglobal.DatabaseName} Database has stopped replication!`)
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
                watchDogFaults.push(`🚨 Database IO error: ${row.Last_IO_Errno}`);
                if (!sqlIOFail) {
                    if (!alarminhibited) {
                        discordClient.createMessage(systemglobal.Discord_Alarm_Channel, `🆘 ALARM! ${systemglobal.DatabaseName} Database IO error\n\`${row.Last_IO_Error}\``)
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
            if (row.Slave_IO_Running !== 'ON') {
                watchDogFaults.push(`🛑 Database Shutdown!`);
                if (!sqlIOFail) {
                    if (!alarminhibited) {
                        discordClient.createMessage(systemglobal.Discord_Alarm_Channel, `🆘 ALARM! ${systemglobal.DatabaseName} Database Shutdown!`)
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
            ioState.push(row.Slave_IO_State);
            sqlState.push(row.Slave_SQL_Running_State);
        })
    }


    localParameters.keys().then((localKeys) => {
        discordClient.getRESTGuilds()
            .then(function (guilds) {
                guilds.forEach(function (guild) {
                    if (localKeys.indexOf("statusgen-" + guild.id) !== -1 ) {
                        updateStatus({
                            ioState, sqlState,
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
            "footer": {
                "text": `${systemglobal.DatabaseName} Status`,
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

        if (warnings.length > 0) {
            embed.color = 16771840
            embed.fields.unshift({
                "name": `⚠ Active Warnings`,
                "value": warnings.join('\n').substring(0, 1024)
            })
        }
        if (faults.length > 0) {
            embed.color = 16711680
            embed.fields.unshift({
                "name": `⛔ Active Alarms`,
                "value": faults.join('\n').substring(0, 1024)
            })
        }
        if (faults.length === 0 && warnings.length === 0) {

        }

        if (input && input.sqlState.length > 0) {
            embed.fields.push({
                "name": `⚙️ SQL Status`,
                "value": `\`\`\`\n${input.sqlState.join('\n')}\`\`\``.substring(0, 1024)
            })
        }
        if (input && input.ioState.length > 0) {
            embed.fields.push({
                "name": `💾 I/O Status`,
                "value": `\`\`\`\n${input.ioState.join('\n')}\`\`\``.substring(0, 1024)
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
