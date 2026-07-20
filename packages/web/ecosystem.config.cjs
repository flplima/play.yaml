module.exports = {
  apps: [
    {
      name: 'play-yaml-web',
      script: 'npm',
      args: 'run dev:vite',
      cwd: __dirname,
      autorestart: true,
      watch: false,
    },
  ],
};
