// PM2 process definition for the TwinkHub Discord bot.
//
//   Start / update  : pm2 start ecosystem.config.cjs   (or: pm2 reload twinkhub)
//   Persist list    : pm2 save                          (snapshot for boot resurrect)
//   Boot on Windows  : npm i -g pm2-windows-startup && pm2-startup install
//   Logs            : pm2 logs twinkhub
//   Status          : pm2 list
//
// Single fork instance ONLY — a Discord gateway bot must hold exactly one
// connection per token; pm2 cluster mode would open duplicate sessions and
// double-fire interactions/timer pings. Secrets (DISCORD_TOKEN, guild ids) are
// read from .env by the app via dotenv, not defined here — keep them out of git
// and out of the process list. `.cjs` extension is required because package.json
// is `type: module`, so a plain `.js` config would be parsed as ESM.
module.exports = {
  apps: [
    {
      name: 'twinkhub',
      script: 'src/index.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 5000,
      watch: false,
      time: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
