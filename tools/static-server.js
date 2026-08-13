'use strict'

const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const rootDirectory = path.resolve(__dirname, '..')
const host = '0.0.0.0'
const port = parsePort(process.argv[2] || '4173')
const allowedRootFiles = new Set([
  'README.md',
  'favicon.ico',
  'index.html',
  'styles.css'
])
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
}

function parsePort(value) {
  if (!/^\d+$/.test(value)) {
    fail('Invalid port: ' + value)
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    fail('Port must be between 1 and 65535: ' + value)
  }

  return parsed
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false
  }

  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
}

function findLanAddresses() {
  const addresses = []
  const seen = new Set()
  const interfaces = os.networkInterfaces()

  Object.keys(interfaces).sort().forEach((name) => {
    ;(interfaces[name] || []).forEach((entry) => {
      if (entry.family === 'IPv4' && !entry.internal && isPrivateIpv4(entry.address) && !seen.has(entry.address)) {
        seen.add(entry.address)
        addresses.push({ address: entry.address, name: name })
      }
    })
  })

  return addresses.sort((left, right) => addressPriority(right) - addressPriority(left))
}

function addressPriority(entry) {
  let score = entry.address.startsWith('192.168.') ? 20 : 10
  if (/vmware|virtual|vethernet|hyper-v|wsl|docker|loopback/i.test(entry.name)) {
    score -= 100
  }
  if (/^00:00:00:00:00:00$/i.test(findInterfaceMac(entry.name, entry.address))) {
    score -= 50
  }
  return score
}

function findInterfaceMac(name, address) {
  const entry = (os.networkInterfaces()[name] || []).find((item) => item.address === address)
  return entry ? entry.mac : ''
}

function sendError(response, statusCode, message) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(message + '\n')
}

function resolvePublicFile(requestUrl) {
  let pathname

  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname)
  } catch (error) {
    return null
  }

  const normalized = pathname.replace(/\\/g, '/')
  if (normalized.includes('\0')) {
    return null
  }

  const segments = normalized.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '..' || segment.startsWith('.'))) {
    return null
  }

  const relativePath = segments.length === 0 ? 'index.html' : segments.join('/')
  const isAllowed = allowedRootFiles.has(relativePath) || relativePath.startsWith('js/')
  if (!isAllowed || /(^|\/)\.[^/]/.test(relativePath) || /\.asar(?:\.unpacked)?(?:\/|$)/i.test(relativePath)) {
    return null
  }

  const filePath = path.resolve(rootDirectory, ...relativePath.split('/'))
  const relativeToRoot = path.relative(rootDirectory, filePath)
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    return null
  }

  return filePath
}

function serve(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendError(response, 405, 'Method not allowed')
    return
  }

  const filePath = resolvePublicFile(request.url || '/')
  if (!filePath) {
    sendError(response, 404, 'Not found')
    return
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendError(response, 404, 'Not found')
      return
    }

    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Length': stats.size,
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    })

    if (request.method === 'HEAD') {
      response.end()
      return
    }

    const stream = fs.createReadStream(filePath)
    stream.on('error', () => {
      if (!response.headersSent) {
        sendError(response, 500, 'Unable to read file')
      } else {
        response.destroy()
      }
    })
    stream.pipe(response)
  })
}

const server = http.createServer(serve)

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    fail('Port ' + port + ' is already in use. Try: start_server.bat 8080')
  }
  fail('Unable to start server: ' + error.message)
})

server.listen(port, host, () => {
  const lanAddresses = findLanAddresses()

  console.log('')
  console.log('DevilConnection Modloader web')
  console.log('Local:   http://127.0.0.1:' + port + '/')

  if (lanAddresses.length > 0) {
    lanAddresses.forEach((entry, index) => {
      const label = index === 0 ? 'LAN:     ' : 'Other:   '
      console.log(label + 'http://' + entry.address + ':' + port + '/ (' + entry.name + ')')
    })
  } else {
    console.log('LAN:     No private IPv4 address was found.')
  }

  console.log('')
  console.log('Only devices on a trusted local network should use the LAN address.')
  console.log('Press Ctrl+C to stop the temporary server.')
  console.log('')
})

process.on('SIGINT', () => {
  console.log('\nStopping server...')
  server.close(() => process.exit(0))
})
