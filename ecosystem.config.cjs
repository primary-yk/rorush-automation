/** PM2 config: run on VPS with `pm2 start ecosystem.config.cjs` */
module.exports = {
  apps: [
    {
      name: "rorush-automation",
      script: "dist/main.js",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "rorush-dashboard",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 43123 -H 127.0.0.1",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
