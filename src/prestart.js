import kill from 'kill-port'

const port = Number(process.env.PORT || 5000)
kill(port, 'tcp')
  .then(() => {
    console.log(`Ensured port ${port} is free.`)
    process.exit(0)
  })
  .catch(() => {
    process.exit(0)
  })
