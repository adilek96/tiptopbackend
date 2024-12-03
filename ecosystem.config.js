module.exports = {
  apps: [
    {
      name: 'medusa-server',
      script: 'medusa',
      args: 'start',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'medusa-worker',
      script: 'medusa',
      args: 'start -c medusa-config.worker.ts',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
}
