module.exports = {
    apps : [
        {
            name   : "SQL Watchdog",
            namespace: "june-mon",
            script : "./index.js",
            watch_delay: 1000,
            cron_restart: '0 0 * * *',
            stop_exit_codes: [0],
            restart_delay: 5000,
            kill_timeout : 3000,
            exp_backoff_restart_delay: 100,
            wait_ready: true,
            env: {
                NODE_ENV: 'production'
            },
            env_production: {
                NODE_ENV: 'production'
            }
        }
    ]
}
