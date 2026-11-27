module.exports = {
  apps: [{
    name: 'botanicalab-share',
    script: '/mnt/data/www/about/api/server.js',
    cwd: '/mnt/data/www/about/api',
    instances: 1,
    exec_mode: 'fork',
    env: {
      PORT: '4317',
      HOST: '127.0.0.1',
      BOTANICALAB_SHARE_DATA: '/mnt/data/botanicalab-share',
      ALLOWED_ORIGIN: 'https://about.xedryk.top',
      SHARE_TTL_SECONDS: '259200',
      SHARE_MAX_BYTES: '2097152',
    },
  }],
};
